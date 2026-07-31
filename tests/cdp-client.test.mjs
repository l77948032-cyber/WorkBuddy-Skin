import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  browserIdFromVersion,
  captureScreenshot,
  fetchCdpJson,
  isValidPageTarget,
  listPageTargets,
  resolveBrowserIdentity,
  validatedDebuggerUrl,
} from "../scripts/cdp-client.mjs";

const PORT = 19432;

function pageTarget(overrides = {}) {
  return {
    id: "PAGE_1",
    type: "page",
    title: "WorkBuddy",
    url: "file:///Applications/WorkBuddy.app/renderer/index.html",
    webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/PAGE_1`,
    ...overrides,
  };
}

function response(value, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(value),
  };
}

test("CDP URLs are restricted to the expected loopback port and endpoint shape", () => {
  const target = pageTarget();
  assert.equal(
    validatedDebuggerUrl(target, PORT, "page"),
    `ws://127.0.0.1:${PORT}/devtools/page/PAGE_1`,
  );
  assert.equal(isValidPageTarget(target, PORT), true);
  for (const webSocketDebuggerUrl of [
    `ws://example.com:${PORT}/devtools/page/PAGE_1`,
    `wss://127.0.0.1:${PORT}/devtools/page/PAGE_1`,
    `ws://127.0.0.1:${PORT + 1}/devtools/page/PAGE_1`,
    `ws://127.0.0.1:${PORT}/devtools/page/../browser/OTHER`,
    `ws://user:pass@127.0.0.1:${PORT}/devtools/page/PAGE_1`,
  ]) {
    assert.throws(() => validatedDebuggerUrl({ webSocketDebuggerUrl }, PORT, "page"));
  }
  assert.equal(isValidPageTarget({ ...target, id: "OTHER" }, PORT), false);
  assert.equal(isValidPageTarget({ ...target, type: "worker" }, PORT), false);
});

test("browser identity and page listing use only bounded CDP JSON endpoints", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/json/version")) {
      return response({
        Browser: "WorkBuddy/5.3.5",
        webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/browser/BROWSER_1`,
      });
    }
    return response([
      pageTarget(),
      pageTarget({
        id: "BAD",
        webSocketDebuggerUrl: `ws://example.com:${PORT}/devtools/page/BAD`,
      }),
    ]);
  };
  const identity = await resolveBrowserIdentity(PORT, "BROWSER_1", fetchImpl);
  assert.equal(identity.browserId, "BROWSER_1");
  assert.equal(identity.product, "WorkBuddy/5.3.5");
  assert.equal(browserIdFromVersion({
    webSocketDebuggerUrl: `ws://localhost:${PORT}/devtools/browser/BROWSER_1`,
  }, PORT), "BROWSER_1");
  assert.deepEqual(await listPageTargets(PORT, null, fetchImpl), [pageTarget()]);
  assert.deepEqual(calls.map(({ url }) => url), [
    `http://127.0.0.1:${PORT}/json/version`,
    `http://127.0.0.1:${PORT}/json/list`,
  ]);
  assert.ok(calls.every(({ options }) => options.redirect === "error"));
  await assert.rejects(
    () => resolveBrowserIdentity(PORT, "OTHER", fetchImpl),
    /identity changed/,
  );
  await assert.rejects(
    () => fetchCdpJson(PORT, "/json/protocol", fetchImpl),
    /unsupported CDP JSON resource/,
  );
});

test("screenshots are validated as PNG before being written", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-cdp-shot-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
  const output = path.join(root, "nested", "shot.png");
  const result = await captureScreenshot({
    send: async () => ({ data: png.toString("base64") }),
  }, output);
  assert.equal(result.path, output);
  assert.deepEqual(await fs.readFile(output), png);
  await assert.rejects(
    () => captureScreenshot({
      send: async () => ({ data: Buffer.from("not png").toString("base64") }),
    }, path.join(root, "bad.png")),
    /invalid PNG/,
  );
});
