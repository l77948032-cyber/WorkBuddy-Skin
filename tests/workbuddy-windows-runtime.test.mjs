import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WORKBUDDY_WINDOWS_RENDERER,
  WORKBUDDY_WINDOWS_SIGNER,
  WatcherFailureBudget,
  WindowsOperationLock,
  WindowsRuntimeError,
  WindowsWorkBuddyRuntime,
  classifyWindowsWorkBuddyProbe,
  boundedJsonFileIdentityMatches,
  compareWindowsVersions,
  createDefaultWindowsHost,
  discoverOfficialWorkBuddy,
  isPlausibleWindowsWorkBuddyRendererTarget,
  isWorkBuddyMainProcess,
  normalizeListeners,
  parsePowerShellJson,
  parseWindowsRuntimeArgs,
  processMatchesIdentity,
  readBoundedJsonFile,
  registryExecutableCandidates,
  resolveWindowsRuntimeConfig,
  sameWindowsPath,
  signerCommonName,
  validateLoopbackListeners,
  validateOwnedPort,
  validateWindowsRuntimeState,
  validateWorkBuddyExecutableEvidence,
  workBuddyAncestorForListener,
} from "../scripts/workbuddy-runtime-windows.mjs";
import { WORKBUDDY_SKIN_VERSION } from "../scripts/workbuddy-injector.mjs";

const EXE = "C:\\Users\\tester\\AppData\\Local\\Programs\\WorkBuddy\\WorkBuddy.exe";
const NODE_EXE = "C:\\Program Files\\nodejs\\node.exe";
const STARTED = "2026-08-09T02:03:04.0000000Z";
const WATCHER_STARTED = "2026-08-09T02:03:05.0000000Z";
const TOKEN = "a".repeat(32);

function officialEvidence(overrides = {}) {
  return {
    path: EXE,
    signatureStatus: "Valid",
    signerSubject: `CN=${WORKBUDDY_WINDOWS_SIGNER}, O=Tencent`,
    signerThumbprint: "ABC123",
    productName: "WorkBuddy",
    originalFilename: "WorkBuddy.exe",
    companyName: WORKBUDDY_WINDOWS_SIGNER,
    productVersion: "5.3.8",
    fileVersion: "5.3.8.0",
    asarExists: true,
    ...overrides,
  };
}

function processEntry(overrides = {}) {
  return {
    pid: 100,
    parentPid: 1,
    executablePath: EXE,
    commandLine: `"${EXE}" --remote-debugging-address=127.0.0.1`,
    name: "WorkBuddy.exe",
    startedAt: STARTED,
    ...overrides,
  };
}

function stateFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    platform: "win32",
    skinVersion: WORKBUDDY_SKIN_VERSION,
    session: "active",
    ownsSession: true,
    sessionToken: TOKEN,
    statePath: "C:\\Users\\tester\\AppData\\Local\\WorkBuddyDreamSkin\\state.json",
    runtimePath: "C:\\skin\\scripts\\workbuddy-runtime-windows.mjs",
    port: 9432,
    browserId: "browser-123",
    themeId: "orchid-night",
    themeDir: "C:\\skin\\plugins\\workbuddy\\catalog\\orchid-night",
    themeRevision: "b".repeat(64),
    workbuddyPid: 100,
    workbuddyStartedAt: STARTED,
    workbuddyExe: EXE,
    workbuddyVersion: "5.3.8",
    signerCommonName: WORKBUDDY_WINDOWS_SIGNER,
    signerThumbprint: "ABC123",
    watcherPid: 200,
    watcherStartedAt: WATCHER_STARTED,
    watcherExe: NODE_EXE,
    wasRunningBeforeApply: true,
    createdAt: "2026-08-09T02:03:06.000Z",
    ...overrides,
  };
}

test("Windows runtime CLI exposes only scoped public operations", () => {
  assert.deepEqual(parseWindowsRuntimeArgs([
    "apply",
    "--theme", "orchid-night",
    "--revision", "c".repeat(64),
    "--port", "19432",
    "--workbuddy-exe", EXE,
  ]), {
    command: "apply",
    port: 19432,
    portExplicit: true,
    themeId: "orchid-night",
    revision: "c".repeat(64),
    screenshot: null,
    workbuddyExe: EXE,
    statePath: null,
    sessionToken: null,
    browserId: null,
    workbuddyPid: null,
    workbuddyStartedAt: null,
    themeDir: null,
  });
  assert.equal(parseWindowsRuntimeArgs(["apply"]).themeId, "harbor-focus");
  assert.equal(parseWindowsRuntimeArgs(["verify", "--screenshot", "shot.png"]).command, "verify");
  assert.throws(() => parseWindowsRuntimeArgs(["restore", "--theme", "x"]), /does not accept/);
  assert.throws(() => parseWindowsRuntimeArgs(["apply", "--port", "80"]), /Invalid Windows runtime port/);
  assert.throws(() => parseWindowsRuntimeArgs(["start"]), /Unknown Windows runtime command/);
});

test("Windows runtime configuration follows LOCALAPPDATA and explicit asset overrides", () => {
  const config = resolveWindowsRuntimeConfig({
    LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
    WORKBUDDY_DREAM_SKIN_HOME: "D:\\DreamSkinState",
    WORKBUDDY_EXE: EXE,
  }, "C:\\skin\\scripts\\workbuddy-runtime-windows.mjs");
  assert.equal(config.stateRoot, "D:\\DreamSkinState");
  assert.equal(config.statePath, "D:\\DreamSkinState\\state.json");
  assert.equal(config.explicitExecutable, EXE);
});

test("official executable validation requires Authenticode, exact signer, and product metadata", () => {
  const verified = validateWorkBuddyExecutableEvidence(officialEvidence(), EXE.toLowerCase());
  assert.equal(verified.path, EXE);
  assert.equal(verified.signerCommonName, WORKBUDDY_WINDOWS_SIGNER);
  assert.equal(verified.productVersion, "5.3.8");
  assert.equal(verified.rendererPath, WORKBUDDY_WINDOWS_RENDERER);
  assert.equal(signerCommonName(`O=Tencent, CN="${WORKBUDDY_WINDOWS_SIGNER}", C=CN`), WORKBUDDY_WINDOWS_SIGNER);
  assert.equal(validateWorkBuddyExecutableEvidence(officialEvidence({ originalFilename: "" })).originalFilename, null);
  assert.equal(compareWindowsVersions("5.3.8", "5.3.8.0"), 0);
  assert.equal(compareWindowsVersions("5.3.9", "5.3.8"), 1);

  assert.throws(() => validateWorkBuddyExecutableEvidence(officialEvidence({ signatureStatus: "NotSigned" })), /Authenticode/);
  assert.throws(() => validateWorkBuddyExecutableEvidence(officialEvidence({
    signerSubject: "CN=Someone Else, O=Unknown",
  })), /Unexpected WorkBuddy signer/);
  assert.throws(() => validateWorkBuddyExecutableEvidence(officialEvidence({ productName: "Other" })), /ProductName/);
  assert.throws(() => validateWorkBuddyExecutableEvidence(officialEvidence({ originalFilename: "Other.exe" })), /OriginalFilename/);
  assert.throws(() => validateWorkBuddyExecutableEvidence(officialEvidence({ companyName: "" })), /company metadata: missing/);
  assert.throws(() => validateWorkBuddyExecutableEvidence(officialEvidence({ companyName: "Other" })), /company metadata: Other/);
  assert.throws(() => validateWorkBuddyExecutableEvidence(officialEvidence({ asarExists: false })), /app\.asar/);
  assert.throws(
    () => validateWorkBuddyExecutableEvidence(officialEvidence({ productVersion: "5.3.7" })),
    (error) => error instanceof WindowsRuntimeError && error.code === "UNSUPPORTED_WORKBUDDY_VERSION",
  );
});

test("discovery gives an explicit override strict precedence without falling back", async () => {
  const fallback = "C:\\Fallback\\WorkBuddy.exe";
  let inspected = 0;
  await assert.rejects(discoverOfficialWorkBuddy({
    explicitPath: EXE,
    localAppData: "C:\\Users\\tester\\AppData\\Local",
    processes: [processEntry({ executablePath: fallback })],
    registryEntries: [],
    isFile: async () => true,
    inspectExecutable: async (candidate) => {
      inspected += 1;
      return officialEvidence({ path: candidate, signatureStatus: candidate === EXE ? "HashMismatch" : "Valid" });
    },
  }), /Authenticode/);
  assert.equal(inspected, 1);
});

test("discovery accepts verified running, registry, and default candidates but rejects ambiguity", async () => {
  const registryExe = "D:\\Apps\\WorkBuddy\\WorkBuddy.exe";
  assert.deepEqual(registryExecutableCandidates([{
    displayName: "WorkBuddy 5.3.8",
    installLocation: "D:\\Apps\\WorkBuddy",
    displayIcon: `"${registryExe}",0`,
  }]), [registryExe]);

  const discovered = await discoverOfficialWorkBuddy({
    localAppData: "C:\\Users\\tester\\AppData\\Local",
    processes: [processEntry()],
    registryEntries: [],
    isFile: async (candidate) => sameWindowsPath(candidate, EXE),
    inspectExecutable: async (candidate) => officialEvidence({ path: candidate }),
  });
  assert.equal(discovered.path, EXE);

  await assert.rejects(discoverOfficialWorkBuddy({
    localAppData: null,
    processes: [processEntry()],
    registryEntries: [{ displayName: "WorkBuddy", installLocation: "D:\\Apps\\WorkBuddy" }],
    isFile: async () => true,
    inspectExecutable: async (candidate) => officialEvidence({ path: candidate }),
  }), /Multiple verified WorkBuddy installations/);
});

test("Windows renderer detection accepts only the installed resources/app.asar page", () => {
  const target = {
    id: "PAGE1",
    type: "page",
    title: "WorkBuddy",
    url: "file:///C:/Users/tester/AppData/Local/Programs/WorkBuddy/resources/app.asar/renderer/index.html",
  };
  assert.equal(isPlausibleWindowsWorkBuddyRendererTarget(target, EXE), true);
  assert.equal(isPlausibleWindowsWorkBuddyRendererTarget({
    ...target,
    url: "file:///Applications/WorkBuddy.app/Contents/Resources/app.asar/renderer/index.html",
  }, EXE), false);
  assert.equal(isPlausibleWindowsWorkBuddyRendererTarget({ ...target, url: "https://workbuddy.test/" }, EXE), false);
  assert.equal(isPlausibleWindowsWorkBuddyRendererTarget({ ...target, url: `${target.url}?debug=1` }, EXE), false);
  assert.equal(isPlausibleWindowsWorkBuddyRendererTarget({ ...target, url: `${target.url}#/home` }, EXE), false);
  assert.equal(isPlausibleWindowsWorkBuddyRendererTarget({
    ...target,
    url: "file://server/share/WorkBuddy/resources/app.asar/renderer/index.html",
  }, EXE), false);
  assert.equal(isPlausibleWindowsWorkBuddyRendererTarget({
    ...target,
    url: "file:///C:/Users/tester/AppData/Local/Programs/WorkBuddy/fake/resources/app.asar/renderer/index.html",
  }, EXE), false);
  assert.equal(isPlausibleWindowsWorkBuddyRendererTarget({
    ...target,
    url: "file:///C:/Users/tester/AppData/Local/Programs/WorkBuddy/fake%5c..%5cresources/app.asar/renderer/index.html",
  }, EXE), false);

  const classified = classifyWindowsWorkBuddyProbe({
    root: true,
    shell: true,
    sidebar: true,
    content: true,
    main: true,
    rootChildren: 1,
    interactive: 4,
    width: 1280,
    height: 800,
  }, target, EXE);
  assert.equal(classified.matched, true);
  assert.equal(classifyWindowsWorkBuddyProbe({ ...classified, interactive: 0 }, target, EXE).matched, false);
});

test("process identity checks include PID, executable path, and creation time", () => {
  const process = processEntry();
  const identity = { pid: 100, executablePath: EXE.toLowerCase(), startedAt: STARTED };
  assert.equal(processMatchesIdentity(process, identity), true);
  assert.equal(processMatchesIdentity(process, { ...identity, startedAt: "different" }), false);
  assert.equal(isWorkBuddyMainProcess(process, EXE), true);
  assert.equal(isWorkBuddyMainProcess(processEntry({ commandLine: `"${EXE}" --type=renderer` }), EXE), false);
});

test("TCP ownership is loopback-only and every listener must descend from the recorded process", () => {
  let processes = [
    processEntry(),
    processEntry({
      pid: 110,
      parentPid: 100,
      commandLine: `"${EXE}" --type=renderer`,
      startedAt: "2026-08-09T02:03:04.1000000Z",
    }),
  ];
  const ownerIdentity = { pid: 100, executablePath: EXE, startedAt: STARTED };
  const listeners = [{ address: "127.0.0.1", port: 9432, pid: 110 }];
  assert.equal(validateOwnedPort({ listeners, processes, port: 9432, ownerIdentity }).pass, true);
  assert.equal(workBuddyAncestorForListener(110, processes, ownerIdentity).pid, 100);
  assert.deepEqual(normalizeListeners({ LocalAddress: "::1", LocalPort: 9432, OwningProcess: 100 }), [
    { address: "::1", port: 9432, pid: 100 },
  ]);

  assert.throws(() => validateLoopbackListeners([
    { address: "0.0.0.0", port: 9432, pid: 110 },
  ], 9432), /not loopback-only/);
  assert.throws(() => validateOwnedPort({
    listeners: [{ address: "127.0.0.1", port: 9432, pid: 999 }],
    processes: [...processes, processEntry({ pid: 999, parentPid: 1, executablePath: "C:\\Other.exe" })],
    port: 9432,
    ownerIdentity,
  }), /not a descendant/);
  assert.throws(() => validateOwnedPort({
    listeners,
    processes: [
      processEntry(),
      processEntry({
        pid: 110,
        parentPid: 100,
        commandLine: `"${EXE}" --type=renderer`,
        startedAt: "2026-08-09T02:03:03.0000000Z",
      }),
    ],
    port: 9432,
    ownerIdentity,
  }), /ancestry timing/);
  assert.throws(() => validateOwnedPort({ listeners: [], processes, port: 9432, ownerIdentity }), /Nothing is listening/);
});

test("owned CDP startup records exact listener process identities", async () => {
  const child = processEntry({
    pid: 110,
    parentPid: 100,
    commandLine: `"${EXE}" --type=renderer`,
    startedAt: "2026-08-09T02:03:04.5000000Z",
  });
  const runtime = new WindowsWorkBuddyRuntime({
    host: {
      platform: "win32",
      listeners: async () => [{ address: "127.0.0.1", port: 9432, pid: child.pid }],
      sleep: async () => {},
    },
    config: {},
  });
  runtime.snapshots = async () => [processEntry(), child];
  runtime.cdpIdentity = async () => ({ browserId: "browser-owned" });

  const owned = await runtime.waitForOwnedCdp(9432, EXE, 100);
  assert.deepEqual(owned, {
    identity: { pid: 100, executablePath: EXE, startedAt: STARTED },
    browser: { browserId: "browser-owned" },
    listenerIdentities: [{
      pid: child.pid,
      executablePath: EXE,
      startedAt: child.startedAt,
    }],
  });
});

test("runtime JSON state rejects links, hard links, and oversized files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-win-state-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const external = path.join(root, "external.json");
  const linked = path.join(root, "state-hardlink.json");
  await fs.writeFile(external, JSON.stringify(stateFixture()));
  await fs.link(external, linked);
  await assert.rejects(readBoundedJsonFile(linked, { allowedRoot: root }), /bounded regular file/);

  const oversized = path.join(root, "oversized.json");
  await fs.writeFile(oversized, `{"padding":"${"x".repeat(300_000)}"}`);
  await assert.rejects(readBoundedJsonFile(oversized, { allowedRoot: root }), /bounded regular file/);

  const symlink = path.join(root, "state-symlink.json");
  try {
    await fs.symlink(external, symlink, "file");
    await assert.rejects(readBoundedJsonFile(symlink, { allowedRoot: root }), /bounded regular file/);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
  }
});

test("Windows bounded JSON identity ignores unstable inode metadata but verifies size and timestamps", async (t) => {
  const timestamps = {
    birthtimeMs: 1_700_000_000_000,
    mtimeMs: 1_700_000_000_100,
    ctimeMs: 1_700_000_000_200,
  };
  const before = { dev: 10, ino: 20, size: 128, ...timestamps };
  const opened = { ...before, dev: 99, ino: 88 };

  assert.equal(boundedJsonFileIdentityMatches(before, opened, "win32"), true);
  assert.equal(boundedJsonFileIdentityMatches(before, { ...opened, size: 127 }, "win32"), false);
  for (const field of ["birthtimeMs", "mtimeMs", "ctimeMs"]) {
    assert.equal(boundedJsonFileIdentityMatches(before, {
      ...opened,
      [field]: opened[field] + 1,
    }, "win32"), false);
  }
  assert.equal(boundedJsonFileIdentityMatches(before, opened, "darwin"), false);
  assert.equal(boundedJsonFileIdentityMatches(before, { ...opened, dev: 10, ino: 20 }, "linux"), true);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-win-identity-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const statePath = path.join(root, "state.json");
  const state = stateFixture();
  await fs.writeFile(statePath, JSON.stringify(state));
  assert.deepEqual(await readBoundedJsonFile(statePath, {
    allowedRoot: root,
    platform: "win32",
  }), state);
});

test("Windows state rejects altered ownership and path fields", () => {
  const state = stateFixture();
  assert.equal(validateWindowsRuntimeState(state, {
    stateRoot: "C:\\Users\\tester\\AppData\\Local\\WorkBuddyDreamSkin",
  }).session, "active");
  assert.throws(() => validateWindowsRuntimeState(stateFixture({ ownsSession: false })), /header/);
  assert.throws(() => validateWindowsRuntimeState(stateFixture({ sessionToken: "bad" })), /Session token/);
  assert.throws(() => validateWindowsRuntimeState(stateFixture({ watcherPid: 0 })), /watcher process identity/);
  assert.throws(() => validateWindowsRuntimeState(stateFixture({ signerCommonName: "Other" })), /signer/);
  assert.equal(validateWindowsRuntimeState(stateFixture({
    session: "recovery",
    browserId: null,
    watcherPid: null,
    watcherStartedAt: null,
    watcherExe: null,
  })).session, "recovery");
  assert.throws(() => validateWindowsRuntimeState(stateFixture({
    session: "recovery",
    browserId: null,
    workbuddyPid: null,
    workbuddyStartedAt: null,
    watcherPid: null,
    watcherStartedAt: null,
    watcherExe: null,
  })), /residual process identity/);
});

test("operation lock preserves a live owner and recovers a dead owner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-win-lock-"));
  const lockPath = path.join(root, "operation.lock");
  const first = new WindowsOperationLock(lockPath, { pid: 111, token: "1".repeat(32), isPidAlive: () => true });
  await first.acquire();
  const second = new WindowsOperationLock(lockPath, { pid: 222, token: "2".repeat(32), isPidAlive: () => true });
  await assert.rejects(second.acquire(), (error) => error instanceof WindowsRuntimeError
    && error.code === "OPERATION_LOCKED");
  await first.release();

  await fs.mkdir(lockPath);
  await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 333, token: "3".repeat(32) }));
  const recovered = new WindowsOperationLock(lockPath, {
    pid: 444,
    token: "4".repeat(32),
    isPidAlive: () => false,
  });
  await recovered.acquire();
  assert.equal(JSON.parse(await fs.readFile(path.join(lockPath, "owner.json"))).pid, 444);
  await recovered.release();
  await fs.rm(root, { recursive: true, force: true });
});

test("restore removes the live DOM before stopping only the owned watcher and app", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-win-restore-"));
  const statePath = path.join(root, "state.json");
  await fs.writeFile(statePath, "{}\n");
  const events = [];
  let listenerReads = 0;
  const state = stateFixture();
  let processes = [
    processEntry(),
    processEntry({
      pid: 200,
      parentPid: 1,
      executablePath: NODE_EXE,
      commandLine: `"${NODE_EXE}" C:\\skin\\scripts\\workbuddy-runtime-windows.mjs __watch --session-token ${TOKEN}`,
      name: "node.exe",
      startedAt: WATCHER_STARTED,
    }),
  ];
  const host = {
    platform: "win32",
    sleep: async () => {},
    processSnapshots: async () => processes,
    listeners: async () => (++listenerReads === 1
      ? [{ address: "127.0.0.1", port: 9432, pid: 100 }]
      : []),
    oneShot: async (options) => {
      events.push(`dom:${options.mode}`);
      return { pass: true, mode: options.mode };
    },
    executableEvidence: async () => officialEvidence(),
    launchWorkBuddy: (executablePath, options) => {
      events.push(`launch:${executablePath}:${options.debugPort}`);
      processes.push(processEntry({
        pid: 300,
        commandLine: `"${EXE}"`,
        startedAt: "2026-08-09T02:03:07.0000000Z",
      }));
      return { pid: 300 };
    },
    fetchImpl: async () => { throw new Error("not used"); },
    Session: class {},
  };
  const runtime = new WindowsWorkBuddyRuntime({
    host,
    config: {
      statePath,
      cssPath: "css",
      templatePath: "template",
      registryPath: "registry",
    },
  });
  runtime.snapshots = async () => processes;
  runtime.cdpIdentity = async () => { events.push("cdp"); return { browserId: state.browserId }; };
  runtime.stopIdentity = async (identity, options) => {
    events.push(`stop:${identity.pid}:${options.commandToken || "app"}`);
    processes = processes.filter((entry) => entry.pid !== identity.pid);
    return true;
  };
  const result = await runtime.restoreLocked(state, { relaunch: true });
  assert.deepEqual(events, [
    "cdp",
    "dom:remove",
    `stop:200:${TOKEN}`,
    "stop:100:app",
    `launch:${EXE}:null`,
  ]);
  assert.equal(result.domRemoved, true);
  await assert.rejects(fs.stat(statePath), { code: "ENOENT" });
  await fs.rm(root, { recursive: true, force: true });
});

test("restore never connects to an unowned port but still stops its exact app identity", async () => {
  const events = [];
  const state = stateFixture();
  let processes = [
    processEntry(),
    processEntry({
      pid: 999,
      parentPid: 1,
      executablePath: "C:\\Other\\other.exe",
      commandLine: "other.exe",
      startedAt: "2026-08-09T02:03:05.0000000Z",
    }),
  ];
  const runtime = new WindowsWorkBuddyRuntime({
    host: {
      platform: "win32",
      executableEvidence: async () => officialEvidence(),
      listeners: async () => [{ address: "127.0.0.1", port: 9432, pid: 999 }],
    },
    config: { statePath: "C:\\state\\state.json" },
  });
  runtime.snapshots = async () => processes;
  runtime.stopIdentity = async (identity) => {
    events.push(`stop:${identity.pid}`);
    processes = processes.filter((entry) => entry.pid !== identity.pid);
  };
  const result = await runtime.restoreLocked(state, { relaunch: false });
  assert.deepEqual(events, ["stop:100"]);
  assert.equal(result.domRemoved, false);
  assert.match(result.domRemovalSkippedReason, /not a descendant/);
});

test("degraded restore survives a missing CDP endpoint and an official WorkBuddy update", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-win-degraded-restore-"));
  const statePath = path.join(root, "state.json");
  await fs.writeFile(statePath, "{}\n");
  const events = [];
  const state = stateFixture();
  let processes = [
    processEntry(),
    processEntry({
      pid: 200,
      parentPid: 1,
      executablePath: NODE_EXE,
      commandLine: `"${NODE_EXE}" C:\\skin\\scripts\\workbuddy-runtime-windows.mjs __watch --session-token ${TOKEN}`,
      name: "node.exe",
      startedAt: WATCHER_STARTED,
    }),
  ];
  const runtime = new WindowsWorkBuddyRuntime({
    host: {
      platform: "win32",
      executableEvidence: async () => officialEvidence({
        productVersion: "5.4.0",
        fileVersion: "5.4.0.0",
        signerThumbprint: "ROTATED-CERT",
      }),
      listeners: async () => [],
    },
    config: { statePath },
  });
  runtime.snapshots = async () => processes;
  runtime.stopIdentity = async (identity) => {
    events.push(`stop:${identity.pid}`);
    processes = processes.filter((entry) => entry.pid !== identity.pid);
  };
  const result = await runtime.restoreLocked(state, { relaunch: false });
  assert.deepEqual(events, ["stop:200", "stop:100"]);
  assert.equal(result.domRemoved, false);
  assert.match(result.domRemovalSkippedReason, /Nothing is listening/);
  assert.equal(result.hostChangedSinceApply, true);
  await assert.rejects(fs.stat(statePath), { code: "ENOENT" });
  await fs.rm(root, { recursive: true, force: true });
});

test("restore retains and stops an owned listener even when DOM cleanup fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-win-listener-restore-"));
  const statePath = path.join(root, "state.json");
  await fs.writeFile(statePath, "{}\n");
  const state = stateFixture();
  const childStarted = "2026-08-09T02:03:04.5000000Z";
  const events = [];
  let processes = [
    processEntry(),
    processEntry({
      pid: 110,
      parentPid: 100,
      commandLine: `"${EXE}" --type=renderer`,
      startedAt: childStarted,
    }),
    processEntry({
      pid: 200,
      parentPid: 1,
      executablePath: NODE_EXE,
      commandLine: `"${NODE_EXE}" C:\\skin\\scripts\\workbuddy-runtime-windows.mjs __watch --session-token ${TOKEN}`,
      name: "node.exe",
      startedAt: WATCHER_STARTED,
    }),
  ];
  const runtime = new WindowsWorkBuddyRuntime({
    host: {
      platform: "win32",
      executableEvidence: async () => officialEvidence(),
      listeners: async () => [{ address: "127.0.0.1", port: 9432, pid: 110 }],
      sleep: async () => {},
    },
    config: { statePath },
  });
  runtime.snapshots = async () => processes;
  runtime.cdpIdentity = async () => { throw new Error("CDP browser disappeared"); };
  runtime.stopIdentity = async (identity) => {
    events.push(`stop:${identity.pid}`);
    processes = processes.filter((entry) => entry.pid !== identity.pid);
  };
  const result = await runtime.restoreLocked(state, { relaunch: false });
  assert.deepEqual(events, ["stop:200", "stop:100", "stop:110"]);
  assert.equal(result.domRemoved, false);
  assert.match(result.domRemovalSkippedReason, /CDP browser disappeared/);
  await assert.rejects(fs.stat(statePath), { code: "ENOENT" });
  await fs.rm(root, { recursive: true, force: true });
});

test("apply preflights an explicit port before closing a running official WorkBuddy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-win-preflight-"));
  const themeDir = path.join(root, "themes", "orchid-night");
  await fs.mkdir(themeDir, { recursive: true });
  const cssPath = path.join(root, "skin.css");
  const templatePath = path.join(root, "inject.js");
  const registryPath = path.join(root, "components.json");
  await Promise.all([
    fs.writeFile(path.join(themeDir, "theme.json"), "{}\n"),
    fs.writeFile(cssPath, "/* css */\n"),
    fs.writeFile(templatePath, "// js\n"),
    fs.writeFile(registryPath, "{}\n"),
  ]);
  const events = [];
  const host = {
    platform: "win32",
    listeners: async () => [{ address: "127.0.0.1", port: 19432, pid: 999 }],
  };
  const runtime = new WindowsWorkBuddyRuntime({
    host,
    config: {
      stateRoot: root,
      statePath: path.join(root, "state.json"),
      lockPath: path.join(root, "operation.lock"),
      themesRoot: path.join(root, "themes"),
      cssPath,
      templatePath,
      registryPath,
      explicitExecutable: null,
    },
  });
  runtime.readState = async () => null;
  runtime.discover = async () => validateWorkBuddyExecutableEvidence(officialEvidence());
  runtime.snapshots = async () => [processEntry()];
  runtime.stopOfficialMainProcesses = async () => { events.push("stopped"); };
  await assert.rejects(runtime.apply({
    themeId: "orchid-night",
    revision: null,
    port: 19432,
    portExplicit: true,
    workbuddyExe: null,
  }), (error) => error instanceof WindowsRuntimeError && error.code === "PORT_IN_USE");
  assert.deepEqual(events, []);
  await fs.rm(root, { recursive: true, force: true });
});

test("apply reports an incomplete rollback instead of hiding it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-win-rollback-"));
  const themeDir = path.join(root, "themes", "orchid-night");
  await fs.mkdir(themeDir, { recursive: true });
  const cssPath = path.join(root, "skin.css");
  const templatePath = path.join(root, "inject.js");
  const registryPath = path.join(root, "components.json");
  await Promise.all([
    fs.writeFile(path.join(themeDir, "theme.json"), "{}\n"),
    fs.writeFile(cssPath, "/* css */\n"),
    fs.writeFile(templatePath, "// js\n"),
    fs.writeFile(registryPath, "{}\n"),
  ]);
  let processes = [processEntry()];
  const runtime = new WindowsWorkBuddyRuntime({
    host: {
      platform: "win32",
      listeners: async () => [],
      executableEvidence: async () => officialEvidence(),
      launchWorkBuddy: () => ({ pid: 501 }),
    },
    config: {
      stateRoot: root,
      statePath: path.join(root, "state.json"),
      lockPath: path.join(root, "operation.lock"),
      themesRoot: path.join(root, "themes"),
      cssPath,
      templatePath,
      registryPath,
      explicitExecutable: null,
    },
  });
  runtime.readState = async () => null;
  runtime.discover = async () => validateWorkBuddyExecutableEvidence(officialEvidence());
  runtime.snapshots = async () => processes;
  runtime.stopOfficialMainProcesses = async () => { processes = []; };
  runtime.waitForOwnedCdp = async () => null;
  runtime.launchNormalAndWait = async () => { throw new Error("native restart failed"); };
  await assert.rejects(runtime.apply({
    themeId: "orchid-night",
    revision: null,
    port: 19432,
    portExplicit: true,
    workbuddyExe: null,
  }), (error) => {
    assert.equal(error.code, "APPLY_ROLLBACK_FAILED");
    assert.equal(error.details.original.code, "CDP_START_FAILED");
    assert.equal(error.details.failures[0].stage, "restart-native-workbuddy");
    return true;
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("apply preserves a recovery state when a themed process cannot be stopped", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-win-recovery-"));
  const themeDir = path.join(root, "themes", "orchid-night");
  await fs.mkdir(themeDir, { recursive: true });
  const cssPath = path.join(root, "skin.css");
  const templatePath = path.join(root, "inject.js");
  const registryPath = path.join(root, "components.json");
  await Promise.all([
    fs.writeFile(path.join(themeDir, "theme.json"), "{}\n"),
    fs.writeFile(cssPath, "/* css */\n"),
    fs.writeFile(templatePath, "// js\n"),
    fs.writeFile(registryPath, "{}\n"),
  ]);
  const debugStarted = "2026-08-09T02:03:08.0000000Z";
  let processes = [processEntry()];
  let recoveryState = null;
  const host = {
    platform: "win32",
    now: () => "2026-08-09T02:03:09.000Z",
    randomToken: () => TOKEN,
    listeners: async () => [],
    executableEvidence: async () => officialEvidence(),
    launchWorkBuddy: () => {
      processes = [processEntry({
        pid: 501,
        commandLine: `"${EXE}" --remote-debugging-address=127.0.0.1`,
        startedAt: debugStarted,
      })];
      return { pid: 501 };
    },
  };
  const runtime = new WindowsWorkBuddyRuntime({
    host,
    config: {
      stateRoot: root,
      statePath: path.join(root, "state.json"),
      lockPath: path.join(root, "operation.lock"),
      runtimePath: "C:\\skin\\scripts\\workbuddy-runtime-windows.mjs",
      themesRoot: path.join(root, "themes"),
      cssPath,
      templatePath,
      registryPath,
      explicitExecutable: null,
    },
  });
  runtime.readState = async () => null;
  runtime.discover = async () => validateWorkBuddyExecutableEvidence(officialEvidence());
  runtime.snapshots = async () => processes;
  runtime.stopOfficialMainProcesses = async () => { processes = []; };
  runtime.waitForOwnedCdp = async () => ({
    identity: { pid: 501, executablePath: EXE, startedAt: debugStarted },
    browser: { browserId: "browser-recovery" },
    listenerIdentities: [],
  });
  runtime.oneShot = async () => ({ pass: false });
  runtime.stopIdentity = async () => { throw new Error("access denied while stopping process"); };
  runtime.persistState = async (state) => { recoveryState = state; };

  await assert.rejects(runtime.apply({
    themeId: "orchid-night",
    revision: null,
    port: 19432,
    portExplicit: true,
    workbuddyExe: null,
  }), (error) => {
    assert.equal(error.code, "APPLY_ROLLBACK_FAILED");
    assert.equal(error.details.recoveryStatePreserved, true);
    return true;
  });
  assert.equal(recoveryState.session, "recovery");
  assert.equal(recoveryState.workbuddyPid, 501);
  assert.equal(recoveryState.watcherPid, null);
  await fs.rm(root, { recursive: true, force: true });
});

test("apply preserves a recovery state when an owned child listener survives rollback", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-win-listener-recovery-"));
  const themeDir = path.join(root, "themes", "orchid-night");
  await fs.mkdir(themeDir, { recursive: true });
  const cssPath = path.join(root, "skin.css");
  const templatePath = path.join(root, "inject.js");
  const registryPath = path.join(root, "components.json");
  const statePath = path.join(root, "state.json");
  await Promise.all([
    fs.writeFile(path.join(themeDir, "theme.json"), "{}\n"),
    fs.writeFile(cssPath, "/* css */\n"),
    fs.writeFile(templatePath, "// js\n"),
    fs.writeFile(registryPath, "{}\n"),
    fs.writeFile(statePath, "sentinel\n"),
  ]);
  const appStarted = "2026-08-09T02:03:08.0000000Z";
  const listenerStarted = "2026-08-09T02:03:08.5000000Z";
  const appIdentity = { pid: 501, executablePath: EXE, startedAt: appStarted };
  const listenerIdentity = { pid: 502, executablePath: EXE, startedAt: listenerStarted };
  let processes = [processEntry()];
  let recoveryState = null;
  const runtime = new WindowsWorkBuddyRuntime({
    host: {
      platform: "win32",
      now: () => "2026-08-09T02:03:09.000Z",
      randomToken: () => TOKEN,
      listeners: async () => [],
      executableEvidence: async () => officialEvidence(),
      launchWorkBuddy: () => {
        processes = [
          processEntry({ pid: appIdentity.pid, startedAt: appIdentity.startedAt }),
          processEntry({
            pid: listenerIdentity.pid,
            parentPid: appIdentity.pid,
            commandLine: `"${EXE}" --type=renderer`,
            startedAt: listenerIdentity.startedAt,
          }),
        ];
        return { pid: appIdentity.pid };
      },
    },
    config: {
      stateRoot: root,
      statePath,
      lockPath: path.join(root, "operation.lock"),
      runtimePath: "C:\\skin\\scripts\\workbuddy-runtime-windows.mjs",
      themesRoot: path.join(root, "themes"),
      cssPath,
      templatePath,
      registryPath,
      explicitExecutable: null,
    },
  });
  runtime.readState = async () => null;
  runtime.discover = async () => validateWorkBuddyExecutableEvidence(officialEvidence());
  runtime.snapshots = async () => processes;
  runtime.stopOfficialMainProcesses = async () => { processes = []; };
  runtime.waitForOwnedCdp = async () => ({
    identity: appIdentity,
    browser: { browserId: "browser-listener-recovery" },
    listenerIdentities: [listenerIdentity],
  });
  runtime.oneShot = async () => ({ pass: false });
  runtime.stopIdentity = async (identity) => {
    if (processMatchesIdentity(identity, listenerIdentity)) {
      throw new Error("listener refused to stop");
    }
    processes = processes.filter((entry) => !processMatchesIdentity(entry, identity));
    return true;
  };
  runtime.persistState = async (state) => { recoveryState = state; };

  await assert.rejects(runtime.apply({
    themeId: "orchid-night",
    revision: null,
    port: 19432,
    portExplicit: true,
    workbuddyExe: null,
  }), (error) => {
    assert.equal(error.code, "APPLY_ROLLBACK_FAILED");
    assert.equal(error.details.recoveryStatePreserved, true);
    assert.ok(error.details.failures.some((failure) => failure.stage === "stop-owned-listener"));
    return true;
  });
  assert.equal(recoveryState.session, "recovery");
  assert.equal(recoveryState.workbuddyPid, null);
  assert.equal(recoveryState.watcherPid, null);
  assert.deepEqual(recoveryState.listenerIdentities, [listenerIdentity]);
  assert.equal((await fs.readFile(statePath, "utf8")), "sentinel\n");
  assert.doesNotThrow(() => validateWindowsRuntimeState(stateFixture({
    session: "recovery",
    browserId: null,
    workbuddyPid: null,
    workbuddyStartedAt: null,
    watcherPid: null,
    watcherStartedAt: null,
    watcherExe: null,
    listenerIdentities: [listenerIdentity],
  })));
  await fs.rm(root, { recursive: true, force: true });
});

test("watcher failures back off, log sparsely, and become fatal", () => {
  let now = 1_000;
  const budget = new WatcherFailureBudget({
    now: () => now,
    baseDelayMs: 100,
    maxDelayMs: 1_000,
    limit: 4,
  });
  const first = budget.record("host", "offline");
  assert.deepEqual({ count: first.count, delayMs: first.delayMs, shouldLog: first.shouldLog, fatal: first.fatal }, {
    count: 1,
    delayMs: 100,
    shouldLog: true,
    fatal: false,
  });
  assert.equal(budget.ready("host"), false);
  now += 100;
  const second = budget.record("host", "offline");
  assert.equal(second.delayMs, 200);
  now += 200;
  assert.equal(budget.record("host", "offline").shouldLog, false);
  now += 400;
  assert.equal(budget.record("host", "offline").fatal, true);
});

test("default host launches debug mode with an environment port and loopback address", () => {
  const launches = [];
  const spawn = (executable, args, options) => {
    launches.push({ executable, args, options });
    return { pid: 501, unref() {} };
  };
  const host = createDefaultWindowsHost({ spawn });
  host.launchWorkBuddy(EXE, { debugPort: 19432 });
  host.launchWorkBuddy(EXE, { debugPort: null });
  assert.deepEqual(launches[0].args, ["--remote-debugging-address=127.0.0.1"]);
  assert.equal(launches[0].options.env.WORKBUDDY_REMOTE_DEBUGGING_PORT, "19432");
  assert.deepEqual(launches[1].args, []);
  assert.equal("WORKBUDDY_REMOTE_DEBUGGING_PORT" in launches[1].options.env, false);
  assert.equal(launches[0].options.detached, true);
});

test("PowerShell host calls use an encoded command and UTF-8 environment argument payload", async () => {
  const calls = [];
  const unicodeExe = "C:\\Users\\\u7528\u6237\\AppData\\Local\\Programs\\WorkBuddy\\WorkBuddy.exe";
  const exec = async (file, argv, options) => {
    calls.push({ file, argv, options });
    return { stdout: JSON.stringify(officialEvidence({ path: unicodeExe })), stderr: "" };
  };
  const host = createDefaultWindowsHost({ exec });
  const evidence = await host.executableEvidence(unicodeExe);
  assert.equal(evidence.path, unicodeExe);
  assert.equal(calls[0].file, "powershell.exe");
  assert.equal(calls[0].argv.includes("-Command"), false);
  const encodedIndex = calls[0].argv.indexOf("-EncodedCommand");
  assert.ok(encodedIndex >= 0);
  const command = Buffer.from(calls[0].argv[encodedIndex + 1], "base64").toString("utf16le");
  assert.match(command, /Console.*OutputEncoding/);
  assert.match(command, /\$inputArgs/);
  assert.doesNotMatch(command, /\$args\[/);
  const payload = JSON.parse(Buffer.from(
    calls[0].options.env.WORKBUDDY_SKIN_PS_ARGS_B64,
    "base64",
  ).toString("utf8"));
  assert.deepEqual(payload, [unicodeExe]);
  assert.equal(calls[0].options.encoding, "utf8");
});

test("PowerShell JSON parser rejects ambiguous host output", () => {
  assert.deepEqual(parsePowerShellJson('\uFEFF{"ok":true}'), { ok: true });
  assert.equal(parsePowerShellJson(""), null);
  assert.throws(() => parsePowerShellJson("warning\n{}"), /invalid JSON/);
});
