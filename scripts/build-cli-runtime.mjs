import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutRoot = path.join(projectRoot, "build", "cli-runtime");

const runtimeFiles = Object.freeze([
  "assets/workbuddy-renderer-inject.js",
  "plugins/workbuddy/assets/workbuddy-skin.css",
  "plugins/workbuddy/resources/components.v1.json",
  "scripts/cdp-client.mjs",
  "scripts/common-workbuddy-macos.sh",
  "scripts/start-workbuddy-skin-macos.sh",
  "scripts/status-workbuddy-skin-macos.sh",
  "scripts/stop-workbuddy-skin-macos.sh",
  "scripts/verify-workbuddy-skin-macos.sh",
  "scripts/workbuddy-injector.mjs",
  "src/core/paths.mjs",
  "src/core/theme-loader.mjs",
  "src/core/theme-model.mjs",
]);

const WORKBUDDY_NAMESPACE = "dreamskin.workbuddy";

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function portablePath(value) {
  return value.split(path.sep).join("/");
}

async function copyRuntime(version, outRoot) {
  const namespace = WORKBUDDY_NAMESPACE;
  const targetRoot = path.join(outRoot, namespace);
  await fs.mkdir(targetRoot, { recursive: true, mode: 0o700 });
  const records = [];
  for (const relativePath of runtimeFiles) {
    const source = path.join(projectRoot, relativePath);
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`CLI runtime source must be a regular file: ${relativePath}`);
    }
    const buffer = await fs.readFile(source);
    const target = path.join(targetRoot, relativePath);
    const mode = relativePath.endsWith(".sh") ? 0o755 : 0o644;
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, buffer, { mode });
    await fs.chmod(target, mode);
    records.push({
      path: portablePath(relativePath),
      sha256: sha256(buffer),
      bytes: buffer.length,
      mode,
    });
  }
  const manifest = {
    schemaVersion: 1,
    namespace,
    version,
    files: records,
  };
  await fs.writeFile(
    path.join(targetRoot, "runtime-manifest.v1.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  return {
    namespace,
    root: targetRoot,
    files: records.length,
    bytes: records.reduce((total, entry) => total + entry.bytes, 0),
  };
}

export async function buildCliRuntime({
  outRoot = defaultOutRoot,
  version,
} = {}) {
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
  const runtimeVersion = version || packageJson.version;
  await fs.rm(outRoot, { recursive: true, force: true });
  await fs.mkdir(outRoot, { recursive: true, mode: 0o700 });
  const runtimes = [await copyRuntime(runtimeVersion, outRoot)];
  return {
    ok: true,
    version: runtimeVersion,
    outRoot,
    runtimes,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildCliRuntime()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
