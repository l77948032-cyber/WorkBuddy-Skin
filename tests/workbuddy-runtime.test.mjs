import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";

import {
  classifyWorkBuddyProbe,
  isPlausibleWorkBuddyRendererTarget,
  loadWorkBuddyPayload,
  parseWorkBuddyArgs,
  verifyWorkBuddySession,
  workBuddyOneShotPass,
  WORKBUDDY_DEFAULT_PORT,
  WORKBUDDY_SKIN_VERSION,
} from "../scripts/workbuddy-injector.mjs";
import {
  normalizeWorkBuddyRuntimeStatus,
  WorkBuddyPlatformRuntime,
} from "../src/core/workbuddy-platform.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REVISION = "b".repeat(64);
const execFile = promisify(execFileCallback);

function rendererTarget(overrides = {}) {
  return {
    id: "WB123",
    type: "page",
    title: "WorkBuddy",
    url: "file:///Applications/WorkBuddy.app/Contents/Resources/app.asar/renderer/index.html",
    webSocketDebuggerUrl: `ws://127.0.0.1:${WORKBUDDY_DEFAULT_PORT}/devtools/page/WB123`,
    ...overrides,
  };
}

function createVerificationSession({
  backgroundImage = 'url("blob:workbuddy-art")',
  opacity = "0.96",
  width = 1154,
  height = 800,
  visibility = "visible",
  display = "block",
} = {}) {
  const style = {
    textContent: "/* DreamSkin */",
  };
  const root = {
    classList: { contains: (name) => name === "workbuddy-dream-skin" },
    getAttribute: (name) => ({
      "data-workbuddy-skin-theme": "orchid-night",
      "data-workbuddy-skin-compat": "5.2",
      "data-workbuddy-host-version": "5.3.5",
      "data-workbuddy-skin-route": "home",
    })[name] ?? null,
    style: {
      getPropertyValue: (name) => ({
        "--dreamskin-art": 'url("blob:workbuddy-art")',
        "--dreamskin-bg": "#080B18",
        "--dreamskin-panel": "#111528",
        "--dreamskin-accent": "#9A6FF2",
        "--dreamskin-text": "#F3F1FC",
        "--dreamskin-focus": "#46C9DA",
      })[name] ?? "",
    },
  };
  const body = { classList: { contains: (name) => name === "workbuddy-dream-skin-body" } };
  const shell = {
    getBoundingClientRect: () => ({ width, height }),
  };
  const panel = {
    getBoundingClientRect: () => ({ width: 264, height }),
  };
  const content = {
    getBoundingClientRect: () => ({ width: Math.max(0, width - 264), height }),
  };
  const document = {
    documentElement: root,
    body,
    getElementById: (id) => id === "workbuddy-dream-skin-style" ? style : null,
    querySelector: (selector) => ({
      ".teams-container": shell,
      ".conversation-sidebar": panel,
      ".teams-content-wrapper": content,
    })[selector] ?? null,
    querySelectorAll: () => Array.from({ length: 4 }),
  };
  const computed = (node, pseudo) => ({
    display,
    visibility,
    pointerEvents: "auto",
    opacity: pseudo === "::before" ? opacity : "1",
    backgroundImage: pseudo === "::before" ? backgroundImage : "none",
  });
  const context = {
    document,
    getComputedStyle: computed,
    innerWidth: width,
    innerHeight: height,
    Number,
    window: {
      __WORKBUDDY_DREAM_SKIN_STATE__: {
        version: WORKBUDDY_SKIN_VERSION,
        themeId: "orchid-night",
        hostVersion: "5.3.5",
        cleanup() {},
        ensure() {},
      },
    },
  };
  return {
    evaluate: async (expression) => vm.runInNewContext(expression, context),
  };
}

function createTemplateRuntime({ userAgent = "WorkBuddy/5.3.5" } = {}) {
  const attributes = new Map();
  const styleProperties = new Map();
  const styleNode = { id: "", dataset: {}, textContent: "" };
  const root = {
    classList: { add() {}, remove() {} },
    style: {
      setProperty: (name, value) => styleProperties.set(name, value),
      removeProperty: (name) => styleProperties.delete(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name) ?? null,
  };
  const body = { classList: { add() {}, remove() {} } };
  const document = {
    documentElement: root,
    body,
    head: { append: (node) => { Object.assign(styleNode, node); } },
    getElementById: (id) => id === "workbuddy-dream-skin-style" && styleNode.textContent ? styleNode : null,
    createElement: () => ({ id: "", dataset: {}, textContent: "" }),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const context = {
    Blob,
    Uint8Array,
    URL: { createObjectURL: () => "blob:workbuddy-art", revokeObjectURL() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    document,
    navigator: { userAgent },
    atob,
    requestAnimationFrame: (callback) => callback(),
    addEventListener() {},
    removeEventListener() {},
    Element: class {},
    getComputedStyle: () => ({ backgroundImage: "none" }),
  };
  context.window = context;
  return { attributes, context };
}

test("WorkBuddy injector parses scoped assets and rejects unsafe endpoint values", () => {
  const options = parseWorkBuddyArgs([
    "--once",
    "--port", "19432",
    "--browser-id", "browser-1",
    "--target-id", "page-1",
    "--theme-dir", "./theme",
    "--css-path", "./skin.css",
    "--template-path", "./template.js",
    "--registry-path", "./registry.json",
    "--screenshot", "./shot.png",
    "--timeout-ms", "5000",
  ]);
  assert.equal(options.mode, "once");
  assert.equal(options.port, 19432);
  assert.equal(options.browserId, "browser-1");
  assert.equal(options.targetId, "page-1");
  assert.equal(path.basename(options.cssPath), "skin.css");
  assert.equal(path.basename(options.templatePath), "template.js");
  assert.equal(path.basename(options.registryPath), "registry.json");
  assert.equal(path.basename(options.screenshot), "shot.png");
  assert.equal(parseWorkBuddyArgs(["--remove"]).mode, "remove");
  assert.equal(parseWorkBuddyArgs(["--probe-targets"]).mode, "probe");
  assert.throws(() => parseWorkBuddyArgs(["--port", "80"]), /Invalid port/);
  assert.throws(() => parseWorkBuddyArgs(["--browser-id", "bad/id"]), /Invalid browser ID/);
  assert.throws(() => parseWorkBuddyArgs(["--css-path"]), /requires a value/);
});

test("WorkBuddy renderer detection requires the signed-app page shape and stable shell markers", () => {
  const target = rendererTarget();
  assert.equal(isPlausibleWorkBuddyRendererTarget(target), true);
  assert.equal(isPlausibleWorkBuddyRendererTarget({
    ...target,
    url: "https://workbuddy.example/index.html",
  }), false);
  assert.equal(isPlausibleWorkBuddyRendererTarget({
    ...target,
    title: "Unrelated",
    url: "file:///Applications/Other.app/Contents/Resources/app.asar/renderer/index.html",
  }), false);

  const matched = classifyWorkBuddyProbe({
    viewport: { width: 1280, height: 800 },
    markers: {
      root: true,
      teamsContainer: true,
      conversationSidebar: true,
      contentWrapper: true,
      mainContent: true,
      rootChildCount: 1,
      interactiveCount: 12,
    },
  }, target);
  assert.equal(matched.matched, true);
  assert.equal(matched.kind, "workbuddy-workspace");

  const splash = classifyWorkBuddyProbe({
    viewport: { width: 1280, height: 800 },
    markers: { root: true, rootChildCount: 1, interactiveCount: 1 },
  }, target);
  assert.equal(splash.matched, false);
});

test("WorkBuddy one-shot results expose a truthful top-level pass state", () => {
  assert.equal(workBuddyOneShotPass([{ result: { pass: true } }], "verify"), true);
  assert.equal(workBuddyOneShotPass([
    { result: { pass: true } },
    { result: { pass: false } },
  ], "verify"), false);
  assert.equal(workBuddyOneShotPass([], "verify"), false);
  assert.equal(workBuddyOneShotPass([{ result: true }], "remove"), true);
  assert.equal(workBuddyOneShotPass([{ result: false }], "remove"), false);
});

test("WorkBuddy payload resolves canonical CSS, art, theme, and component registry", async () => {
  const payload = await loadWorkBuddyPayload();
  assert.equal(payload.theme.id, "paper-garden");
  assert.ok(payload.imageBytes > 100_000);
  assert.ok(payload.cssBytes > 1_000);
  assert.ok(payload.payloadBytes > payload.imageBytes);
  assert.match(payload.payload, /workbuddy-dream-skin/);
  assert.match(payload.payload, /data:image\/png;base64,/);
  assert.match(payload.payload, /shell\.workspace/);
  assert.doesNotMatch(payload.payload, /__WORKBUDDY_SKIN_(?:CSS|ART|THEME|COMPONENT_REGISTRY|VERSION)_JSON__/);
});

test("WorkBuddy 5.3.5 uses the tested 5.2 structural profile", async () => {
  const payload = await loadWorkBuddyPayload();
  const runtime = createTemplateRuntime({ userAgent: "Mozilla/5.0 WorkBuddy/5.3.5 Chrome/138" });
  vm.runInNewContext(payload.payload, runtime.context);
  assert.equal(runtime.attributes.get("data-workbuddy-skin-compat"), "5.2");
});

test("WorkBuddy verification requires the artwork pseudo-element to render", async () => {
  const rendered = await verifyWorkBuddySession(createVerificationSession(), "orchid-night");
  assert.equal(rendered.artPresent, true);
  assert.equal(rendered.artRendered, true);
  assert.equal(rendered.artLayer.backgroundImage, 'url("blob:workbuddy-art")');
  assert.equal(rendered.pass, true);

  const falsePositive = await verifyWorkBuddySession(createVerificationSession({ backgroundImage: "none" }), "orchid-night");
  assert.equal(falsePositive.artPresent, true, "the configured art variable alone is insufficient");
  assert.equal(falsePositive.artRendered, false);
  assert.equal(falsePositive.pass, false);
});

test("WorkBuddy platform runtime uses target-specific scripts, roots, and revision tracking", async () => {
  const calls = [];
  const runtime = new WorkBuddyPlatformRuntime({
    platform: "darwin",
    scriptsRoot: "/runtime/scripts",
    themesRoot: "/state/themes/workbuddy",
    cssPath: "/runtime/plugins/workbuddy/assets/workbuddy-skin.css",
    templatePath: "/runtime/assets/workbuddy-renderer-inject.js",
    registryPath: "/runtime/plugins/workbuddy/resources/components.v1.json",
    stateRoot: "/state/runtime/workbuddy",
    runner: async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: '{"session":"off"}\n', stderr: "" };
    },
  });
  assert.deepEqual(runtime.descriptor(), {
    platform: "darwin",
    supported: true,
    transport: "loopback-cdp",
    host: "workbuddy",
    minimumTestedHostVersion: "5.2.0",
    appBundleModified: false,
  });
  assert.deepEqual(
    runtime.command("apply", { themeId: "harbor-focus", themeRevision: REVISION }).args.slice(-4),
    ["--theme", "harbor-focus", "--revision", REVISION],
  );
  assert.throws(
    () => runtime.command("apply", { themeId: "harbor-focus", themeRevision: "stale" }),
    (error) => error.code === "INVALID_ARGUMENT",
  );
  assert.deepEqual(await runtime.status(), { session: "off", diagnostics: undefined });
  assert.equal(calls[0].file, "/bin/bash");
  assert.match(calls[0].args[0], /status-workbuddy-skin-macos\.sh$/);
  assert.equal(calls[0].options.env.WORKBUDDY_DREAM_SKIN_THEMES_ROOT, "/state/themes/workbuddy");
  assert.equal(calls[0].options.env.WORKBUDDY_DREAM_SKIN_HOME, "/state/runtime/workbuddy");
});

test("WorkBuddy runtime never reports a dead persistent session as active", () => {
  assert.deepEqual(normalizeWorkBuddyRuntimeStatus({
    session: "active",
    themeId: "harbor-focus",
    injectorAlive: false,
    workbuddyAlive: true,
    cdpOk: true,
    ownedAppJob: true,
    ownedWatcherJob: true,
  }), {
    session: "degraded",
    themeId: "harbor-focus",
    injectorAlive: false,
    workbuddyAlive: true,
    cdpOk: true,
    ownedAppJob: true,
    ownedWatcherJob: true,
  });
  assert.equal(normalizeWorkBuddyRuntimeStatus({
    session: "active",
    injectorAlive: true,
    workbuddyAlive: true,
    cdpOk: true,
    ownedAppJob: true,
    ownedWatcherJob: true,
  }).session, "active");
});

test("WorkBuddy state validation rejects truncated state before status reads fields", async (t) => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-state-validation-"));
  t.after(() => fs.rm(stateRoot, { recursive: true, force: true }));
  const statePath = path.join(stateRoot, "state.json");
  const commonPath = path.join(ROOT, "scripts", "common-workbuddy-macos.sh");
  const validate = () => execFile("/bin/bash", ["-c", [
    'source "$COMMON_PATH"',
    'run_node() { "$TEST_NODE" "$@"; }',
    "workbuddy_state_is_trustworthy",
  ].join("; ")], {
    env: {
      ...process.env,
      COMMON_PATH: commonPath,
      TEST_NODE: process.execPath,
      WORKBUDDY_DREAM_SKIN_HOME: stateRoot,
    },
  });

  await fs.writeFile(statePath, '{"session":"active"');
  await assert.rejects(validate);

  await fs.writeFile(statePath, JSON.stringify({
    schemaVersion: 1,
    session: "active",
    ownsSession: true,
    port: 9432,
    browserId: "browser-1",
    injectorPid: 101,
    injectorStartedAt: "Sun Jul 20 12:00:00 2026",
    workbuddyPid: 102,
    workbuddyStartedAt: "Sun Jul 20 12:00:00 2026",
    workbuddyBundle: "/Applications/WorkBuddy.app",
    workbuddyExe: "/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy",
    themeId: "harbor-focus",
    themeRevision: REVISION,
    launchAgentLabel: "local.workbuddy-dream-skin.injector",
    launchAgentPlist: path.join(stateRoot, "injector-launch-agent.plist"),
    appLaunchAgentLabel: "local.workbuddy-dream-skin.workbuddy",
    appLaunchAgentPlist: path.join(stateRoot, "workbuddy-launch-agent.plist"),
  }));
  await validate();

  const status = await fs.readFile(path.join(ROOT, "scripts", "status-workbuddy-skin-macos.sh"), "utf8");
  const stop = await fs.readFile(path.join(ROOT, "scripts", "stop-workbuddy-skin-macos.sh"), "utf8");
  assert.ok(status.indexOf("discover_workbuddy_app") < status.indexOf('if [ ! -f "$STATE_PATH" ]'));
  assert.match(status, /if DISCOVERED_WORKBUDDY_EXE="\$\([\s\S]*discover_workbuddy_app/);
  assert.equal(status.match(/workbuddy_is_running/g)?.length, 2);
  assert.doesNotMatch(status, /APP_JOB_PID/);
  assert.match(status, /if ! workbuddy_state_is_trustworthy; then[\s\S]*SESSION_STATUS="orphaned-unverified"/);
  assert.ok(status.indexOf("workbuddy_state_is_trustworthy") < status.indexOf('PORT="$(state_field port)"'));
  assert.match(stop, /if \[ "\$STATE_TRUSTWORTHY" != "true" \]; then[\s\S]*stop_launchd_owned_session true/);
  assert.doesNotMatch(stop.slice(0, stop.indexOf("stop_launchd_owned_session()")), /discover_workbuddy_app|require_workbuddy_runtime/);
  assert.match(stop, /stop_path_owned_workbuddy_launch_agent/);
  assert.match(stop, /stop_path_owned_launch_agent/);
});

test("WorkBuddy 5.3.5 generated editor log is isolated only when strict verification then passes", {
  skip: process.platform !== "darwin",
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-signature-repair-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateRoot = path.join(root, "state");
  const bundle = path.join(root, "WorkBuddy.app");
  const generatedLog = path.join(
    bundle,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "@tencent",
    "tencent-docs-ai-engine",
    "bin",
    "darwin-arm64",
    "editor_sdk.log",
  );
  await fs.mkdir(path.dirname(generatedLog), { recursive: true });
  await fs.writeFile(path.join(bundle, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>5.3.5</string>
</dict></plist>
`);
  await fs.writeFile(generatedLog, "generated by WorkBuddy\n");

  const result = await execFile("/bin/bash", ["-c", [
    'source "$COMMON_PATH"',
    'WORKBUDDY_BUNDLE="$TEST_BUNDLE"',
    'WORKBUDDY_VERSION="5.3.5"',
    'workbuddy_signature_is_valid() { [ ! -e "$(workbuddy_generated_log_path)" ]; }',
    'workbuddy_signature_diagnostics() { printf "%s: a sealed resource is missing or invalid\\nfile added: %s\\n" "$WORKBUDDY_BUNDLE" "$(workbuddy_generated_log_path)"; }',
    "workbuddy_signature_is_valid_or_repaired",
    'printf "%s" "$WORKBUDDY_SIGNATURE_REPAIR_PATH"',
  ].join("; ")], {
    env: {
      ...process.env,
      COMMON_PATH: path.join(ROOT, "scripts", "common-workbuddy-macos.sh"),
      TEST_BUNDLE: bundle,
      WORKBUDDY_DREAM_SKIN_HOME: stateRoot,
    },
  });

  assert.match(result.stderr, /isolated WorkBuddy 5\.3\.5 generated log/);
  assert.equal(await fs.readFile(result.stdout, "utf8"), "generated by WorkBuddy\n");
  await assert.rejects(fs.access(generatedLog));
  assert.ok(path.resolve(result.stdout).startsWith(path.resolve(stateRoot) + path.sep));
});

test("WorkBuddy generated-log repair is fail-closed for other corruption, versions, and symlinks", {
  skip: process.platform !== "darwin",
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-signature-repair-guard-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const commonPath = path.join(ROOT, "scripts", "common-workbuddy-macos.sh");
  const classifierBundle = path.join(root, "Classifier.app");
  const classifier = await execFile("/bin/bash", ["-c", [
    'source "$COMMON_PATH"',
    'WORKBUDDY_BUNDLE="$TEST_BUNDLE"',
    'known="$(workbuddy_generated_log_path)"',
    'exact="$WORKBUDDY_BUNDLE: a sealed resource is missing or invalid\nfile added: $known"',
    'is_known_workbuddy_generated_log_failure "$exact" && printf 1 || printf 0',
    'is_known_workbuddy_generated_log_failure "$WORKBUDDY_BUNDLE: a sealed resource is missing or invalid" && printf 1 || printf 0',
    'is_known_workbuddy_generated_log_failure "$WORKBUDDY_BUNDLE: a sealed resource is missing or invalid\nfile added: $WORKBUDDY_BUNDLE/other.log" && printf 1 || printf 0',
    'is_known_workbuddy_generated_log_failure "$exact\nfile modified: $WORKBUDDY_BUNDLE/Contents/Resources/app.asar" && printf 1 || printf 0',
    'is_known_workbuddy_generated_log_failure "$exact.suffix" && printf 1 || printf 0',
  ].join("; ")], {
    env: {
      ...process.env,
      COMMON_PATH: commonPath,
      TEST_BUNDLE: classifierBundle,
      WORKBUDDY_DREAM_SKIN_HOME: path.join(root, "classifier-state"),
    },
  });
  assert.equal(classifier.stdout, "10000");

  const createBundle = async (name, version, { symlink = false } = {}) => {
    const stateRoot = path.join(root, `${name}-state`);
    const bundle = path.join(root, `${name}.app`);
    const generatedLog = path.join(
      bundle,
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "node_modules",
      "@tencent",
      "tencent-docs-ai-engine",
      "bin",
      "darwin-arm64",
      "editor_sdk.log",
    );
    await fs.mkdir(path.dirname(generatedLog), { recursive: true });
    await fs.writeFile(path.join(bundle, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`);
    if (symlink) {
      const external = path.join(root, `${name}-external.log`);
      await fs.writeFile(external, "external\n");
      await fs.symlink(external, generatedLog);
    } else {
      await fs.writeFile(generatedLog, "preserve me\n");
    }
    return { stateRoot, bundle, generatedLog, version };
  };

  const invoke = (fixture, signatureBody, diagnosticsBody = (
    'printf "%s: a sealed resource is missing or invalid\\nfile added: %s\\n" ' +
    '"$WORKBUDDY_BUNDLE" "$(workbuddy_generated_log_path)"'
  )) => execFile("/bin/bash", ["-c", [
    'source "$COMMON_PATH"',
    'WORKBUDDY_BUNDLE="$TEST_BUNDLE"',
    'WORKBUDDY_VERSION="$TEST_VERSION"',
    `workbuddy_signature_is_valid() { ${signatureBody}; }`,
    `workbuddy_signature_diagnostics() { ${diagnosticsBody}; }`,
    "if workbuddy_signature_is_valid_or_repaired; then exit 9; fi",
  ].join("; ")], {
    env: {
      ...process.env,
      COMMON_PATH: commonPath,
      TEST_BUNDLE: fixture.bundle,
      TEST_VERSION: fixture.version,
      WORKBUDDY_DREAM_SKIN_HOME: fixture.stateRoot,
    },
  });

  const otherCorruption = await createBundle("other-corruption", "5.3.5");
  const beforeRollback = await fs.stat(otherCorruption.generatedLog);
  await invoke(otherCorruption, "return 1");
  const afterRollback = await fs.stat(otherCorruption.generatedLog);
  assert.equal(await fs.readFile(otherCorruption.generatedLog, "utf8"), "preserve me\n");
  assert.equal(afterRollback.ino, beforeRollback.ino);
  assert.equal(afterRollback.mode, beforeRollback.mode);
  assert.deepEqual(
    await fs.readdir(path.join(otherCorruption.stateRoot, "host-signature-repairs")),
    [],
  );

  const unexpectedDiagnostics = await createBundle("unexpected-diagnostics", "5.3.5");
  const unexpectedBefore = await fs.stat(unexpectedDiagnostics.generatedLog);
  await invoke(
    unexpectedDiagnostics,
    "return 1",
    'printf "%s: a sealed resource is missing or invalid\\nfile modified: %s/Contents/Resources/app.asar\\n" "$WORKBUDDY_BUNDLE" "$WORKBUDDY_BUNDLE"',
  );
  const unexpectedAfter = await fs.stat(unexpectedDiagnostics.generatedLog);
  assert.equal(unexpectedAfter.ino, unexpectedBefore.ino);
  await assert.rejects(fs.access(path.join(
    unexpectedDiagnostics.stateRoot,
    "host-signature-repairs",
  )));

  const unsupportedVersion = await createBundle("unsupported-version", "5.3.6");
  await invoke(unsupportedVersion, '[ ! -e "$(workbuddy_generated_log_path)" ]');
  assert.equal(await fs.readFile(unsupportedVersion.generatedLog, "utf8"), "preserve me\n");

  const symlink = await createBundle("symlink", "5.3.5", { symlink: true });
  await invoke(symlink, '[ ! -e "$(workbuddy_generated_log_path)" ]');
  assert.equal((await fs.lstat(symlink.generatedLog)).isSymbolicLink(), true);

  const alreadyValid = await createBundle("already-valid", "5.3.5");
  const validBefore = await fs.stat(alreadyValid.generatedLog);
  const validResult = await execFile("/bin/bash", ["-c", [
    'source "$COMMON_PATH"',
    'WORKBUDDY_BUNDLE="$TEST_BUNDLE"',
    'WORKBUDDY_VERSION="5.3.5"',
    "workbuddy_signature_is_valid() { return 0; }",
    "workbuddy_signature_diagnostics() { exit 19; }",
    "workbuddy_signature_is_valid_or_repaired",
  ].join("; ")], {
    env: {
      ...process.env,
      COMMON_PATH: commonPath,
      TEST_BUNDLE: alreadyValid.bundle,
      WORKBUDDY_DREAM_SKIN_HOME: alreadyValid.stateRoot,
    },
  });
  assert.equal(validResult.stderr, "");
  assert.equal((await fs.stat(alreadyValid.generatedLog)).ino, validBefore.ino);
  await assert.rejects(fs.access(path.join(alreadyValid.stateRoot, "host-signature-repairs")));

  const wrongTeamSentinel = path.join(root, "wrong-team-repair-called");
  await assert.rejects(
    execFile("/bin/bash", ["-c", [
      'source "$COMMON_PATH"',
      'WORKBUDDY_BUNDLE="$TEST_BUNDLE"',
      'codesign_team_id() { printf "WRONGTEAM"; }',
      'repair_workbuddy_generated_log_signature_drift() { : > "$SENTINEL"; return 0; }',
      "require_workbuddy_runtime",
    ].join("; ")], {
      env: {
        ...process.env,
        COMMON_PATH: commonPath,
        TEST_BUNDLE: alreadyValid.bundle,
        SENTINEL: wrongTeamSentinel,
        WORKBUDDY_DREAM_SKIN_HOME: alreadyValid.stateRoot,
      },
    }),
    (error) => /Unexpected WorkBuddy signing team/.test(error.stderr),
  );
  await assert.rejects(fs.access(wrongTeamSentinel));
});

test("WorkBuddy macOS runtime is loopback-only, signature-bound, persistent, and reversible", async () => {
  const [common, start, verify, stop] = await Promise.all([
    fs.readFile(path.join(ROOT, "scripts", "common-workbuddy-macos.sh"), "utf8"),
    fs.readFile(path.join(ROOT, "scripts", "start-workbuddy-skin-macos.sh"), "utf8"),
    fs.readFile(path.join(ROOT, "scripts", "verify-workbuddy-skin-macos.sh"), "utf8"),
    fs.readFile(path.join(ROOT, "scripts", "stop-workbuddy-skin-macos.sh"), "utf8"),
  ]);
  assert.match(common, /SUPPORTED_WORKBUDDY_BUNDLE_IDS="com\.workbuddy\.workbuddy"/);
  assert.match(common, /EXPECTED_WORKBUDDY_TEAM_ID/);
  assert.match(common, /codesign --verify --deep --strict/);
  assert.match(common, /WORKBUDDY_GENERATED_LOG_REPAIR_VERSION="5\.3\.5"/);
  assert.match(common, /editor_sdk\.log/);
  assert.match(common, /workbuddy_signature_is_valid_or_repaired/);
  assert.match(common, /WORKBUDDY_REMOTE_DEBUGGING_PORT/);
  assert.match(common, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(common, /port_listens_on_loopback_only/);
  assert.match(common, /port_belongs_to_workbuddy/);
  assert.match(common, /launchctl bootstrap/);
  assert.match(common, /ELECTRON_RUN_AS_NODE/);
  assert.match(start, /launch_injector_daemon/);
  assert.match(start, /--css-path/);
  assert.match(start, /write_state/);
  assert.match(common, /recorded_injector_is_alive/);
  assert.match(await fs.readFile(path.join(ROOT, "scripts", "status-workbuddy-skin-macos.sh"), "utf8"), /SESSION_STATUS="degraded"/);
  assert.match(stop, /--remove/);
  assert.match(stop, /stop_owned_workbuddy_launch_agent/);
  assert.match(stop, /launch_workbuddy_normally/);
  assert.ok(start.indexOf("acquire_operation_lock") < start.indexOf("require_workbuddy_runtime"));
  assert.ok(verify.indexOf("acquire_operation_lock") < verify.indexOf("require_workbuddy_runtime"));
  assert.match(stop, /workbuddy_signature_is_valid_or_repaired/);
  assert.match(stop, /WORKBUDDY_VERSION="\$\(plist_value "\$WORKBUDDY_BUNDLE" CFBundleShortVersionString\)"/);
  assert.doesNotMatch([common, start, stop].join("\n"), /app\.asar\s+(?:extract|pack)|codesign\s+--force/);
});
