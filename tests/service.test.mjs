import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkBuddySkinService } from "../src/core/service.mjs";
import { WorkBuddyPlatformRuntime } from "../src/core/workbuddy-platform.mjs";

const PREVIOUS_REVISION = "a".repeat(64);
const CANDIDATE_REVISION = "b".repeat(64);

test("delete refuses active or ambiguous runtime themes and preserves revision checks", async () => {
  const deleted = [];
  const repository = {
    withLock: async (action) => action(),
    delete: async (id, options) => {
      deleted.push([id, options]);
      return { deleted: true, id, ...options };
    },
  };
  const sessions = [
    { session: "active", themeId: "active-theme", themeRevision: PREVIOUS_REVISION },
    { session: "orphaned" },
    { session: "off" },
  ];
  const service = new WorkBuddySkinService({
    repository,
    runtime: {
      descriptor: () => ({ platform: "test", supported: true }),
      status: async () => sessions.shift(),
    },
  });

  await assert.rejects(
    () => service.themeDelete("active-theme", { expectedRevision: PREVIOUS_REVISION }),
    (error) => error.code === "THEME_ACTIVE" && error.details.themeId === "active-theme",
  );
  await assert.rejects(
    () => service.themeDelete("other-theme", { expectedRevision: PREVIOUS_REVISION }),
    (error) => error.code === "THEME_ACTIVE" && error.details.runtimeSession === "orphaned",
  );
  assert.deepEqual(
    await service.themeDelete("inactive-theme", { expectedRevision: CANDIDATE_REVISION }),
    { deleted: true, id: "inactive-theme", expectedRevision: CANDIDATE_REVISION },
  );
  assert.deepEqual(deleted, [["inactive-theme", { expectedRevision: CANDIDATE_REVISION }]]);
});

test("preview restores the previous active theme after verification", async () => {
  const calls = [];
  let repositoryLocked = false;
  const runtime = {
    descriptor: () => ({ platform: "test", supported: true }),
    status: async () => ({
      session: "active",
      themeId: "previous",
      themeRevision: PREVIOUS_REVISION,
    }),
    apply: async (id, options) => {
      assert.equal(repositoryLocked, true);
      calls.push(["apply", id, options]);
      return { applied: true, themeId: id };
    },
    verify: async ({ screenshotPath }) => {
      calls.push(["verify", screenshotPath]);
      return { mode: "verify", targets: [{ result: { pass: true } }] };
    },
    restore: async () => { calls.push(["restore"]); return { restored: true }; },
  };
  const repository = {
    withLock: async (action) => {
      assert.equal(repositoryLocked, false);
      repositoryLocked = true;
      try {
        return await action();
      } finally {
        repositoryLocked = false;
      }
    },
    read: async (id) => {
      assert.equal(repositoryLocked, true);
      return {
        id,
        revision: id === "previous" ? PREVIOUS_REVISION : CANDIDATE_REVISION,
      };
    },
  };
  const service = new WorkBuddySkinService({ repository, runtime });
  const result = await service.preview("candidate", { screenshot: false });
  assert.equal(result.restoration.themeId, "previous");
  assert.equal(result.restoration.revision, PREVIOUS_REVISION);
  assert.deepEqual(calls, [
    ["apply", "candidate", { revision: CANDIDATE_REVISION }],
    ["verify", undefined],
    ["apply", "previous", { revision: PREVIOUS_REVISION }],
  ]);
  assert.equal(repositoryLocked, false);
});

test("preview repairs and restores the previous degraded theme", async () => {
  const calls = [];
  const runtime = {
    descriptor: () => ({ platform: "test", supported: true }),
    status: async () => ({
      session: "degraded",
      themeId: "previous",
      themeRevision: PREVIOUS_REVISION,
    }),
    apply: async (id, options) => { calls.push(["apply", id, options]); },
    verify: async () => ({ targets: [{ result: { pass: true } }] }),
    restore: async () => { calls.push(["restore"]); },
  };
  const repository = {
    read: async (id) => ({
      id,
      revision: id === "previous" ? PREVIOUS_REVISION : CANDIDATE_REVISION,
    }),
  };
  const service = new WorkBuddySkinService({ repository, runtime });

  const result = await service.preview("candidate", { screenshot: false });
  assert.equal(result.restoration.mode, "theme");
  assert.equal(result.restoration.themeId, "previous");
  assert.deepEqual(calls, [
    ["apply", "candidate", { revision: CANDIDATE_REVISION }],
    ["apply", "previous", { revision: PREVIOUS_REVISION }],
  ]);
});

test("preview restores native state when no skin was active", async () => {
  const calls = [];
  const runtime = {
    descriptor: () => ({ platform: "test", supported: true }),
    status: async () => ({ session: "off" }),
    apply: async (id) => { calls.push(["apply", id]); },
    verify: async () => ({ targets: [{ result: { pass: true } }] }),
    restore: async () => { calls.push(["restore"]); },
  };
  const service = new WorkBuddySkinService({
    repository: { read: async (id) => ({ id, revision: CANDIDATE_REVISION }) },
    runtime,
  });
  const result = await service.preview("candidate", { screenshot: false });
  assert.equal(result.restoration.mode, "native");
  assert.deepEqual(calls, [["apply", "candidate"], ["restore"]]);
});

test("preview fails before switching when the active revision cannot be restored exactly", async () => {
  const calls = [];
  const runtime = {
    descriptor: () => ({ platform: "test", supported: true }),
    status: async () => ({
      session: "active",
      themeId: "previous",
      themeRevision: PREVIOUS_REVISION,
    }),
    apply: async (...args) => calls.push(["apply", ...args]),
    verify: async () => ({ targets: [{ result: { pass: true } }] }),
    restore: async () => calls.push(["restore"]),
  };
  const repository = {
    read: async (id) => ({
      id,
      revision: id === "previous" ? "c".repeat(64) : CANDIDATE_REVISION,
    }),
  };
  const service = new WorkBuddySkinService({ repository, runtime });

  await assert.rejects(
    () => service.preview("candidate", { screenshot: false }),
    (error) => error.code === "PREVIEW_STATE_UNRESTORABLE"
      && error.details.activeRevision === PREVIOUS_REVISION
      && error.details.repositoryRevision === "c".repeat(64),
  );
  assert.deepEqual(calls, []);
});

test("WorkBuddy apply commands carry a validated theme revision on macOS", () => {
  const darwin = new WorkBuddyPlatformRuntime({
    platform: "darwin",
    scriptsRoot: "/runtime/scripts",
  });

  assert.deepEqual(
    darwin.command("apply", { themeId: "fixture", themeRevision: CANDIDATE_REVISION }).args.slice(-4),
    ["--theme", "fixture", "--revision", CANDIDATE_REVISION],
  );
  assert.throws(
    () => darwin.command("apply", { themeId: "fixture", themeRevision: "stale" }),
    (error) => error.code === "INVALID_ARGUMENT",
  );
});

test("inspect exposes semantic components without leaking runtime selectors", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-inspect-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registryPath = path.join(root, "registry.json");
  const runtimeMappingPath = path.join(root, "runtime-mapping.json");
  const schemaPath = path.join(root, "schema.json");
  await fs.writeFile(registryPath, JSON.stringify({
    schemaVersion: 1,
    components: [{ id: "composer.surface", states: ["focus"], selectors: [".private-selector"] }],
  }));
  await fs.writeFile(runtimeMappingPath, "{}");
  await fs.writeFile(schemaPath, "{}");
  const service = new WorkBuddySkinService({
    repository: { list: async () => ({ themes: [] }) },
    runtime: { descriptor: () => ({ platform: "test", supported: false }) },
    registryPath,
    runtimeMappingPath,
    schemaPath,
  });
  const result = await service.inspect();
  assert.equal(result.registry.components[0].id, "composer.surface");
  assert.equal(result.registry.components[0].runtimeMappingCount, 1);
  assert.equal("selectors" in result.registry.components[0], false);
  const toolResult = await service.toolInspect();
  assert.equal(toolResult.safety.runtimeActionsExposedToCli, true);
  assert.equal("runtimeActionsExposedToAgent" in toolResult.safety, false);
});
