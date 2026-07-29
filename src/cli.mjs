import fs from "node:fs/promises";
import path from "node:path";

import {
  createDreamSkinCliContext,
  DREAMSKIN_PLUGIN_IDS,
} from "./core/cli-context.mjs";
import { ToolError } from "./core/errors.mjs";
import { AGENT_TOOL_VERSION } from "./core/service.mjs";
import { IMAGE_TYPES, MAX_ART_BYTES } from "./core/theme-model.mjs";

export const DREAMSKIN_CLI_PROTOCOL_VERSION = 1;
export const MAX_CLI_INPUT_BYTES = 1024 * 1024;

const HELP = Object.freeze({
  command: "skin-cli",
  protocolVersion: DREAMSKIN_CLI_PROTOCOL_VERSION,
  usage: [
    "skin-cli targets",
    "skin-cli paths [--target <trae|workbuddy>]",
    "skin-cli templates --target <trae|workbuddy>",
    "skin-cli template install <templateId> --as <themeId> --target <trae|workbuddy> [--input <json|@file|->] [--dry-run]",
    "skin-cli theme inspect --target <trae|workbuddy>",
    "skin-cli theme list --target <trae|workbuddy>",
    "skin-cli theme read <themeId> --target <trae|workbuddy>",
    "skin-cli theme create <themeId> --target <trae|workbuddy> [--input <json|@file|->] [--source <templateId>] [--dry-run]",
    "skin-cli theme update <themeId> --target <trae|workbuddy> --expected-revision <sha256> --input <json|@file|-> [--dry-run]",
    "skin-cli theme asset import <themeId> --target <trae|workbuddy> --expected-revision <sha256> --file <png|jpg|jpeg|webp> [--dry-run]",
    "skin-cli theme validate <themeId> --target <trae|workbuddy>",
    "skin-cli theme validate --target <trae|workbuddy> --input <json|@file|->",
    "skin-cli theme delete <themeId> --target <trae|workbuddy> --expected-revision <sha256> [--edition <auto|cn|international>]",
    "skin-cli status --target <trae|workbuddy> [--edition <auto|cn|international>]",
    "skin-cli apply <themeId> --target <trae|workbuddy> [--edition <auto|cn|international>]",
    "skin-cli verify --target <trae|workbuddy> [--edition <auto|cn|international>] [--screenshot <png>]",
    "skin-cli preview <themeId> --target <trae|workbuddy> [--edition <auto|cn|international>] [--screenshot <png>]",
    "skin-cli restore --target <trae|workbuddy> [--edition <auto|cn|international>]",
    "skin-cli doctor [--target <trae|workbuddy>] [--edition <auto|cn|international>]",
  ],
  notes: [
    "Every mutating or runtime command requires an explicit target.",
    "Friendly target names `trae` and `workbuddy` map to stable plugin ids.",
    "Use --edition with Trae when International and SOLO CN are both installed; WorkBuddy does not accept it.",
    "The command writes exactly one JSON envelope to stdout and uses exit code 0 or 1.",
    "Use the revision returned by read/list as --expected-revision for every update.",
    "Background files are accepted only by `theme asset import` and are copied into the managed theme library.",
  ],
});

const TARGET_ALIASES = Object.freeze({
  trae: "dreamskin.trae",
  "dreamskin.trae": "dreamskin.trae",
  workbuddy: "dreamskin.workbuddy",
  "dreamskin.workbuddy": "dreamskin.workbuddy",
});

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
    const canonical = arg === "--target" ? "--plugin" : arg;
    if (seen.has(canonical)) {
      throw new ToolError("INVALID_ARGUMENT", `Option ${canonical} cannot be repeated.`);
    }
    seen.add(canonical);
    if (canonical === "--plugin") options.pluginId = optionValue(argv, index++, arg);
    else if (canonical === "--input") options.input = optionValue(argv, index++, arg);
    else if (canonical === "--source") options.sourceId = optionValue(argv, index++, arg);
    else if (canonical === "--as") options.themeId = optionValue(argv, index++, arg);
    else if (canonical === "--file") options.assetFile = optionValue(argv, index++, arg);
    else if (canonical === "--screenshot") options.screenshotPath = optionValue(argv, index++, arg);
    else if (canonical === "--edition") options.edition = optionValue(argv, index++, arg);
    else if (canonical === "--expected-revision") options.expectedRevision = optionValue(argv, index++, arg);
    else if (canonical === "--dry-run") options.dryRun = true;
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

function requiredPlugin(options, operation) {
  if (typeof options.pluginId !== "string" || !options.pluginId) {
    throw new ToolError("INVALID_ARGUMENT", `${operation} requires --target.`);
  }
  const pluginId = TARGET_ALIASES[options.pluginId.toLowerCase()];
  if (!pluginId) {
    throw new ToolError("INVALID_TARGET", `Unknown target '${options.pluginId}'.`, {
      target: options.pluginId,
      supported: ["trae", "workbuddy"],
    });
  }
  return pluginId;
}

function optionalPlugin(options, operation) {
  if (options.pluginId === undefined) return null;
  return requiredPlugin(options, operation);
}

function runtimeEdition(options, pluginId, operation) {
  if (options.edition === undefined) return pluginId === "dreamskin.trae" ? "auto" : null;
  if (pluginId !== "dreamskin.trae") {
    throw new ToolError("INVALID_ARGUMENT", `${operation} accepts --edition only with --target trae.`);
  }
  const edition = String(options.edition).toLowerCase();
  if (!["auto", "cn", "international"].includes(edition)) {
    throw new ToolError("INVALID_EDITION", `Unknown Trae edition '${options.edition}'.`, {
      edition: options.edition,
      supported: ["auto", "cn", "international"],
    });
  }
  return edition;
}

async function withTraeEdition(pluginId, edition, action) {
  if (pluginId !== "dreamskin.trae") return action();
  const key = "TRAE_DREAM_SKIN_EDITION";
  const previous = process.env[key];
  process.env[key] = edition || "auto";
  try {
    return await action();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
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
  const pluginIndex = argv.findIndex((value) => value === "--plugin" || value === "--target");
  const target = pluginIndex >= 0 ? argv[pluginIndex + 1] : undefined;
  const pluginId = typeof target === "string" ? TARGET_ALIASES[target.toLowerCase()] || target : undefined;
  const editionIndex = argv.indexOf("--edition");
  const explicitEdition = editionIndex >= 0 ? argv[editionIndex + 1] : undefined;
  const editionAware = ["status", "apply", "verify", "preview", "restore", "doctor"].includes(argv[0])
    || (argv[0] === "theme" && argv[1] === "delete");
  const edition = typeof explicitEdition === "string" && !explicitEdition.startsWith("--")
    ? explicitEdition
    : editionIndex < 0
      && editionAware
      && (pluginId === "dreamskin.trae" || (argv[0] === "doctor" && pluginId === undefined))
      ? "auto"
      : undefined;
  const themeIdIndex = argv[0] === "theme" && argv[1] === "asset" && argv[2] === "import" ? 3 : 2;
  const themeId = argv[0] === "theme" && argv[themeIdIndex] && !argv[themeIdIndex].startsWith("--")
    ? argv[themeIdIndex]
    : ["apply", "preview"].includes(argv[0]) && argv[1] && !argv[1].startsWith("--")
      ? argv[1]
      : undefined;
  return {
    ...(typeof pluginId === "string" ? { pluginId } : {}),
    ...(typeof themeId === "string" ? { themeId } : {}),
    ...(typeof edition === "string" ? { edition } : {}),
  };
}

export async function dispatchCli(argv, runtime, io) {
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
  if (argv[0] === "targets") {
    exactPositionals(argv, 1, "targets");
    return { operation: "targets", scope: {}, result: { targets: runtime.targets() } };
  }
  if (argv[0] === "paths") {
    const { positional, options } = parseOptions(argv.slice(1));
    exactPositionals(positional, 0, "paths");
    allowedOptions(options, ["pluginId"], "paths");
    const pluginId = optionalPlugin(options, "paths");
    const selected = pluginId
      ? [[pluginId, runtime.paths.targets[pluginId]]]
      : Object.entries(runtime.paths.targets);
    return {
      operation: "paths",
      scope: pluginId ? { pluginId } : {},
      result: {
        dataRoot: runtime.paths.dataRoot,
        usingLegacyDataRoot: Boolean(runtime.paths.migratedFromStudio),
        targets: selected.map(([id, paths]) => ({
          pluginId: id,
          themesRoot: paths.themesRoot,
          runtimeRoot: runtime.runtimeRoots?.[id] || runtime.paths.resourceRoot,
          runtimeStateRoot: runtime.paths.runtimeStateRoots[id],
        })),
      },
    };
  }
  if (argv[0] === "templates") {
    const { positional, options } = parseOptions(argv.slice(1));
    exactPositionals(positional, 0, "template.list");
    allowedOptions(options, ["pluginId"], "template.list");
    const pluginId = requiredPlugin(options, "template.list");
    const inspected = await runtime.tool.execute({ action: "inspect", pluginId });
    return {
      operation: "template.list",
      scope: { pluginId },
      result: inspected.catalog,
    };
  }
  if (argv[0] === "template") {
    if (argv[1] !== "install") {
      throw new ToolError("INVALID_ARGUMENT", "template requires the 'install' command.");
    }
    const operation = "template.install";
    const { positional, options } = parseOptions(argv.slice(2));
    allowedOptions(options, ["pluginId", "themeId", "input", "dryRun"], operation);
    exactPositionals(positional, 1, operation);
    const pluginId = requiredPlugin(options, operation);
    if (!options.themeId) {
      throw new ToolError("INVALID_ARGUMENT", `${operation} requires --as.`);
    }
    return {
      operation,
      scope: { pluginId, themeId: options.themeId },
      result: await runtime.tool.execute({
        action: "create",
        pluginId,
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
    allowedOptions(options, ["pluginId", "screenshotPath", "edition"], operation);
    const pluginId = requiredPlugin(options, operation);
    const edition = runtimeEdition(options, pluginId, operation);
    if (["apply", "preview"].includes(operation)) exactPositionals(positional, 1, operation);
    else exactPositionals(positional, 0, operation);
    if (!["verify", "preview"].includes(operation) && options.screenshotPath) {
      throw new ToolError("INVALID_ARGUMENT", `${operation} does not accept --screenshot.`);
    }
    const scope = {
      pluginId,
      ...(edition ? { edition } : {}),
      ...(["apply", "preview"].includes(operation) ? { themeId: positional[0] } : {}),
    };
    if (operation === "status") {
      return {
        operation,
        scope,
        result: await withTraeEdition(pluginId, edition, () => runtime.runtime.status(pluginId)),
      };
    }
    if (operation === "apply") {
      return {
        operation,
        scope,
        result: await withTraeEdition(
          pluginId,
          edition,
          () => runtime.runtime.apply(positional[0], pluginId),
        ),
      };
    }
    if (operation === "verify") {
      return {
        operation,
        scope,
        result: await withTraeEdition(
          pluginId,
          edition,
          () => runtime.runtime.verify(
            options.screenshotPath ? { screenshotPath: path.resolve(options.screenshotPath) } : {},
            pluginId,
          ),
        ),
      };
    }
    if (operation === "preview") {
      return {
        operation,
        scope,
        result: await withTraeEdition(pluginId, edition, () => runtime.runtime.preview({
          id: positional[0],
          screenshot: true,
          ...(options.screenshotPath ? { screenshotPath: path.resolve(options.screenshotPath) } : {}),
        }, pluginId)),
      };
    }
    return {
      operation,
      scope,
      result: await withTraeEdition(pluginId, edition, () => runtime.runtime.restore(pluginId)),
    };
  }
  if (argv[0] === "doctor") {
    const { positional, options } = parseOptions(argv.slice(1));
    exactPositionals(positional, 0, "doctor");
    allowedOptions(options, ["pluginId", "edition"], "doctor");
    const pluginId = optionalPlugin(options, "doctor");
    const edition = runtimeEdition(options, pluginId || "dreamskin.trae", "doctor");
    const targets = runtime.targets().filter((target) => !pluginId || target.pluginId === pluginId);
    const results = await Promise.all(targets.map(async (target) => ({
      ...target,
      status: await withTraeEdition(
        target.pluginId,
        target.pluginId === "dreamskin.trae" ? edition : null,
        () => runtime.runtime.status(target.pluginId),
      ),
    })));
    return {
      operation: "doctor",
      scope: {
        ...(pluginId ? { pluginId } : {}),
        ...(edition ? { edition } : {}),
      },
      result: { platform: process.platform, targets: results },
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
  const pluginId = requiredPlugin(options, operation);
  const scope = { pluginId };

  if (themeCommand === "asset") {
    allowedOptions(options, ["pluginId", "assetFile", "expectedRevision", "dryRun"], operation);
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
    allowedOptions(options, ["pluginId"], operation);
    exactPositionals(positional, 0, operation);
    return { operation, scope, result: await runtime.tool.execute({ action: "inspect", pluginId }) };
  }
  if (themeCommand === "list") {
    allowedOptions(options, ["pluginId"], operation);
    exactPositionals(positional, 0, operation);
    return { operation, scope, result: await runtime.tool.execute({ action: "list", pluginId }) };
  }
  if (themeCommand === "read") {
    allowedOptions(options, ["pluginId"], operation);
    exactPositionals(positional, 1, operation);
    scope.themeId = positional[0];
    return {
      operation,
      scope,
      result: await runtime.tool.execute({ action: "read", pluginId, themeId: positional[0] }),
    };
  }
  if (themeCommand === "create") {
    allowedOptions(options, ["pluginId", "input", "sourceId", "dryRun"], operation);
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
    allowedOptions(options, ["pluginId", "input", "expectedRevision", "dryRun"], operation);
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
    allowedOptions(options, ["pluginId", "expectedRevision", "edition"], operation);
    exactPositionals(positional, 1, operation);
    scope.themeId = positional[0];
    const edition = runtimeEdition(options, pluginId, operation);
    if (edition) scope.edition = edition;
    if (!options.expectedRevision) {
      throw new ToolError("INVALID_ARGUMENT", `${operation} requires --expected-revision.`);
    }
    return {
      operation,
      scope,
      result: await withTraeEdition(pluginId, edition, () => runtime.tool.execute({
        action: "delete",
        pluginId,
        themeId: positional[0],
        expectedRevision: options.expectedRevision,
      })),
    };
  }
  if (themeCommand === "validate") {
    allowedOptions(options, ["pluginId", "input"], operation);
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

function contextPluginIds(argv) {
  const command = argv[0];
  const targetRequired = command === "templates"
    || command === "template"
    || command === "theme"
    || ["status", "apply", "verify", "preview", "restore"].includes(command);
  const targetOptional = command === "paths" || command === "doctor";
  if (!targetRequired && !targetOptional && command !== "targets") return null;
  const indexes = argv
    .map((value, index) => (value === "--target" || value === "--plugin" ? index : -1))
    .filter((index) => index >= 0);
  if (command === "targets" && indexes.length > 0) return null;
  if (indexes.length === 0) return targetRequired ? null : undefined;
  if (indexes.length !== 1) return null;
  const value = argv[indexes[0] + 1];
  if (typeof value !== "string" || value.startsWith("--")) return null;
  const pluginId = TARGET_ALIASES[value.toLowerCase()];
  return pluginId && DREAMSKIN_PLUGIN_IDS.includes(pluginId) ? [pluginId] : null;
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
      message: isDomainError ? error.message : "DreamSkin could not complete the operation.",
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
      const pluginIds = contextPluginIds(argv);
      if (pluginIds !== null) {
        runtime = await createDreamSkinCliContext({
          ...(pluginIds === undefined ? {} : { pluginIds }),
        });
      }
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
        io.stderr?.write?.(`DreamSkin CLI shutdown warning: ${error.message}\n`);
      }
    }
  }
}
