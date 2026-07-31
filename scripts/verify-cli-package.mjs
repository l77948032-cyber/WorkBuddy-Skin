import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePrefix = "package/build/cli-runtime/dreamskin.workbuddy/";

const required = new Set([
  "package/package.json",
  "package/bin/workbuddy-skin.mjs",
  `${runtimePrefix}runtime-manifest.v1.json`,
  `${runtimePrefix}assets/workbuddy-renderer-inject.js`,
  `${runtimePrefix}plugins/workbuddy/assets/workbuddy-skin.css`,
  `${runtimePrefix}plugins/workbuddy/resources/components.v1.json`,
  `${runtimePrefix}scripts/cdp-client.mjs`,
  `${runtimePrefix}scripts/common-workbuddy-macos.sh`,
  `${runtimePrefix}scripts/start-workbuddy-skin-macos.sh`,
  `${runtimePrefix}scripts/status-workbuddy-skin-macos.sh`,
  `${runtimePrefix}scripts/stop-workbuddy-skin-macos.sh`,
  `${runtimePrefix}scripts/verify-workbuddy-skin-macos.sh`,
  `${runtimePrefix}scripts/workbuddy-injector.mjs`,
  `${runtimePrefix}src/core/paths.mjs`,
  `${runtimePrefix}src/core/theme-loader.mjs`,
  `${runtimePrefix}src/core/theme-model.mjs`,
  "package/plugins/workbuddy/plugin.json",
  "package/plugins/workbuddy/resources/components.v1.json",
  "package/plugins/workbuddy/resources/theme-runtime.v1.json",
  "package/plugins/workbuddy/resources/theme-v1.schema.json",
  "package/scripts/cdp-client.mjs",
  "package/scripts/start-workbuddy-skin-macos.sh",
  "package/assets/workbuddy-renderer-inject.js",
  "package/skills/workbuddy-dream-skin/SKILL.md",
  "package/src/cli.mjs",
]);

function isForbiddenPath(file) {
  const normalized = file.toLowerCase();
  if (normalized.includes("/trae")) return true;
  if (normalized.includes("windows") || normalized.endsWith(".ps1")) return true;
  if (
    normalized.startsWith("package/desktop/")
    || normalized.startsWith("package/studio/")
    || normalized.startsWith("package/dist-desktop/")
    || normalized.startsWith("package/build/desktop-resources/")
  ) return true;
  if (normalized.startsWith("package/skills/")) {
    return !normalized.startsWith("package/skills/workbuddy-dream-skin/");
  }
  return false;
}

export async function verifyCliPackage({ root = projectRoot } = {}) {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  if (packageJson.name !== "workbuddy-skin" || packageJson.version !== "0.6.0") {
    throw new Error("package.json must identify workbuddy-skin 0.6.0.");
  }
  if (packageJson.private === true) throw new Error("CLI package cannot be private.");
  if (packageJson.main) throw new Error("CLI package must not expose a desktop main entry.");
  if (
    Object.keys(packageJson.bin || {}).length !== 1
    || packageJson.bin?.["workbuddy-skin"] !== "./bin/workbuddy-skin.mjs"
  ) {
    throw new Error("package.json must expose only bin/workbuddy-skin.mjs as workbuddy-skin.");
  }

  const { stdout } = await execFile(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const report = JSON.parse(stdout);
  if (!Array.isArray(report) || report.length !== 1) {
    throw new Error("npm pack returned an unexpected report.");
  }
  const files = new Set(report[0].files.map((entry) => `package/${entry.path}`));
  const missing = [...required].filter((entry) => !files.has(entry));
  const forbidden = [...files].filter(isForbiddenPath);
  const foreignRuntimes = [...files].filter(
    (entry) => entry.startsWith("package/build/cli-runtime/")
      && !entry.startsWith(runtimePrefix),
  );
  const unexpectedBins = [...files].filter(
    (entry) => entry.startsWith("package/bin/")
      && entry !== "package/bin/workbuddy-skin.mjs",
  );
  if (missing.length) {
    throw new Error(`CLI package is missing required files: ${missing.join(", ")}`);
  }
  if (forbidden.length) {
    throw new Error(`CLI package contains retired files: ${forbidden.join(", ")}`);
  }
  if (foreignRuntimes.length) {
    throw new Error(`CLI package contains a non-WorkBuddy runtime: ${foreignRuntimes.join(", ")}`);
  }
  if (unexpectedBins.length) {
    throw new Error(`CLI package contains retired command entries: ${unexpectedBins.join(", ")}`);
  }
  return {
    ok: true,
    name: report[0].name,
    version: report[0].version,
    filename: report[0].filename,
    files: report[0].entryCount,
    unpackedBytes: report[0].unpackedSize,
    packageBytes: report[0].size,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyCliPackage()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
