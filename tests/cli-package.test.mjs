import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";

async function jsonCommand(command, args, options) {
  const { stdout, stderr } = await execFile(command, args, {
    ...options,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(stderr, "");
  return JSON.parse(stdout);
}

async function rejectedJsonCommand(command, args, options) {
  try {
    await execFile(command, args, {
      ...options,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    return JSON.parse(error.stdout);
  }
  assert.fail(`Expected command to fail: ${args.join(" ")}`);
}

test("npm tarball installs one standalone WorkBuddy command and runtime", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-cli-package-"));
  const packageDirectory = path.join(root, "package");
  const prefix = path.join(root, "global");
  const dataRoot = path.join(root, "data");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(packageDirectory, { recursive: true });

  const packageMetadata = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  await execFile(NPM_COMMAND, [
    "pack",
    "--ignore-scripts",
    "--pack-destination",
    packageDirectory,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...(process.platform === "win32" ? { shell: true } : {}),
  });
  const tarballs = (await fs.readdir(packageDirectory)).filter((file) => file.endsWith(".tgz"));
  assert.deepEqual(tarballs, [`${packageMetadata.name}-${packageMetadata.version}.tgz`]);

  await execFile(NPM_COMMAND, [
    "install",
    "--global",
    "--prefix",
    prefix,
    "--ignore-scripts",
    path.join(packageDirectory, tarballs[0]),
  ], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...(process.platform === "win32" ? { shell: true } : {}),
  });

  const command = process.platform === "win32"
    ? path.join(prefix, "workbuddy-skin.cmd")
    : path.join(prefix, "bin", "workbuddy-skin");
  await fs.access(command);
  const environment = {
    ...process.env,
    WORKBUDDY_SKIN_DATA_ROOT: dataRoot,
    WORKBUDDY_SKIN_RUNTIME_STATE_ROOT: path.join(root, "runtime-state"),
  };
  const commandOptions = {
    env: environment,
    ...(process.platform === "win32" ? { shell: true } : {}),
  };
  const version = await jsonCommand(command, ["--version"], commandOptions);
  assert.equal(version.result.version, packageMetadata.version);

  const paths = await jsonCommand(command, ["paths"], commandOptions);
  assert.equal(paths.result.pluginId, "dreamskin.workbuddy");
  const templates = await jsonCommand(command, ["templates"], commandOptions);
  assert.ok(templates.result.templates.some(({ id }) => id === "paper-garden"));

  const created = await jsonCommand(command, [
    "template", "install", "paper-garden", "--as", "tarball-theme",
  ], commandOptions);
  assert.equal(created.scope.themeId, "tarball-theme");
  const read = await jsonCommand(command, [
    "theme", "read", "tarball-theme",
  ], commandOptions);
  assert.equal(read.result.theme.id, "tarball-theme");

  for (const args of [
    ["templates", "--target", "workbuddy"],
    ["status", "--edition", "auto"],
  ]) {
    const failed = await rejectedJsonCommand(command, args, commandOptions);
    assert.equal(failed.error.code, "INVALID_ARGUMENT");
  }

  await fs.access(path.join(
    dataRoot,
    "runtime",
    "dreamskin.workbuddy",
    "versions",
    packageMetadata.version,
  ));
  await assert.rejects(() => fs.access(path.join(dataRoot, "runtime", "dreamskin.trae")));
});
