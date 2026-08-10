import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createWorkBuddyCliContext,
  resolveWorkBuddyCliPaths,
  WORKBUDDY_PLUGIN_ID,
} from "../src/core/cli-context.mjs";
import { runtimeStateRoot } from "../src/core/paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));

test("CLI paths are local to WorkBuddy Skin and expose one target", () => {
  const userDataRoot = path.join(os.tmpdir(), "workbuddy-skin-user");
  const dataRoot = path.join(os.tmpdir(), "workbuddy-skin-data");
  const runtimeStateRoot = path.join(os.tmpdir(), "workbuddy-skin-state");
  const paths = resolveWorkBuddyCliPaths({
    platform: "darwin",
    homeDir: path.join(path.parse(process.cwd()).root, "Users", "example"),
    environment: {
      WORKBUDDY_SKIN_RESOURCE_ROOT: ROOT,
      WORKBUDDY_SKIN_USER_DATA_ROOT: userDataRoot,
      WORKBUDDY_SKIN_DATA_ROOT: dataRoot,
      WORKBUDDY_SKIN_RUNTIME_STATE_ROOT: runtimeStateRoot,
    },
  });
  assert.equal(paths.resourceRoot, ROOT);
  assert.equal(paths.dataRoot, dataRoot);
  assert.equal(paths.runtimeStateRoot, runtimeStateRoot);
  assert.equal(paths.migratedFromLegacy, false);
  assert.equal(paths.target.pluginId, WORKBUDDY_PLUGIN_ID);
  assert.equal(paths.target.pluginRoot, path.join(ROOT, "plugins", "workbuddy"));
  assert.equal("targets" in paths, false);
});

test("Windows CLI paths use APPDATA for user data and LOCALAPPDATA for runtime state", () => {
  const paths = resolveWorkBuddyCliPaths({
    platform: "win32",
    homeDir: "C:\\Users\\example",
    environment: {
      WORKBUDDY_SKIN_RESOURCE_ROOT: ROOT,
      APPDATA: "D:\\Profiles\\Roaming",
      LOCALAPPDATA: "D:\\Profiles\\Local",
    },
  });

  assert.equal(paths.userDataRoot, "D:\\Profiles\\Roaming\\WorkBuddy Skin");
  assert.equal(paths.dataRoot, "D:\\Profiles\\Roaming\\WorkBuddy Skin\\data");
  assert.equal(paths.runtimeStateRoot, "D:\\Profiles\\Local\\WorkBuddyDreamSkin");
  assert.equal(
    paths.target.themesRoot,
    "D:\\Profiles\\Roaming\\WorkBuddy Skin\\data\\themes",
  );
  assert.equal(
    paths.target.manifestPath,
    "D:\\Profiles\\Roaming\\WorkBuddy Skin\\data\\state\\dreamskin.workbuddy\\library.json",
  );

  const fallback = resolveWorkBuddyCliPaths({
    platform: "win32",
    homeDir: "C:\\Users\\fallback",
    environment: { WORKBUDDY_SKIN_RESOURCE_ROOT: ROOT },
  });
  assert.equal(
    fallback.userDataRoot,
    "C:\\Users\\fallback\\AppData\\Roaming\\WorkBuddy Skin",
  );
  assert.equal(
    fallback.runtimeStateRoot,
    "C:\\Users\\fallback\\AppData\\Local\\WorkBuddyDreamSkin",
  );
  assert.equal(
    runtimeStateRoot("win32", "C:\\Users\\example", {
      LOCALAPPDATA: "E:\\WorkBuddy\\Local",
    }),
    "E:\\WorkBuddy\\Local\\WorkBuddyDreamSkin",
  );
});

test("CLI reuses pre-split WorkBuddy themes and runtime state", async (t) => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-legacy-paths-"));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  const legacyDataRoot = path.join(
    homeDir,
    "Library",
    "Application Support",
    "DreamSkin Studio",
    "dreamskin",
  );
  await fs.mkdir(
    path.join(legacyDataRoot, "themes", WORKBUDDY_PLUGIN_ID, "my-existing-theme"),
    { recursive: true },
  );

  const paths = resolveWorkBuddyCliPaths({
    platform: "darwin",
    homeDir,
    environment: { WORKBUDDY_SKIN_RESOURCE_ROOT: ROOT },
  });

  assert.equal(paths.migratedFromLegacy, true);
  assert.equal(paths.dataRoot, legacyDataRoot);
  assert.equal(
    paths.target.themesRoot,
    path.join(legacyDataRoot, "themes", WORKBUDDY_PLUGIN_ID),
  );
  assert.equal(
    paths.target.backupsRoot,
    path.join(legacyDataRoot, "backups", WORKBUDDY_PLUGIN_ID),
  );
  assert.equal(
    paths.runtimeStateRoot,
    path.join(homeDir, "Library", "Application Support", "WorkBuddyDreamSkin"),
  );
});

test("CLI context installs and activates only the WorkBuddy runtime", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-cli-context-"));
  const previousStateHome = process.env.WORKBUDDY_DREAM_SKIN_HOME;
  t.after(async () => {
    if (previousStateHome === undefined) delete process.env.WORKBUDDY_DREAM_SKIN_HOME;
    else process.env.WORKBUDDY_DREAM_SKIN_HOME = previousStateHome;
    await fs.rm(root, { recursive: true, force: true });
  });
  const context = await createWorkBuddyCliContext({
    platform: "darwin",
    homeDir: root,
    environment: {
      WORKBUDDY_SKIN_RESOURCE_ROOT: ROOT,
      WORKBUDDY_SKIN_USER_DATA_ROOT: path.join(root, "user"),
      WORKBUDDY_SKIN_DATA_ROOT: path.join(root, "data"),
      WORKBUDDY_SKIN_RUNTIME_STATE_ROOT: path.join(root, "state"),
    },
  });
  t.after(() => context.close());

  assert.deepEqual(context.context.pluginManager.list().map((entry) => entry.id), [
    WORKBUDDY_PLUGIN_ID,
  ]);
  assert.equal(context.target.pluginId, WORKBUDDY_PLUGIN_ID);
  assert.equal(context.target.targetId, "workbuddy");
  assert.equal(context.target.active, undefined);
  assert.equal(context.runtimeRoot, path.join(
    root,
    "data",
    "runtime",
    WORKBUDDY_PLUGIN_ID,
    "versions",
    PACKAGE.version,
  ));

  const manifest = JSON.parse(await fs.readFile(
    path.join(context.runtimeRoot, "runtime-manifest.v1.json"),
    "utf8",
  ));
  assert.equal(manifest.namespace, WORKBUDDY_PLUGIN_ID);
  assert.equal(manifest.version, PACKAGE.version);
  assert.equal(manifest.files.some((entry) => entry.path === "scripts/cdp-client.mjs"), true);
  assert.equal(
    manifest.files.some((entry) => entry.path === "scripts/workbuddy-runtime-windows.mjs"),
    true,
  );
  assert.equal(manifest.files.some((entry) => /trae|\.ps1/i.test(entry.path)), false);

  const inspected = await context.tool.execute({
    action: "inspect",
    pluginId: WORKBUDDY_PLUGIN_ID,
  });
  assert.equal(inspected.target.id, "workbuddy");
  assert.ok(inspected.catalog.templates.length >= 10);
});
