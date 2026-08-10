import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  dispatchCli,
  DREAMSKIN_CLI_PROTOCOL_VERSION,
  runCli,
} from "../src/cli.mjs";
import { AGENT_TOOL_VERSION } from "../src/core/service.mjs";

const PLUGIN_ID = "dreamskin.workbuddy";

function fakeRuntime() {
  const calls = [];
  return {
    calls,
    paths: {
      dataRoot: "/tmp/workbuddy-skin/data",
      resourceRoot: "/tmp/workbuddy-skin/package",
      runtimeStateRoot: "/tmp/workbuddy-skin/runtime-state",
      target: { themesRoot: "/tmp/workbuddy-skin/data/themes" },
    },
    runtimeRoot: `/tmp/workbuddy-skin/runtime/${AGENT_TOOL_VERSION}`,
    target: {
      pluginId: PLUGIN_ID,
      targetId: "workbuddy",
      name: "WorkBuddy",
      version: AGENT_TOOL_VERSION,
      supported: true,
      platforms: ["darwin", "win32"],
    },
    tool: {
      execute: async (input) => {
        calls.push(["tool", input]);
        if (input.action === "inspect") {
          return { catalog: { count: 1, themes: [{ id: "orchid-night" }] } };
        }
        return input;
      },
    },
    runtime: {
      status: async (pluginId) => {
        calls.push(["status", pluginId]);
        return { session: "native" };
      },
      apply: async (themeId, pluginId) => {
        calls.push(["apply", themeId, pluginId]);
        return { themeId };
      },
      verify: async (options, pluginId) => {
        calls.push(["verify", options, pluginId]);
        return { pass: true };
      },
      preview: async (options, pluginId) => {
        calls.push(["preview", options, pluginId]);
        return { id: options.id };
      },
      restore: async (pluginId) => {
        calls.push(["restore", pluginId]);
        return { restored: true };
      },
    },
  };
}

async function invoke(argv, runtime = fakeRuntime(), stdin = async () => "") {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(argv, runtime, {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
    stdin,
  });
  return { exitCode, envelope: JSON.parse(stdout), stderr, runtime };
}

test("standalone help and version expose only workbuddy-skin", async () => {
  const help = await dispatchCli([], null, {});
  assert.equal(help.result.command, "workbuddy-skin");
  assert.equal(help.result.usage.every((line) => line.startsWith("workbuddy-skin ")), true);
  assert.equal(help.result.usage.some((line) => /--target|--edition|skin-cli/.test(line)), false);

  const version = await dispatchCli(["--version"], null, {});
  assert.deepEqual(version.result, {
    version: AGENT_TOOL_VERSION,
    protocolVersion: DREAMSKIN_CLI_PROTOCOL_VERSION,
  });
});

test("retired target and edition options are rejected for every command", async () => {
  for (const argv of [
    ["templates", "--target", "workbuddy"],
    ["theme", "list", "--plugin", PLUGIN_ID],
    ["status", "--edition", "auto"],
    ["--help", "--target", "workbuddy"],
  ]) {
    const result = await invoke(argv);
    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
    assert.equal(result.envelope.error.code, "INVALID_ARGUMENT");
  }
});

test("paths reports one fixed WorkBuddy target", async () => {
  const { envelope } = await invoke(["paths"]);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.scope, { pluginId: PLUGIN_ID });
  assert.equal(envelope.result.pluginId, PLUGIN_ID);
  assert.equal(envelope.result.themesRoot, "/tmp/workbuddy-skin/data/themes");
  assert.equal(envelope.result.runtimeRoot, `/tmp/workbuddy-skin/runtime/${AGENT_TOOL_VERSION}`);
});

test("templates and installs always address dreamskin.workbuddy", async () => {
  const runtime = fakeRuntime();
  const templates = await invoke(["templates"], runtime);
  assert.equal(templates.envelope.result.count, 1);
  assert.equal(runtime.calls[0][1].pluginId, PLUGIN_ID);

  const installed = await invoke([
    "template", "install", "orchid-night", "--as", "my-night",
    "--input", '{"name":"My Night"}', "--dry-run",
  ], runtime);
  assert.equal(installed.envelope.ok, true);
  assert.deepEqual(runtime.calls.at(-1)[1], {
    action: "create",
    pluginId: PLUGIN_ID,
    themeId: "my-night",
    sourceId: "orchid-night",
    themePatch: { name: "My Night" },
    dryRun: true,
  });
});

test("theme updates preserve revision protection and fixed plugin scope", async () => {
  const runtime = fakeRuntime();
  const revision = "a".repeat(64);
  const result = await invoke([
    "theme", "update", "my-night",
    "--expected-revision", revision,
    "--input", '{"colors":{"accent":"#AABBCC"}}',
  ], runtime);
  assert.equal(result.envelope.ok, true);
  assert.deepEqual(runtime.calls[0][1], {
    action: "update",
    pluginId: PLUGIN_ID,
    themeId: "my-night",
    expectedRevision: revision,
    themePatch: { colors: { accent: "#AABBCC" } },
  });

  const missingRevision = await invoke([
    "theme", "update", "my-night", "--input", "{}",
  ], runtime);
  assert.equal(missingRevision.exitCode, 1);
  assert.match(missingRevision.envelope.error.message, /expected-revision/);
});

test("runtime commands forward only the WorkBuddy plugin id", async () => {
  const runtime = fakeRuntime();
  await invoke(["status"], runtime);
  await invoke(["apply", "my-night"], runtime);
  await invoke(["verify", "--screenshot", "./capture.png"], runtime);
  await invoke(["preview", "my-night"], runtime);
  await invoke(["restore"], runtime);
  assert.deepEqual(runtime.calls[0], ["status", PLUGIN_ID]);
  assert.deepEqual(runtime.calls[1], ["apply", "my-night", PLUGIN_ID]);
  assert.equal(runtime.calls[2][0], "verify");
  assert.equal(runtime.calls[2][1].screenshotPath, path.resolve("./capture.png"));
  assert.equal(runtime.calls[2][2], PLUGIN_ID);
  assert.deepEqual(runtime.calls[3], [
    "preview",
    { id: "my-night", screenshot: true },
    PLUGIN_ID,
  ]);
  assert.deepEqual(runtime.calls[4], ["restore", PLUGIN_ID]);
});

test("CLI writes exactly one JSON failure envelope", async () => {
  const result = await invoke(["unknown"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.envelope.protocolVersion, 1);
  assert.equal(result.envelope.ok, false);
  assert.deepEqual(result.envelope.scope, { pluginId: PLUGIN_ID });
  assert.equal(result.stderr, "");
});
