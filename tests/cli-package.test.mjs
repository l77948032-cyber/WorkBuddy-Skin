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

async function jsonCommand(command, args, options) {
  const { stdout, stderr } = await execFile(command, args, {
    ...options,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(stderr, "");
  return JSON.parse(stdout);
}

test("npm tarball installs globally and runs the standalone CLI lifecycle", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamskin-cli-package-"));
  const packageDirectory = path.join(root, "package");
  const prefix = path.join(root, "global");
  const dataRoot = path.join(root, "data");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(packageDirectory, { recursive: true });

  const packageMetadata = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  await execFile("npm", [
    "pack",
    "--ignore-scripts",
    "--pack-destination",
    packageDirectory,
  ], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const tarballs = (await fs.readdir(packageDirectory)).filter((file) => file.endsWith(".tgz"));
  assert.deepEqual(tarballs, [`${packageMetadata.name}-${packageMetadata.version}.tgz`]);
  const tarball = path.join(packageDirectory, tarballs[0]);
  await fs.access(tarball);

  await execFile("npm", [
    "install",
    "--global",
    "--prefix",
    prefix,
    "--ignore-scripts",
    tarball,
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

  const command = path.join(prefix, "bin", "skin-cli");
  const environment = {
    ...process.env,
    DREAMSKIN_USER_DATA_ROOT: dataRoot,
  };
  const version = await jsonCommand(command, ["version"], { env: environment });
  assert.equal(version.ok, true);
  assert.equal(version.result.version, packageMetadata.version);
  const aliasVersion = await jsonCommand(
    path.join(prefix, "bin", "dreamskin"),
    ["version"],
    { env: environment },
  );
  assert.deepEqual(aliasVersion, version);

  const targets = await jsonCommand(command, ["targets"], { env: environment });
  assert.equal(targets.ok, true);
  assert.deepEqual(
    targets.result.targets.map(({ targetId }) => targetId).sort(),
    ["trae", "workbuddy"],
  );
  const paths = await jsonCommand(command, ["paths"], { env: environment });
  assert.equal(paths.ok, true);

  const templates = await jsonCommand(command, ["templates", "--target", "trae"], { env: environment });
  assert.equal(templates.ok, true);
  assert.ok(templates.result.templates.some(({ id }) => id === "paper-aurora"));

  const created = await jsonCommand(command, [
    "template",
    "install",
    "paper-aurora",
    "--as",
    "tarball-theme",
    "--target",
    "trae",
  ], { env: environment });
  assert.equal(created.ok, true);
  assert.equal(created.scope.themeId, "tarball-theme");

  const read = await jsonCommand(command, [
    "theme",
    "read",
    "tarball-theme",
    "--target",
    "trae",
  ], { env: environment });
  assert.equal(read.ok, true);
  assert.equal(read.result.theme.id, "tarball-theme");
  await fs.access(path.join(
    paths.result.dataRoot,
    "runtime",
    "dreamskin.trae",
    "versions",
    packageMetadata.version,
  ));
  await fs.access(path.join(
    paths.result.dataRoot,
    "runtime",
    "dreamskin.workbuddy",
    "versions",
    packageMetadata.version,
  ));
});
