import assert from "node:assert/strict";
import test from "node:test";

import { parseNpmPackJsonReport } from "../scripts/verify-cli-package.mjs";

const report = [{
  name: "workbuddy-skin",
  version: "0.7.0",
  filename: "workbuddy-skin-0.7.0.tgz",
  files: [{ path: "package.json" }],
}];

test("npm pack report parser accepts clean JSON output", () => {
  assert.deepEqual(parseNpmPackJsonReport(`${JSON.stringify(report, null, 2)}\n`), report);
});

test("npm pack report parser selects the final array after lifecycle text and JSON", () => {
  const stdout = [
    "> workbuddy-skin@0.7.0 prepack",
    "> npm run cli:resources",
    JSON.stringify({ event: "prepare", ok: true, outputs: ["runtime"] }),
    "lifecycle completed",
    JSON.stringify(report, null, 2),
    "",
  ].join("\n");
  assert.deepEqual(parseNpmPackJsonReport(stdout), report);
});

test("npm pack report parser rejects missing, malformed, and trailing reports", () => {
  for (const stdout of [
    "",
    '{"event":"prepare","ok":true}\n',
    '[]\n[{"name":"workbuddy-skin"}',
    `${JSON.stringify(report)}\nunexpected trailing output`,
  ]) {
    assert.throws(
      () => parseNpmPackJsonReport(stdout),
      /npm pack .*JSON report array/,
    );
  }
});
