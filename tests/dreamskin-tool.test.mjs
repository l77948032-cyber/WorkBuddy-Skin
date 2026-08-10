import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApplicationContext } from "../src/core/application-context.mjs";
import { DreamSkinToolCore } from "../src/core/dreamskin-tool.mjs";

const PLUGIN_ID = "dreamskin.workbuddy";

test("DreamSkin Tool normalizes structured WorkBuddy actions", async () => {
  const calls = [];
  const tool = new DreamSkinToolCore({
    defaultPluginId: PLUGIN_ID,
    pluginManager: {
      runThemeAction: async (pluginId, action, input) => {
        calls.push({ pluginId, action, input });
        return { pluginId, action, input };
      },
    },
  });
  await tool.execute({ action: "inspect" });
  await tool.execute({ action: "read", themeId: "night" });
  await tool.execute({
    action: "update",
    themeId: "night",
    expectedRevision: "revision",
    themePatch: { name: "Night" },
  });
  assert.deepEqual(calls, [
    { pluginId: PLUGIN_ID, action: "inspect", input: {} },
    { pluginId: PLUGIN_ID, action: "read", input: { id: "night" } },
    {
      pluginId: PLUGIN_ID,
      action: "update",
      input: {
        id: "night",
        expectedRevision: "revision",
        themePatch: { name: "Night" },
      },
    },
  ]);
  assert.throws(
    () => tool.execute({ action: "update", themeId: "night", themePatch: {} }),
    (error) => error.code === "INVALID_TOOL_INPUT",
  );
  assert.throws(
    () => tool.execute({ action: "inspect", surprise: true }),
    (error) => error.code === "INVALID_TOOL_INPUT",
  );
});

test("application context activates one WorkBuddy target and exposes thin managers", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-app-context-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "schema.json"), "{}\n");
  await fs.writeFile(path.join(root, "registry.json"), "{}\n");
  const calls = [];
  const repository = {};
  const targetService = {};
  const plugin = {
    manifest: {
      schemaVersion: 1,
      id: PLUGIN_ID,
      name: "WorkBuddy",
      version: "1.0.0",
      target: { id: "workbuddy", name: "WorkBuddy", platforms: ["darwin"] },
      theme: { schemaPath: "schema.json", registryPath: "registry.json" },
      themeTool: { name: "dreamskin_theme", actions: ["inspect"] },
      capabilities: {
        preview: { supported: false, screenshot: false, restoresPreviousState: false },
        runtime: { supported: true, actions: ["apply", "restore"] },
      },
    },
    rootPath: root,
    activate: async () => { calls.push("activate"); },
    deactivate: async () => { calls.push("deactivate"); },
    executeThemeAction: async () => ({ target: "workbuddy" }),
    executeRuntimeAction: async (action, input) => ({ action, input }),
    runtimeStatus: async () => ({ session: "native" }),
  };
  const context = await createApplicationContext({
    targets: [{
      plugin,
      rootPath: root,
      repository,
      platformRuntime: {},
      targetService,
      catalogRepository: {},
    }],
    defaultPluginId: PLUGIN_ID,
    dataRoot: path.join(root, "data"),
    projectRoot: root,
  });
  t.after(() => context.pluginManager.deactivate(PLUGIN_ID));

  assert.equal(context.defaultPluginId, PLUGIN_ID);
  assert.equal(context.repository, repository);
  assert.equal(context.targetService, targetService);
  assert.deepEqual(await context.tool.inspect(), { target: "workbuddy" });
  assert.deepEqual(await context.runtime.status(), { session: "native" });
  assert.deepEqual(calls, ["activate"]);
});
