import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createWorkBuddyCliContext,
  resolveWorkBuddyCliPaths,
  WORKBUDDY_PLUGIN_ID,
} from "../src/core/cli-context.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("CLI paths are local to WorkBuddy Skin and expose one target", () => {
  const paths = resolveWorkBuddyCliPaths({
    platform: "darwin",
    homeDir: "/Users/example",
    environment: {
      WORKBUDDY_SKIN_RESOURCE_ROOT: ROOT,
      WORKBUDDY_SKIN_USER_DATA_ROOT: "/tmp/workbuddy-skin-user",
      WORKBUDDY_SKIN_DATA_ROOT: "/tmp/workbuddy-skin-data",
      WORKBUDDY_SKIN_RUNTIME_STATE_ROOT: "/tmp/workbuddy-skin-state",
    },
  });
  assert.equal(paths.resourceRoot, ROOT);
  assert.equal(paths.dataRoot, "/tmp/workbuddy-skin-data");
  assert.equal(paths.runtimeStateRoot, "/tmp/workbuddy-skin-state");
  assert.equal(paths.migratedFromLegacy, false);
  assert.equal(paths.target.pluginId, WORKBUDDY_PLUGIN_ID);
  assert.equal(paths.target.pluginRoot, path.join(ROOT, "plugins", "workbuddy"));
  assert.equal("targets" in paths, false);
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
  assert.match(context.runtimeRoot, /dreamskin\.workbuddy\/versions\/0\.6\.0$/);

  const manifest = JSON.parse(await fs.readFile(
    path.join(context.runtimeRoot, "runtime-manifest.v1.json"),
    "utf8",
  ));
  assert.equal(manifest.namespace, WORKBUDDY_PLUGIN_ID);
  assert.equal(manifest.version, "0.6.0");
  assert.equal(manifest.files.some((entry) => entry.path === "scripts/cdp-client.mjs"), true);
  assert.equal(manifest.files.some((entry) => /trae|windows|\.ps1/i.test(entry.path)), false);

  const inspected = await context.tool.execute({
    action: "inspect",
    pluginId: WORKBUDDY_PLUGIN_ID,
  });
  assert.equal(inspected.target.id, "workbuddy");
  assert.ok(inspected.catalog.templates.length >= 10);
});
