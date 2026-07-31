import fs from "node:fs/promises";
import path from "node:path";

import {
  createWorkBuddyCliContext,
  WORKBUDDY_PLUGIN_ID,
} from "./core/cli-context.mjs";
import { ToolError } from "./core/errors.mjs";
import { AGENT_TOOL_VERSION } from "./core/service.mjs";
import { IMAGE_TYPES, MAX_ART_BYTES } from "./core/theme-model.mjs";

export const DREAMSKIN_CLI_PROTOCOL_VERSION = 1;
export const MAX_CLI_INPUT_BYTES = 1024 * 1024;

const HELP = Object.freeze({
  command: "workbuddy-skin",
  protocolVersion: DREAMSKIN_CLI_PROTOCOL_VERSION,
  usage: [
    "workbuddy-skin paths",
    "workbuddy-skin templates",
    "workbuddy-skin template install <templateId> --as <themeId> [--input <json|@file|->] [--dry-run]",
    "workbuddy-skin theme inspect",
    "workbuddy-skin theme list",
    "workbuddy-skin theme read <themeId>",
    "workbuddy-skin theme create <themeId> [--input <json|@file|->] [--source <templateId>] [--dry-run]",
    "workbuddy-skin theme update <themeId> --expected-revision <sha256> --input <json|@file|-> [--dry-run]",
    "workbuddy-skin theme asset import <themeId> --expected-revision <sha256> --file <png|jpg|jpeg|webp> [--dry-run]",
    "workbuddy-skin theme validate <themeId>",
    "workbuddy-skin theme validate --input <json|@file|->",
    "workbuddy-skin theme delete <themeId> --expected-revision <sha256>",
    "workbuddy-skin status",
    "workbuddy-skin apply <themeId>",
    "workbuddy-skin verify [--screenshot <png>]",
    "workbuddy-skin preview <themeId> [--screenshot <png>]",
    "workbuddy-skin restore",
    "workbuddy-skin doctor",
  ],
  notes: [
    "Every command is scoped to the built-in dreamskin.workbuddy plugin.",
    "--target, --plugin, and --edition are intentionally unsupported.",
    "The command writes exactly one JSON envelope to stdout and uses exit code 0 or 1.",
    "Use the revision returned by read/list as --expected-revision for every update.",
    "Background files are accepted only by `theme asset import` and are copied into the managed theme library.",
  ],
});

const RETIRED_OPTIONS = new Set(["--target", "--plugin", "--edition"]);

function optionValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new ToolError("INVALID_ARGUMENT", `${flag} requires a value.`);
  }
  return value;
}

function parseOptions(argv) {
  const options = {};
  const positional = [];
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (RETIRED_OPTIONS.has(arg)) {
      throw new ToolError("INVALID_ARGUMENT", `${arg} is not supported by workbuddy-skin.`);
    }
    if (seen.has(arg)) {
      throw new ToolError("INVALID_ARGUMENT", `Option ${arg} cannot be repeated.`);
    }
    seen.add(arg);
    if (arg === "--input") options.input = optionValue(argv, index++, arg);
    else if (arg === "--source") options.sourceId = optionValue(argv, index++, arg);
    else if (arg === "--as") options.themeId = optionValue(argv, index++, arg);
    else if (arg === "--file") options.assetFile = optionValue(argv, index++, arg);
    else if (arg === "--screenshot") options.screenshotPath = optionValue(argv, index++, arg);
    else if (arg === "--expected-revision") options.expectedRevision = optionValue(argv, index++, arg);
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new ToolError("INVALID_ARGUMENT", `Unknown option: ${arg}`);
  }
  return { positional, options };
}

async function boundedText(value, label) {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_CLI_INPUT_BYTES) {
    throw new ToolError("INPUT_TOO_LARGE", `${label} exceeds the 1 MiB input limit.`, {
      bytes,
      maximumBytes: MAX_CLI_INPUT_BYTES,
    });
  }
  return value;
}

async function readInput(value, stdin) {
  if (!value) throw new ToolError("INVALID_ARGUMENT", "--input is required.");
  let text;
  if (value === "-") text = await boundedText(await stdin(), "stdin");
  else if (value.startsWith("@")) {
    let stat;
    try {
      stat = await fs.stat(value.slice(1));
    } catch {
      throw new ToolError("INPUT_FILE_UNAVAILABLE", "The --input file is unavailable or cannot be read.");
    }
    if (!stat.isFile()) {
      throw new ToolError("INPUT_FILE_UNAVAILABLE", "The --input file must be a readable regular file.");
    }
    if (stat.size > MAX_CLI_INPUT_BYTES) {
      throw new ToolError("INPUT_TOO_LARGE", "The --input file exceeds the 1 MiB input limit.", {
        bytes: stat.size,
        maximumBytes: MAX_CLI_INPUT_BYTES,
      });
    }
    try {
      text = await boundedText(await fs.readFile(value.slice(1), "utf8"), "--input file");
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw new ToolError("INPUT_FILE_UNAVAILABLE", "The --input file is unavailable or cannot be read.");
    }
  } else text = await boundedText(value, "--input");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ToolError("INVALID_JSON", `Could not parse --input JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ToolError("INVALID_ARGUMENT", "--input JSON must be an object.");
  }
  return parsed;
}

async function readOptionalInput(value, stdin) {
  return value === undefined ? {} : readInput(value, stdin);
}

async function resolveAssetFile(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new ToolError("INVALID_ASSET_PATH", "--file must identify a local background image.");
  }
  const assetPath = path.resolve(value);
  let stat;
  try {
    stat = await fs.lstat(assetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ToolError("ASSET_NOT_FOUND", "The background image does not exist.");
    }
    throw new ToolError("INVALID_ASSET_PATH", "The background image cannot be inspected.");
  }
  if (stat.isSymbolicLink()) {
    throw new ToolError("INVALID_ASSET_PATH", "Background images cannot be symbolic links.");
  }
  if (!stat.isFile()) {
    throw new ToolError("INVALID_ASSET_PATH", "The background image must be a regular file.");
  }
  if (!IMAGE_TYPES.has(path.extname(assetPath).toLowerCase())) {
    throw new ToolError("INVALID_IMAGE", "Background image must be PNG, JPEG, or WebP.");
  }
  if (stat.size > MAX_ART_BYTES) {
    throw new ToolError("ASSET_TOO_LARGE", "Background image exceeds the 16 MiB limit.", {
      bytes: stat.size,
      maximumBytes: MAX_ART_BYTES,
    });
  }
  return assetPath;
}

function exactPositionals(values, count, operation) {
  if (values.length !== count) {
    throw new ToolError("INVALID_ARGUMENT", `${operation} requires exactly ${count} positional argument${count === 1 ? "" : "s"}.`);
  }
}

function allowedOptions(options, allowed, operation) {
  const accepted = new Set(allowed);
  const unknown = Object.keys(options).filter((key) => !accepted.has(key));
  if (unknown.length) {
    throw new ToolError("INVALID_ARGUMENT", `${operation} does not accept: ${unknown.join(", ")}.`, {
      options: unknown,
    });
  }
}

function operationHint(argv) {
  if (argv[0] === "theme" && argv[1] === "asset" && argv[2] === "import") {
    return "theme.asset.import";
  }
  if (argv[0] === "theme" && typeof argv[1] === "string" && !argv[1].startsWith("--")) {
    return `theme.${argv[1]}`;
  }
  if (argv[0] === "template" && argv[1] === "install") return "template.install";
  if (argv[0] === "templates") return "template.list";
  if (argv[0] === "--version") return "version";
  if (argv[0] === "--help") return "help";
  return argv[0] || "unknown";
}

function scopeFrom(argv) {
  const themeIdIndex = argv[0] === "theme" && argv[1] === "asset" && argv[2] === "import" ? 3 : 2;
  const themeId = argv[0] === "theme" && argv[themeIdIndex] && !argv[themeIdIndex].startsWith("--")
    ? argv[themeIdIndex]
    : ["apply", "preview"].includes(argv[0]) && argv[1] && !argv[1].startsWith("--")
      ? argv[1]
      : undefined;
  return {
    pluginId: WORKBUDDY_PLUGIN_ID,
    ...(typeof themeId === "string" ? { themeId } : {}),
  };
}

export async function dispatchCli(argv, runtime, io) {
  const retiredOption = argv.find((value) => RETIRED_OPTIONS.has(value));
  if (retiredOption) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `${retiredOption} is not supported by workbuddy-skin.`,
    );
  }
  if (argv.length === 0 || argv[0] === "help" || argv.includes("--help")) {
    return { operation: "help", scope: {}, result: HELP };
  }
  if (argv[0] === "version" || argv[0] === "--version") {
    exactPositionals(argv, 1, "version");
    return {
      operation: "version",
      scope: {},
      result: { version: AGENT_TOOL_VERSION, protocolVersion: DREAMSKIN_CLI_PROTOCOL_VERSION },
    };
  }
  if (argv[0] === "paths") {
    const { positional, options } = parseOptions(argv.slice(1));
    exactPositionals(positional, 0, "paths");
    allowedOptions(options, [], "paths");
    return {
      operation: "paths",
      scope: { pluginId: WORKBUDDY_PLUGIN_ID },
      result: {
        dataRoot: runtime.paths.dataRoot,
        pluginId: WORKBUDDY_PLUGIN_ID,
        themesRoot: runtime.paths.target.themesRoot,
        runtimeRoot: runtime.runtimeRoot || runtime.paths.resourceRoot,
        runtimeStateRoot: runtime.paths.runtimeStateRoot,
      },
    };
  }
  if (argv[0] === "templates") {
    const { positional, options } = parseOptions(argv.slice(1));
    exactPositionals(positional, 0, "template.list");
    allowedOptions(options, [], "template.list");
    const inspected = await runtime.tool.execute({
      action: "inspect",
      pluginId: WORKBUDDY_PLUGIN_ID,
    });
    return {
      operation: "template.list",
      scope: { pluginId: WORKBUDDY_PLUGIN_ID },
      result: inspected.catalog,
    };
  }
  if (argv[0] === "template") {
    if (argv[1] !== "install") {
      throw new ToolError("INVALID_ARGUMENT", "template requires the 'install' command.");
    }
    const operation = "template.install";
    const { positional, options } = parseOptions(argv.slice(2));
    allowedOptions(options, ["themeId", "input", "dryRun"], operation);
    exactPositionals(positional, 1, operation);
    if (!options.themeId) {
      throw new ToolError("INVALID_ARGUMENT", `${operation} requires --as.`);
    }
    return {
      operation,
      scope: { pluginId: WORKBUDDY_PLUGIN_ID, themeId: options.themeId },
      result: await runtime.tool.execute({
        action: "create",
        pluginId: WORKBUDDY_PLUGIN_ID,
        themeId: options.themeId,
        sourceId: positional[0],
        themePatch: await readOptionalInput(options.input, io.stdin),
        ...(options.dryRun ? { dryRun: true } : {}),
      }),
    };
  }
  if (["status", "apply", "verify", "preview", "restore"].includes(argv[0])) {
    const operation = argv[0];
    const { positional, options } = parseOptions(argv.slice(1));
    allowedOptions(options, ["screenshotPath"], operation);
    if (["apply", "preview"].includes(operation)) exactPositionals(positional, 1, operation);
    else exactPositionals(positional, 0, operation);
    if (!["verify", "preview"].includes(operation) && options.screenshotPath) {
      throw new ToolError("INVALID_ARGUMENT", `${operation} does not accept --screenshot.`);
    }
    const scope = {
      pluginId: WORKBUDDY_PLUGIN_ID,
      ...(["apply", "preview"].includes(operation) ? { themeId: positional[0] } : {}),
    };
    if (operation === "status") {
      return {
        operation,
        scope,
        result: await runtime.runtime.status(WORKBUDDY_PLUGIN_ID),
      };
    }
    if (operation === "apply") {
      return {
        operation,
        scope,
        result: await runtime.runtime.apply(positional[0], WORKBUDDY_PLUGIN_ID),
      };
    }
    if (operation === "verify") {
      return {
        operation,
        scope,
        result: await runtime.runtime.verify(
          options.screenshotPath ? { screenshotPath: path.resolve(options.screenshotPath) } : {},
          WORKBUDDY_PLUGIN_ID,
        ),
      };
    }
    if (operation === "preview") {
      return {
        operation,
        scope,
        result: await runtime.runtime.preview({
          id: positional[0],
          screenshot: true,
          ...(options.screenshotPath ? { screenshotPath: path.resolve(options.screenshotPath) } : {}),
        }, WORKBUDDY_PLUGIN_ID),
      };
    }
    return {
      operation,
      scope,
      result: await runtime.runtime.restore(WORKBUDDY_PLUGIN_ID),
    };
  }
  if (argv[0] === "doctor") {
    const { positional, options } = parseOptions(argv.slice(1));
    exactPositionals(positional, 0, "doctor");
    allowedOptions(options, [], "doctor");
    return {
      operation: "doctor",
      scope: { pluginId: WORKBUDDY_PLUGIN_ID },
      result: {
        platform: process.platform,
        target: {
          ...runtime.target,
          status: await runtime.runtime.status(WORKBUDDY_PLUGIN_ID),
        },
      },
    };
  }
  if (argv[0] !== "theme") {
    throw new ToolError("INVALID_ARGUMENT", `Unknown command: ${argv[0]}`);
  }

  const themeCommand = argv[1];
  if (!themeCommand || themeCommand.startsWith("--")) {
    throw new ToolError("INVALID_ARGUMENT", "A theme command is required.");
  }
  let operation;
  let positional;
  let options;
  if (themeCommand === "asset") {
    if (argv[2] !== "import") {
      throw new ToolError("INVALID_ARGUMENT", "theme asset requires the 'import' command.");
    }
    operation = "theme.asset.import";
    ({ positional, options } = parseOptions(argv.slice(3)));
  } else {
    operation = `theme.${themeCommand}`;
    ({ positional, options } = parseOptions(argv.slice(2)));
  }
  const pluginId = WORKBUDDY_PLUGIN_ID;
  const scope = { pluginId };

  if (themeCommand === "asset") {
    allowedOptions(options, ["assetFile", "expectedRevision", "dryRun"], operation);
    exactPositionals(positional, 1, operation);
    scope.themeId = positional[0];
    if (!options.expectedRevision) {
      throw new ToolError("INVALID_ARGUMENT", `${operation} requires --expected-revision.`);
    }
    if (!options.assetFile) {
      throw new ToolError("INVALID_ARGUMENT", `${operation} requires --file.`);
    }
    return {
      operation,
      scope,
      result: await runtime.tool.execute({
        action: "importAsset",
        pluginId,
        themeId: positional[0],
        assetPath: await resolveAssetFile(options.assetFile),
        expectedRevision: options.expectedRevision,
        ...(options.dryRun ? { dryRun: true } : {}),
      }),
    };
  }

  if (themeCommand === "inspect") {
    allowedOptions(options, [], operation);
    exactPositionals(positional, 0, operation);
    return { operation, scope, result: await runtime.tool.execute({ action: "inspect", pluginId }) };
  }
  if (themeCommand === "list") {
    allowedOptions(options, [], operation);
    exactPositionals(positional, 0, operation);
    return { operation, scope, result: await runtime.tool.execute({ action: "list", pluginId }) };
  }
  if (themeCommand === "read") {
    allowedOptions(options, [], operation);
    exactPositionals(positional, 1, operation);
    scope.themeId = positional[0];
    return {
      operation,
      scope,
      result: await runtime.tool.execute({ action: "read", pluginId, themeId: positional[0] }),
    };
  }
  if (themeCommand === "create") {
    allowedOptions(options, ["input", "sourceId", "dryRun"], operation);
    exactPositionals(positional, 1, operation);
    scope.themeId = positional[0];
    const themePatch = await readOptionalInput(options.input, io.stdin);
    return {
      operation,
      scope,
      result: await runtime.tool.execute({
        action: "create",
        pluginId,
        themeId: positional[0],
        themePatch,
        ...(options.sourceId ? { sourceId: options.sourceId } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
      }),
    };
  }
  if (themeCommand === "update") {
    allowedOptions(options, ["input", "expectedRevision", "dryRun"], operation);
    exactPositionals(positional, 1, operation);
    scope.themeId = positional[0];
    if (!options.expectedRevision) {
      throw new ToolError("INVALID_ARGUMENT", `${operation} requires --expected-revision.`);
    }
    const themePatch = await readInput(options.input, io.stdin);
    return {
      operation,
      scope,
      result: await runtime.tool.execute({
        action: "update",
        pluginId,
        themeId: positional[0],
        expectedRevision: options.expectedRevision,
        themePatch,
        ...(options.dryRun ? { dryRun: true } : {}),
      }),
    };
  }
  if (themeCommand === "delete") {
    allowedOptions(options, ["expectedRevision"], operation);
    exactPositionals(positional, 1, operation);
    scope.themeId = positional[0];
    if (!options.expectedRevision) {
      throw new ToolError("INVALID_ARGUMENT", `${operation} requires --expected-revision.`);
    }
    return {
      operation,
      scope,
      result: await runtime.tool.execute({
        action: "delete",
        pluginId,
        themeId: positional[0],
        expectedRevision: options.expectedRevision,
      }),
    };
  }
  if (themeCommand === "validate") {
    allowedOptions(options, ["input"], operation);
    if (positional.length > 1 || (positional.length === 1 && options.input)) {
      throw new ToolError("INVALID_ARGUMENT", `${operation} requires exactly one theme id or --input JSON.`);
    }
    if (positional.length === 1) {
      scope.themeId = positional[0];
      return {
        operation,
        scope,
        result: await runtime.tool.execute({ action: "validate", pluginId, themeId: positional[0] }),
      };
    }
    if (!options.input) {
      throw new ToolError("INVALID_ARGUMENT", `${operation} requires a theme id or --input JSON.`);
    }
    return {
      operation,
      scope,
      result: await runtime.tool.execute({ action: "validate", pluginId, theme: await readInput(options.input, io.stdin) }),
    };
  }
  throw new ToolError("INVALID_ARGUMENT", `Unknown theme command: ${themeCommand}`);
}

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text, "utf8") > MAX_CLI_INPUT_BYTES) {
      throw new ToolError("INPUT_TOO_LARGE", "stdin exceeds the 1 MiB input limit.", {
        maximumBytes: MAX_CLI_INPUT_BYTES,
      });
    }
  }
  return text;
}

function successEnvelope({ operation, scope, result }) {
  return {
    protocolVersion: DREAMSKIN_CLI_PROTOCOL_VERSION,
    ok: true,
    operation,
    scope,
    result,
  };
}

function failureEnvelope(error, operation, scope) {
  const isDomainError = error instanceof ToolError;
  return {
    protocolVersion: DREAMSKIN_CLI_PROTOCOL_VERSION,
    ok: false,
    operation,
    scope,
    error: {
      code: isDomainError ? error.code : "INTERNAL_ERROR",
      message: isDomainError ? error.message : "WorkBuddy Skin could not complete the operation.",
      ...(!isDomainError || error.details === undefined ? {} : { details: error.details }),
    },
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  providedRuntime,
  io = { stdout: process.stdout, stderr: process.stderr, stdin: readStdin },
) {
  let runtime = providedRuntime;
  const operation = operationHint(argv);
  const scope = scopeFrom(argv);
  try {
    const contextFree = argv.length === 0
      || argv[0] === "help"
      || argv.includes("--help")
      || argv[0] === "version"
      || argv[0] === "--version";
    if (!runtime && !contextFree) {
      runtime = await createWorkBuddyCliContext();
    }
    const result = await dispatchCli(argv, runtime, io);
    io.stdout.write(`${JSON.stringify(successEnvelope(result), null, 2)}\n`);
    return 0;
  } catch (error) {
    io.stdout.write(`${JSON.stringify(failureEnvelope(error, operation, scope), null, 2)}\n`);
    return 1;
  } finally {
    if (!providedRuntime && runtime?.close) {
      try {
        await runtime.close();
      } catch (error) {
        io.stderr?.write?.(`WorkBuddy Skin shutdown warning: ${error.message}\n`);
      }
    }
  }
}
