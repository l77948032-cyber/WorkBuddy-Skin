import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const required = new Set([
  "package/package.json",
  "package/bin/skin-cli.mjs",
  "package/build/cli-runtime/dreamskin.trae/runtime-manifest.v1.json",
  "package/build/cli-runtime/dreamskin.trae/assets/renderer-inject.js",
  "package/build/cli-runtime/dreamskin.trae/assets/trae-skin.css",
  "package/build/cli-runtime/dreamskin.trae/registry/components.v1.json",
  "package/build/cli-runtime/dreamskin.trae/registry/theme-runtime.v1.json",
  "package/build/cli-runtime/dreamskin.trae/scripts/common-macos.sh",
  "package/build/cli-runtime/dreamskin.trae/scripts/common-windows.ps1",
  "package/build/cli-runtime/dreamskin.trae/scripts/injector.mjs",
  "package/build/cli-runtime/dreamskin.trae/scripts/start-trae-skin-macos.sh",
  "package/build/cli-runtime/dreamskin.trae/scripts/start-trae-skin-windows.ps1",
  "package/build/cli-runtime/dreamskin.trae/scripts/status-trae-skin-macos.sh",
  "package/build/cli-runtime/dreamskin.trae/scripts/status-trae-skin-windows.ps1",
  "package/build/cli-runtime/dreamskin.trae/scripts/stop-trae-skin-macos.sh",
  "package/build/cli-runtime/dreamskin.trae/scripts/stop-trae-skin-windows.ps1",
  "package/build/cli-runtime/dreamskin.trae/scripts/verify-trae-skin-macos.sh",
  "package/build/cli-runtime/dreamskin.trae/scripts/verify-trae-skin-windows.ps1",
  "package/build/cli-runtime/dreamskin.trae/src/core/theme-loader.mjs",
  "package/build/cli-runtime/dreamskin.trae/src/core/theme-model.mjs",
  "package/build/cli-runtime/dreamskin.workbuddy/runtime-manifest.v1.json",
  "package/build/cli-runtime/dreamskin.workbuddy/assets/workbuddy-renderer-inject.js",
  "package/build/cli-runtime/dreamskin.workbuddy/plugins/workbuddy/assets/workbuddy-skin.css",
  "package/build/cli-runtime/dreamskin.workbuddy/plugins/workbuddy/resources/components.v1.json",
  "package/build/cli-runtime/dreamskin.workbuddy/scripts/common-workbuddy-macos.sh",
  "package/build/cli-runtime/dreamskin.workbuddy/scripts/start-workbuddy-skin-macos.sh",
  "package/build/cli-runtime/dreamskin.workbuddy/scripts/status-workbuddy-skin-macos.sh",
  "package/build/cli-runtime/dreamskin.workbuddy/scripts/stop-workbuddy-skin-macos.sh",
  "package/build/cli-runtime/dreamskin.workbuddy/scripts/verify-workbuddy-skin-macos.sh",
  "package/build/cli-runtime/dreamskin.workbuddy/scripts/workbuddy-injector.mjs",
  "package/build/cli-runtime/dreamskin.workbuddy/src/core/theme-loader.mjs",
  "package/build/cli-runtime/dreamskin.workbuddy/src/core/theme-model.mjs",
  "package/src/cli.mjs",
  "package/plugins/trae/plugin.json",
  "package/plugins/trae/resources/components.v1.json",
  "package/plugins/trae/resources/theme-runtime.v1.json",
  "package/plugins/trae/resources/theme-v1.schema.json",
  "package/plugins/workbuddy/plugin.json",
  "package/plugins/workbuddy/resources/components.v1.json",
  "package/plugins/workbuddy/resources/theme-runtime.v1.json",
  "package/plugins/workbuddy/resources/theme-v1.schema.json",
  "package/skills/trae-dream-skin/SKILL.md",
  "package/scripts/start-trae-skin-macos.sh",
  "package/scripts/start-workbuddy-skin-macos.sh",
  "package/assets/renderer-inject.js",
  "package/assets/workbuddy-renderer-inject.js",
]);

const forbiddenPrefixes = [
  "package/desktop/",
  "package/studio/",
  "package/dist-desktop/",
  "package/build/desktop-resources/",
];

export async function verifyCliPackage({ root = projectRoot } = {}) {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  if (packageJson.private === true) throw new Error("CLI package cannot be private.");
  if (packageJson.main) throw new Error("CLI package must not expose a desktop main entry.");
  if (packageJson.bin?.["skin-cli"] !== "./bin/skin-cli.mjs") {
    throw new Error("package.json must expose bin/skin-cli.mjs as skin-cli.");
  }
  const unexpectedCommands = Object.entries(packageJson.bin || {}).filter(
    ([name, entry]) => !["skin-cli", "dreamskin"].includes(name) || entry !== "./bin/skin-cli.mjs",
  );
  if (unexpectedCommands.length) {
    throw new Error("package.json contains a retired or unexpected command entry.");
  }
  const { stdout } = await execFile("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const report = JSON.parse(stdout);
  if (!Array.isArray(report) || report.length !== 1) {
    throw new Error("npm pack returned an unexpected report.");
  }
  const files = new Set(report[0].files.map((entry) => `package/${entry.path}`));
  const missing = [...required].filter((entry) => !files.has(entry));
  const forbidden = [...files].filter((entry) => forbiddenPrefixes.some((prefix) => entry.startsWith(prefix)));
  const unexpectedBins = [...files].filter(
    (entry) => entry.startsWith("package/bin/") && entry !== "package/bin/skin-cli.mjs",
  );
  if (missing.length) throw new Error(`CLI package is missing required files: ${missing.join(", ")}`);
  if (forbidden.length) throw new Error(`CLI package contains retired UI files: ${forbidden.join(", ")}`);
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
