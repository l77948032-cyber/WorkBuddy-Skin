import { execFile as execFileCallback, spawn as spawnCallback } from "node:child_process";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  CdpSession,
  captureScreenshot,
  listPageTargets,
  resolveBrowserIdentity,
} from "./cdp-client.mjs";
import {
  WORKBUDDY_DEFAULT_CSS_PATH,
  WORKBUDDY_DEFAULT_PORT,
  WORKBUDDY_DEFAULT_REGISTRY_PATH,
  WORKBUDDY_DEFAULT_TEMPLATE_PATH,
  WORKBUDDY_SKIN_VERSION,
  applyWorkBuddySession,
  loadWorkBuddyPayload,
  removeWorkBuddySession,
  verifyWorkBuddyRemovedSession,
  verifyWorkBuddySession,
} from "./workbuddy-injector.mjs";

const execFile = promisify(execFileCallback);
const filename = fileURLToPath(import.meta.url);
const scriptRoot = path.dirname(filename);
const projectRoot = path.resolve(scriptRoot, "..");

export const WINDOWS_RUNTIME_SCHEMA_VERSION = 1;
export const WORKBUDDY_WINDOWS_TESTED_VERSION = "5.3.8";
export const WORKBUDDY_WINDOWS_EXECUTABLE = "WorkBuddy.exe";
export const WORKBUDDY_WINDOWS_SIGNER = "Tencent Technology (Shenzhen) Company Limited";
export const WORKBUDDY_WINDOWS_RENDERER = "resources/app.asar/renderer/index.html";
export const WINDOWS_RUNTIME_COMMANDS = Object.freeze(["status", "apply", "verify", "restore"]);

const THEME_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const REVISION_PATTERN = /^[a-f0-9]{64}$/;
const CDP_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
const SESSION_TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "[::1]"]);
const DEFAULT_THEME_ID = "harbor-focus";
const DEFAULT_TIMEOUT_MS = 45_000;
export const MAX_WINDOWS_STATE_BYTES = 256 * 1024;
export const MAX_WINDOWS_LOCK_OWNER_BYTES = 4 * 1024;

export class WindowsRuntimeError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "WindowsRuntimeError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new WindowsRuntimeError(code, message, details);
}

function rollbackFailure(originalError, failures) {
  if (failures.length === 0) return originalError;
  const original = originalError instanceof Error
    ? { code: originalError.code || null, message: originalError.message }
    : { code: null, message: String(originalError) };
  return new WindowsRuntimeError(
    "APPLY_ROLLBACK_FAILED",
    `${original.message}; rollback was incomplete: ${failures.map((entry) => entry.message).join("; ")}`,
    { original, failures },
  );
}

function argumentValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) fail("INVALID_ARGUMENT", `${flag} requires a value`);
  return value;
}

export function parseWindowsRuntimeArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    fail("INVALID_ARGUMENT", "Expected a Windows runtime command: status, apply, verify, or restore");
  }
  const command = argv[0];
  if (![...WINDOWS_RUNTIME_COMMANDS, "__watch"].includes(command)) {
    fail("INVALID_ARGUMENT", `Unknown Windows runtime command: ${command}`);
  }
  const options = {
    command,
    port: WORKBUDDY_DEFAULT_PORT,
    portExplicit: false,
    themeId: null,
    revision: null,
    screenshot: null,
    workbuddyExe: null,
    statePath: null,
    sessionToken: null,
    browserId: null,
    workbuddyPid: null,
    workbuddyStartedAt: null,
    themeDir: null,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") {
      options.port = Number(argumentValue(argv, index, arg));
      options.portExplicit = true;
      index += 1;
    } else if (arg === "--theme") {
      options.themeId = argumentValue(argv, index, arg);
      index += 1;
    } else if (arg === "--revision") {
      options.revision = argumentValue(argv, index, arg);
      index += 1;
    } else if (arg === "--screenshot") {
      options.screenshot = path.resolve(argumentValue(argv, index, arg));
      index += 1;
    } else if (arg === "--workbuddy-exe") {
      options.workbuddyExe = argumentValue(argv, index, arg);
      index += 1;
    } else if (arg === "--state-path") {
      options.statePath = path.resolve(argumentValue(argv, index, arg));
      index += 1;
    } else if (arg === "--session-token") {
      options.sessionToken = argumentValue(argv, index, arg);
      index += 1;
    } else if (arg === "--browser-id") {
      options.browserId = argumentValue(argv, index, arg);
      index += 1;
    } else if (arg === "--workbuddy-pid") {
      options.workbuddyPid = Number(argumentValue(argv, index, arg));
      index += 1;
    } else if (arg === "--workbuddy-started-at") {
      options.workbuddyStartedAt = argumentValue(argv, index, arg);
      index += 1;
    } else if (arg === "--theme-dir") {
      options.themeDir = path.resolve(argumentValue(argv, index, arg));
      index += 1;
    } else {
      fail("INVALID_ARGUMENT", `Unknown Windows runtime argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    fail("INVALID_ARGUMENT", `Invalid Windows runtime port: ${options.port}`);
  }
  if (options.themeId !== null && !THEME_ID_PATTERN.test(options.themeId)) {
    fail("INVALID_ARGUMENT", `Invalid theme id: ${options.themeId}`);
  }
  if (options.revision !== null && !REVISION_PATTERN.test(options.revision)) {
    fail("INVALID_ARGUMENT", "Invalid theme revision");
  }
  if (options.browserId !== null && !CDP_ID_PATTERN.test(options.browserId)) {
    fail("INVALID_ARGUMENT", "Invalid browser identity");
  }
  if (options.sessionToken !== null && !SESSION_TOKEN_PATTERN.test(options.sessionToken)) {
    fail("INVALID_ARGUMENT", "Invalid watcher session token");
  }
  if (options.workbuddyPid !== null && (!Number.isInteger(options.workbuddyPid) || options.workbuddyPid <= 0)) {
    fail("INVALID_ARGUMENT", "Invalid WorkBuddy process id");
  }
  if (command === "apply" && !options.themeId) options.themeId = DEFAULT_THEME_ID;
  if (command !== "apply" && (options.themeId || options.revision)) {
    fail("INVALID_ARGUMENT", `${command} does not accept --theme or --revision`);
  }
  if (options.screenshot && command !== "verify") {
    fail("INVALID_ARGUMENT", `${command} does not accept --screenshot`);
  }
  if (command !== "__watch" && (
    options.statePath || options.sessionToken || options.browserId || options.workbuddyPid
    || options.workbuddyStartedAt || options.themeDir
  )) {
    fail("INVALID_ARGUMENT", "Internal watcher arguments are not accepted by public commands");
  }
  if (command === "__watch") {
    const complete = options.statePath && options.sessionToken && options.browserId
      && options.workbuddyPid && options.workbuddyStartedAt && options.workbuddyExe && options.themeDir;
    if (!complete) fail("INVALID_ARGUMENT", "The internal watcher invocation is incomplete");
  }
  return options;
}

function requiredWindowsEnvironment(env, name) {
  const value = env[name];
  if (!value) fail("MISSING_ENVIRONMENT", `${name} is required on Windows`);
  return value;
}

export function resolveWindowsRuntimeConfig(env = process.env, runtimePath = filename) {
  const localAppData = env.LOCALAPPDATA || null;
  const stateRoot = env.WORKBUDDY_DREAM_SKIN_HOME
    ? path.win32.resolve(env.WORKBUDDY_DREAM_SKIN_HOME)
    : path.win32.join(requiredWindowsEnvironment(env, "LOCALAPPDATA"), "WorkBuddyDreamSkin");
  const themesRoot = env.WORKBUDDY_DREAM_SKIN_THEMES_ROOT
    ? path.resolve(env.WORKBUDDY_DREAM_SKIN_THEMES_ROOT)
    : path.join(projectRoot, "plugins", "workbuddy", "catalog");
  return {
    runtimePath: path.resolve(runtimePath),
    projectRoot,
    localAppData,
    stateRoot,
    statePath: path.win32.join(stateRoot, "state.json"),
    lastThemePath: path.win32.join(stateRoot, "last-theme"),
    lockPath: path.win32.join(stateRoot, "operation.lock"),
    watcherLogPath: path.win32.join(stateRoot, "watcher.log"),
    watcherErrorLogPath: path.win32.join(stateRoot, "watcher-error.log"),
    themesRoot,
    cssPath: path.resolve(env.WORKBUDDY_DREAM_SKIN_CSS_PATH || WORKBUDDY_DEFAULT_CSS_PATH),
    templatePath: path.resolve(env.WORKBUDDY_DREAM_SKIN_TEMPLATE_PATH || WORKBUDDY_DEFAULT_TEMPLATE_PATH),
    registryPath: path.resolve(env.WORKBUDDY_DREAM_SKIN_REGISTRY_PATH || WORKBUDDY_DEFAULT_REGISTRY_PATH),
    explicitExecutable: env.WORKBUDDY_EXE || null,
  };
}

export function normalizeWindowsPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return path.win32.normalize(value.trim().replace(/^"|"$/g, "").replace(/^\\\\\?\\/, "")).toLowerCase();
}

export function sameWindowsPath(left, right) {
  const a = normalizeWindowsPath(left);
  const b = normalizeWindowsPath(right);
  return Boolean(a && b && a === b);
}

export function windowsCommandLineContainsPath(commandLine, expectedPath) {
  if (typeof commandLine !== "string" || typeof expectedPath !== "string") return false;
  const command = commandLine.replaceAll("/", "\\").toLowerCase();
  const expected = path.win32.normalize(expectedPath).toLowerCase();
  return command.includes(expected);
}

export function signerCommonName(subject) {
  if (typeof subject !== "string") return null;
  const match = subject.match(/(?:^|,)\s*CN=(?:"((?:[^"]|"")*)"|([^,]+))/i);
  return (match?.[1] ?? match?.[2] ?? "").replaceAll('""', '"').trim() || null;
}

export function parseWindowsVersion(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part ?? 0));
}

export function compareWindowsVersions(left, right) {
  const a = Array.isArray(left) ? left : parseWindowsVersion(left);
  const b = Array.isArray(right) ? right : parseWindowsVersion(right);
  if (!a || !b) fail("INVALID_PRODUCT_METADATA", "Could not compare invalid Windows versions");
  for (let index = 0; index < Math.max(a.length, b.length, 4); index += 1) {
    const difference = Number(a[index] || 0) - Number(b[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function validateWorkBuddyExecutableEvidence(raw, expectedPath = null) {
  const evidence = raw && typeof raw === "object" ? raw : {};
  const executablePath = evidence.path;
  if (!executablePath || !path.win32.isAbsolute(executablePath)) {
    fail("INVALID_WORKBUDDY", "WorkBuddy executable metadata did not contain an absolute path");
  }
  if (expectedPath && !sameWindowsPath(executablePath, expectedPath)) {
    fail("INVALID_WORKBUDDY", "WorkBuddy executable metadata resolved to a different path");
  }
  if (path.win32.basename(executablePath).toLowerCase() !== WORKBUDDY_WINDOWS_EXECUTABLE.toLowerCase()) {
    fail("INVALID_WORKBUDDY", `Expected ${WORKBUDDY_WINDOWS_EXECUTABLE}`);
  }
  if (String(evidence.signatureStatus || "").toLowerCase() !== "valid") {
    fail("INVALID_SIGNATURE", "WorkBuddy Authenticode status is not Valid");
  }
  const commonName = signerCommonName(evidence.signerSubject);
  if (commonName !== WORKBUDDY_WINDOWS_SIGNER) {
    fail("INVALID_SIGNATURE", `Unexpected WorkBuddy signer: ${commonName || "missing"}`);
  }
  if (String(evidence.productName || "").trim().toLowerCase() !== "workbuddy") {
    fail("INVALID_PRODUCT_METADATA", "WorkBuddy ProductName is invalid");
  }
  const originalFilename = String(evidence.originalFilename || "").trim();
  if (originalFilename && originalFilename.toLowerCase() !== "workbuddy.exe") {
    fail("INVALID_PRODUCT_METADATA", "WorkBuddy OriginalFilename is invalid");
  }
  const version = String(evidence.productVersion || evidence.fileVersion || "").trim();
  if (!parseWindowsVersion(version)) {
    fail("INVALID_PRODUCT_METADATA", "WorkBuddy product version is invalid");
  }
  if (compareWindowsVersions(version, WORKBUDDY_WINDOWS_TESTED_VERSION) < 0) {
    fail(
      "UNSUPPORTED_WORKBUDDY_VERSION",
      `WorkBuddy ${version} is older than the minimum tested Windows version ${WORKBUDDY_WINDOWS_TESTED_VERSION}`,
    );
  }
  if (evidence.asarExists !== true) {
    fail("INVALID_PRODUCT_METADATA", "WorkBuddy resources/app.asar is missing");
  }
  const companyName = String(evidence.companyName || "").trim();
  if (companyName !== WORKBUDDY_WINDOWS_SIGNER) {
    fail("INVALID_PRODUCT_METADATA", `Unexpected WorkBuddy company metadata: ${companyName || "missing"}`);
  }
  return {
    path: path.win32.normalize(executablePath),
    signatureStatus: "Valid",
    signerCommonName: commonName,
    signerThumbprint: String(evidence.signerThumbprint || "").trim() || null,
    productName: "WorkBuddy",
    originalFilename: originalFilename || null,
    companyName,
    productVersion: version,
    fileVersion: String(evidence.fileVersion || "").trim() || null,
    testedVersion: WORKBUDDY_WINDOWS_TESTED_VERSION,
    rendererPath: WORKBUDDY_WINDOWS_RENDERER,
  };
}

export function registryExecutableCandidates(entries) {
  const results = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!/workbuddy/i.test(String(entry?.displayName || ""))) continue;
    if (typeof entry.installLocation === "string" && entry.installLocation.trim()) {
      results.push(path.win32.join(entry.installLocation.trim(), WORKBUDDY_WINDOWS_EXECUTABLE));
    }
    if (typeof entry.displayIcon === "string" && entry.displayIcon.trim()) {
      const icon = entry.displayIcon.trim().replace(/^"([^\"]+)"(?:,\s*-?\d+)?$/, "$1")
        .replace(/,\s*-?\d+$/, "");
      if (path.win32.basename(icon).toLowerCase() === WORKBUDDY_WINDOWS_EXECUTABLE.toLowerCase()) {
        results.push(icon);
      }
    }
  }
  return uniqueWindowsPaths(results);
}

export function uniqueWindowsPaths(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeWindowsPath(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(path.win32.normalize(String(value).trim().replace(/^"|"$/g, "")));
  }
  return result;
}

export function normalizeProcessSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const pid = Number(raw.pid ?? raw.ProcessId);
  const parentPid = Number(raw.parentPid ?? raw.ParentProcessId ?? 0);
  const executablePath = raw.executablePath ?? raw.ExecutablePath ?? null;
  const startedAt = raw.startedAt ?? raw.CreationDate ?? null;
  const name = raw.name ?? raw.Name ?? (executablePath ? path.win32.basename(executablePath) : null);
  const commandLine = raw.commandLine ?? raw.CommandLine ?? "";
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return {
    pid,
    parentPid: Number.isInteger(parentPid) && parentPid >= 0 ? parentPid : 0,
    executablePath: typeof executablePath === "string" ? path.win32.normalize(executablePath) : null,
    startedAt: typeof startedAt === "string" && startedAt ? startedAt : null,
    name: typeof name === "string" ? name : null,
    commandLine: typeof commandLine === "string" ? commandLine : "",
  };
}

export function normalizeProcessSnapshots(raw) {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.map(normalizeProcessSnapshot).filter(Boolean);
}

export function processIdentity(processInfo) {
  const normalized = normalizeProcessSnapshot(processInfo);
  if (!normalized?.executablePath || !normalized.startedAt) return null;
  return {
    pid: normalized.pid,
    executablePath: normalized.executablePath,
    startedAt: normalized.startedAt,
  };
}

export function processMatchesIdentity(processInfo, identity) {
  const process = normalizeProcessSnapshot(processInfo);
  return Boolean(
    process && identity
    && process.pid === Number(identity.pid)
    && sameWindowsPath(process.executablePath, identity.executablePath)
    && process.startedAt === identity.startedAt
  );
}

export function isWorkBuddyMainProcess(processInfo, executablePath) {
  const process = normalizeProcessSnapshot(processInfo);
  return Boolean(
    process?.executablePath
    && process.startedAt
    && sameWindowsPath(process.executablePath, executablePath)
    && !/(?:^|\s)--type(?:=|\s)/i.test(process.commandLine)
  );
}

export function isDebugLaunchedWorkBuddyMain(processInfo, executablePath) {
  const process = normalizeProcessSnapshot(processInfo);
  return isWorkBuddyMainProcess(process, executablePath)
    && /(?:^|\s)--remote-debugging-address=127\.0\.0\.1(?:\s|$)/i.test(process.commandLine);
}

function processIdentityKey(processInfo) {
  const identity = processIdentity(processInfo);
  return identity
    ? `${identity.pid}|${normalizeWindowsPath(identity.executablePath)}|${identity.startedAt}`
    : null;
}

export function normalizeListeners(raw) {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.map((entry) => ({
    address: String(entry?.address ?? entry?.LocalAddress ?? ""),
    port: Number(entry?.port ?? entry?.LocalPort),
    pid: Number(entry?.pid ?? entry?.OwningProcess),
  })).filter((entry) => entry.address && Number.isInteger(entry.port)
    && Number.isInteger(entry.pid) && entry.pid > 0);
}

export function validateLoopbackListeners(listeners, expectedPort) {
  const normalized = normalizeListeners(listeners);
  if (normalized.length === 0) fail("PORT_NOT_LISTENING", `Nothing is listening on port ${expectedPort}`);
  for (const listener of normalized) {
    if (listener.port !== Number(expectedPort)) fail("PORT_OWNERSHIP", "Listener port changed during validation");
    if (!LOOPBACK_ADDRESSES.has(listener.address.toLowerCase())) {
      fail("PORT_EXPOSED", `CDP is not loopback-only: ${listener.address}:${listener.port}`);
    }
  }
  return normalized;
}

function processMap(processes) {
  return new Map(normalizeProcessSnapshots(processes).map((entry) => [entry.pid, entry]));
}

export function workBuddyAncestorForListener(listenerPid, processes, ownerIdentity) {
  const byPid = processMap(processes);
  const visited = new Set();
  let current = byPid.get(Number(listenerPid));
  for (let depth = 0; current && depth < 64; depth += 1) {
    if (visited.has(current.pid)) fail("PORT_OWNERSHIP", "Process ancestry contains a cycle");
    visited.add(current.pid);
    if (processMatchesIdentity(current, ownerIdentity)) return current;
    if (!current.parentPid || current.parentPid === current.pid) break;
    const parent = byPid.get(current.parentPid);
    if (!parent) break;
    const childStartedAt = Date.parse(current.startedAt || "");
    const parentStartedAt = Date.parse(parent.startedAt || "");
    if (!Number.isFinite(childStartedAt) || !Number.isFinite(parentStartedAt)
      || childStartedAt < parentStartedAt) {
      fail("PORT_OWNERSHIP", `Listener PID ${listenerPid} has invalid process ancestry timing`);
    }
    current = parent;
  }
  fail("PORT_OWNERSHIP", `Listener PID ${listenerPid} is not a descendant of the recorded WorkBuddy process`);
}

export function validateOwnedPort({ listeners, processes, port, ownerIdentity }) {
  const normalized = validateLoopbackListeners(listeners, port);
  for (const listener of normalized) {
    workBuddyAncestorForListener(listener.pid, processes, ownerIdentity);
  }
  return { pass: true, listeners: normalized, ownerPid: Number(ownerIdentity.pid) };
}

export function isPlausibleWindowsWorkBuddyRendererTarget(target, executablePath = null) {
  if (target?.type !== "page" || typeof target.url !== "string") return false;
  try {
    const url = new URL(target.url);
    const rendererPath = decodeURIComponent(url.pathname).replaceAll("\\", "/");
    if (url.protocol !== "file:" || url.hostname !== "" || url.search !== "" || url.hash !== ""
      || !/^\/[A-Za-z]:\/(?:[^/]+\/)+resources\/app\.asar\/renderer\/index\.html$/i.test(rendererPath)) {
      return false;
    }
    if (!/workbuddy/i.test(`${target.title || ""} ${rendererPath}`)) return false;
    if (!executablePath) return true;
    const decodedPath = decodeURIComponent(url.pathname);
    if (decodedPath.includes("\\")) return false;
    const segments = decodedPath.split("/");
    if (segments.some((segment) => segment === "." || segment === "..")) return false;
    const candidate = path.win32.normalize(decodedPath.replace(/^\/(?=[A-Za-z]:\/)/, "").replaceAll("/", "\\"));
    const expected = path.win32.join(
      path.win32.dirname(executablePath),
      "resources",
      "app.asar",
      "renderer",
      "index.html",
    );
    return sameWindowsPath(candidate, expected);
  } catch {
    return false;
  }
}

const WINDOWS_WORKBUDDY_PROBE = String.raw`(() => {
  const root = document.querySelector('#root');
  const shell = document.querySelector('.teams-container');
  const sidebar = document.querySelector('.conversation-sidebar');
  const content = document.querySelector('.teams-content-wrapper');
  const main = document.querySelector('.teams-main-content, .main-content');
  const rect = document.body?.getBoundingClientRect?.();
  return {
    root: Boolean(root),
    shell: Boolean(shell),
    sidebar: Boolean(sidebar),
    content: Boolean(content),
    main: Boolean(main),
    rootChildren: root?.childElementCount || 0,
    interactive: document.querySelectorAll('button, input, textarea, select, [contenteditable="true"], [role="button"], [role="textbox"]').length,
    width: Math.round(innerWidth || rect?.width || 0),
    height: Math.round(innerHeight || rect?.height || 0),
  };
})()`;

export function classifyWindowsWorkBuddyProbe(raw, target, executablePath = null) {
  const probe = raw && typeof raw === "object" ? raw : {};
  const trustedRendererUrl = isPlausibleWindowsWorkBuddyRendererTarget(target, executablePath);
  const shellStructure = Boolean(probe.root && probe.shell && probe.sidebar && probe.content && probe.main)
    && Number(probe.rootChildren) >= 1
    && Number(probe.interactive) >= 2
    && Number(probe.width) >= 500
    && Number(probe.height) >= 320;
  return { ...probe, trustedRendererUrl, shellStructure, matched: trustedRendererUrl && shellStructure };
}

export async function probeWindowsWorkBuddySession(session, target, executablePath = null) {
  return classifyWindowsWorkBuddyProbe(
    await session.evaluate(WINDOWS_WORKBUDDY_PROBE),
    target,
    executablePath,
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function connectWindowsWorkBuddyTargets({
  port,
  browserId,
  executablePath,
  timeoutMs = 20_000,
  fetchImpl = globalThis.fetch,
  Session = CdpSession,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastSummary = "no targets";
  while (Date.now() < deadline) {
    await resolveBrowserIdentity(port, browserId, fetchImpl);
    const connected = [];
    const rejected = [];
    for (const target of await listPageTargets(port, null, fetchImpl)) {
      let session;
      try {
        if (!isPlausibleWindowsWorkBuddyRendererTarget(target, executablePath)) {
          rejected.push(`${target.id}:url`);
          continue;
        }
        session = await new Session(target, port).open();
        const probe = await probeWindowsWorkBuddySession(session, target, executablePath);
        if (probe.matched) connected.push({ target, session, probe });
        else {
          rejected.push(`${target.id}:fingerprint`);
          session.close();
        }
      } catch (error) {
        session?.close();
        rejected.push(`${target.id}:${error.message}`);
      }
    }
    if (connected.length) return connected;
    lastSummary = rejected.join(", ") || "no valid page targets";
    await delay(300);
  }
  fail("RENDERER_NOT_FOUND", `No verified Windows WorkBuddy renderer was found (${lastSummary})`);
}

export async function runWindowsWorkBuddyOneShot({
  mode,
  port,
  browserId,
  executablePath,
  themeDir,
  cssPath = WORKBUDDY_DEFAULT_CSS_PATH,
  templatePath = WORKBUDDY_DEFAULT_TEMPLATE_PATH,
  registryPath = WORKBUDDY_DEFAULT_REGISTRY_PATH,
  screenshot = null,
  timeoutMs = 20_000,
  fetchImpl = globalThis.fetch,
  Session = CdpSession,
}) {
  if (!["apply", "verify", "remove"].includes(mode)) fail("INVALID_ARGUMENT", `Invalid injection mode: ${mode}`);
  const payload = mode === "remove" ? null : await loadWorkBuddyPayload({
    themeDir,
    cssPath,
    templatePath,
    registryPath,
  });
  const connected = await connectWindowsWorkBuddyTargets({
    port,
    browserId,
    executablePath,
    timeoutMs,
    fetchImpl,
    Session,
  });
  const results = [];
  let captured = null;
  try {
    for (const { target, session, probe } of connected) {
      try {
        await resolveBrowserIdentity(port, browserId, fetchImpl);
        if (mode === "apply") await applyWorkBuddySession(session, payload.payload);
        if (mode === "remove") await removeWorkBuddySession(session);
        let result;
        if (mode === "remove") {
          result = await verifyWorkBuddyRemovedSession(session);
        } else {
          const deadline = Date.now() + timeoutMs;
          do {
            result = await verifyWorkBuddySession(session, payload.theme.id);
            if (result?.pass) break;
            await delay(200);
          } while (Date.now() < deadline);
        }
        results.push({ targetId: target.id, title: target.title, url: target.url, probe, result });
        if (screenshot && !captured) captured = await captureScreenshot(session, screenshot);
      } finally {
        session.close();
      }
    }
  } finally {
    for (const { session } of connected) session.close();
  }
  const pass = results.length > 0 && results.every((entry) => (
    mode === "remove" ? entry.result === true : entry.result?.pass === true
  ));
  return {
    mode,
    pass,
    version: WORKBUDDY_SKIN_VERSION,
    port,
    browserId,
    themeId: payload?.theme?.id ?? null,
    screenshot: captured,
    targets: results,
  };
}

function powershellArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

export function parsePowerShellJson(stdout, label = "PowerShell") {
  const text = String(stdout || "").replace(/^\uFEFF/, "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("HOST_COMMAND_FAILED", `${label} returned invalid JSON: ${error.message}`);
  }
}

export function rotateWatcherLogSync(filePath, maxBytes = 2 * 1024 * 1024) {
  try {
    if (fsSync.statSync(filePath).size <= maxBytes) return false;
    const prior = `${filePath}.1`;
    fsSync.rmSync(prior, { force: true });
    fsSync.renameSync(filePath, prior);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export class WatcherFailureBudget {
  constructor({ limit = 12, baseDelayMs = 900, maxDelayMs = 30_000, now = Date.now } = {}) {
    this.limit = limit;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.now = now;
    this.entries = new Map();
  }

  record(key, message) {
    const previous = this.entries.get(key);
    const sameMessage = previous?.message === String(message);
    const count = sameMessage ? previous.count + 1 : 1;
    const delayMs = Math.min(this.maxDelayMs, this.baseDelayMs * (2 ** Math.min(count - 1, 8)));
    const fatal = count >= this.limit;
    const entry = {
      count,
      message: String(message),
      delayMs,
      nextAttemptAt: this.now() + delayMs,
      shouldLog: fatal || count === 1 || (count & (count - 1)) === 0,
      fatal,
    };
    this.entries.set(key, entry);
    return entry;
  }

  ready(key) {
    return (this.entries.get(key)?.nextAttemptAt ?? 0) <= this.now();
  }

  reset(key) {
    this.entries.delete(key);
  }
}

async function invokePowerShell(script, args = [], exec = execFile) {
  const payload = Buffer.from(JSON.stringify(args.map(String)), "utf8").toString("base64");
  const preamble = String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$inputArgsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:WORKBUDDY_SKIN_PS_ARGS_B64))
$inputArgs = @(ConvertFrom-Json -InputObject $inputArgsJson)
`;
  const encodedCommand = Buffer.from(`${preamble}\n${script}`, "utf16le").toString("base64");
  const { stdout } = await exec("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-EncodedCommand", encodedCommand,
  ], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    encoding: "utf8",
    env: { ...process.env, WORKBUDDY_SKIN_PS_ARGS_B64: payload },
  });
  return parsePowerShellJson(stdout);
}

const EXECUTABLE_EVIDENCE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$resolved = [IO.Path]::GetFullPath($inputArgs[0])
$item = Get-Item -LiteralPath $resolved -ErrorAction Stop
$signature = Get-AuthenticodeSignature -LiteralPath $item.FullName -ErrorAction Stop
$version = $item.VersionInfo
$asar = Join-Path $item.DirectoryName 'resources\app.asar'
[pscustomobject]@{
  path = $item.FullName
  signatureStatus = [string]$signature.Status
  signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
  signerThumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }
  productName = $version.ProductName
  originalFilename = $version.OriginalFilename
  companyName = $version.CompanyName
  productVersion = $version.ProductVersion
  fileVersion = $version.FileVersion
  asarExists = [bool](Test-Path -LiteralPath $asar -PathType Leaf)
} | ConvertTo-Json -Compress
`;

const PROCESS_SNAPSHOT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$items = @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object {
  $created = $null
  if ($_.CreationDate) { $created = $_.CreationDate.ToUniversalTime().ToString('o') }
  [pscustomobject]@{
    pid = [int]$_.ProcessId
    parentPid = [int]$_.ParentProcessId
    executablePath = $_.ExecutablePath
    commandLine = $_.CommandLine
    name = $_.Name
    startedAt = $created
  }
})
ConvertTo-Json -InputObject $items -Compress
`;

const REGISTRY_CANDIDATES_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$roots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$items = @()
foreach ($root in $roots) {
  $items += @(Get-ItemProperty -Path $root -ErrorAction SilentlyContinue | Where-Object {
    [string]$_.DisplayName -match 'WorkBuddy'
  } | ForEach-Object {
    [pscustomobject]@{
      displayName = $_.DisplayName
      installLocation = $_.InstallLocation
      displayIcon = $_.DisplayIcon
    }
  })
}
ConvertTo-Json -InputObject $items -Compress
`;

const LISTENERS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
  throw 'Get-NetTCPConnection is unavailable'
}
$port = [int]$inputArgs[0]
$items = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{
    address = $_.LocalAddress
    port = [int]$_.LocalPort
    pid = [int]$_.OwningProcess
  }
})
ConvertTo-Json -InputObject $items -Compress
`;

const STOP_EXACT_PROCESS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$pidValue = [int]$inputArgs[0]
$expectedPath = [IO.Path]::GetFullPath($inputArgs[1])
$expectedStart = $inputArgs[2]
$mode = $inputArgs[3]
$requiredToken = if ($inputArgs.Count -gt 4) { $inputArgs[4] } else { '' }
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
if (-not $process) { [pscustomobject]@{ matched = $false; stopped = $true } | ConvertTo-Json -Compress; exit 0 }
$actualPath = [IO.Path]::GetFullPath([string]$process.ExecutablePath)
$actualStart = $process.CreationDate.ToUniversalTime().ToString('o')
if (-not [string]::Equals($actualPath, $expectedPath, [StringComparison]::OrdinalIgnoreCase) -or $actualStart -ne $expectedStart) {
  throw 'Process identity mismatch'
}
if ($requiredToken -and ([string]$process.CommandLine).IndexOf($requiredToken, [StringComparison]::Ordinal) -lt 0) {
  throw 'Process command token mismatch'
}
$native = Get-Process -Id $pidValue -ErrorAction Stop
$nativePath = [IO.Path]::GetFullPath([string]$native.Path)
$nativeStart = $native.StartTime.ToUniversalTime().ToString('o')
if (-not [string]::Equals($nativePath, $expectedPath, [StringComparison]::OrdinalIgnoreCase) -or $nativeStart -ne $expectedStart) {
  throw 'Native process identity mismatch'
}
if ($mode -eq 'close') {
  $null = $native.CloseMainWindow()
} elseif ($mode -eq 'stop') {
  Stop-Process -Id $pidValue -ErrorAction Stop
} else {
  throw 'Invalid stop mode'
}
[pscustomobject]@{ matched = $true; stopped = $true } | ConvertTo-Json -Compress
`;

export function createDefaultWindowsHost({ exec = execFile, spawn = spawnCallback } = {}) {
  return {
    platform: process.platform,
    pid: process.pid,
    env: process.env,
    now: () => new Date().toISOString(),
    sleep: delay,
    randomToken: () => crypto.randomBytes(16).toString("hex"),
    executableEvidence: async (executablePath) => invokePowerShell(
      EXECUTABLE_EVIDENCE_SCRIPT,
      [executablePath],
      exec,
    ),
    processSnapshots: async () => normalizeProcessSnapshots(await invokePowerShell(
      PROCESS_SNAPSHOT_SCRIPT,
      [],
      exec,
    )),
    registryEntries: async () => powershellArray(await invokePowerShell(
      REGISTRY_CANDIDATES_SCRIPT,
      [],
      exec,
    )),
    listeners: async (port) => normalizeListeners(await invokePowerShell(
      LISTENERS_SCRIPT,
      [port],
      exec,
    )),
    stopExactProcess: async (identity, { graceful = false, commandToken = "" } = {}) => invokePowerShell(
      STOP_EXACT_PROCESS_SCRIPT,
      [identity.pid, identity.executablePath, identity.startedAt, graceful ? "close" : "stop", commandToken],
      exec,
    ),
    launchWorkBuddy: (executablePath, { debugPort = null } = {}) => {
      const args = debugPort ? ["--remote-debugging-address=127.0.0.1"] : [];
      const env = { ...process.env };
      if (debugPort) env.WORKBUDDY_REMOTE_DEBUGGING_PORT = String(debugPort);
      else delete env.WORKBUDDY_REMOTE_DEBUGGING_PORT;
      const child = spawn(executablePath, args, {
        cwd: path.win32.dirname(executablePath),
        detached: true,
        env,
        stdio: "ignore",
        windowsHide: false,
      });
      child.on?.("error", () => {});
      child.unref();
      return { pid: child.pid };
    },
    launchWatcher: (runtimePath, args, { stdoutPath, stderrPath }) => {
      rotateWatcherLogSync(stdoutPath);
      rotateWatcherLogSync(stderrPath);
      const stdout = fsSync.openSync(stdoutPath, "a", 0o600);
      const stderr = fsSync.openSync(stderrPath, "a", 0o600);
      try {
        const child = spawn(process.execPath, [runtimePath, ...args], {
          cwd: path.dirname(runtimePath),
          detached: true,
          env: { ...process.env },
          stdio: ["ignore", stdout, stderr],
          windowsHide: true,
        });
        child.on?.("error", () => {});
        child.unref();
        return { pid: child.pid, executablePath: process.execPath };
      } finally {
        fsSync.closeSync(stdout);
        fsSync.closeSync(stderr);
      }
    },
    fetchImpl: globalThis.fetch,
    Session: CdpSession,
  };
}

async function pathIsFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function discoverOfficialWorkBuddy({
  explicitPath = null,
  envPath = null,
  localAppData = null,
  processes = [],
  registryEntries = [],
  inspectExecutable,
  isFile = pathIsFile,
}) {
  if (typeof inspectExecutable !== "function") fail("HOST_CONFIGURATION", "inspectExecutable is required");
  const override = explicitPath || envPath;
  if (override) {
    if (!path.win32.isAbsolute(override)) fail("INVALID_WORKBUDDY", "The WorkBuddy executable override must be absolute");
    if (!await isFile(override)) fail("WORKBUDDY_NOT_FOUND", `WorkBuddy executable was not found: ${override}`);
    return validateWorkBuddyExecutableEvidence(await inspectExecutable(override), override);
  }

  const running = normalizeProcessSnapshots(processes)
    .filter((entry) => entry.executablePath
      && path.win32.basename(entry.executablePath).toLowerCase() === WORKBUDDY_WINDOWS_EXECUTABLE.toLowerCase())
    .map((entry) => entry.executablePath);
  const registry = registryExecutableCandidates(registryEntries);
  const defaults = localAppData
    ? [path.win32.join(localAppData, "Programs", "WorkBuddy", WORKBUDDY_WINDOWS_EXECUTABLE)]
    : [];
  const candidates = uniqueWindowsPaths([...running, ...registry, ...defaults]);
  const verified = [];
  for (const candidate of candidates) {
    if (!await isFile(candidate)) continue;
    try {
      verified.push(validateWorkBuddyExecutableEvidence(await inspectExecutable(candidate), candidate));
    } catch {}
  }
  if (verified.length === 0) {
    fail("WORKBUDDY_NOT_FOUND", "Could not find an official signed WorkBuddy.exe");
  }
  const unique = uniqueWindowsPaths(verified.map((entry) => entry.path));
  if (unique.length > 1) {
    fail("AMBIGUOUS_WORKBUDDY", "Multiple verified WorkBuddy installations were found; use --workbuddy-exe");
  }
  return verified.find((entry) => sameWindowsPath(entry.path, unique[0]));
}

export function validateWindowsRuntimeState(raw, { stateRoot = null } = {}) {
  const state = raw && typeof raw === "object" ? raw : null;
  if (!state) fail("INVALID_STATE", "Windows runtime state is not an object");
  if (state.schemaVersion !== WINDOWS_RUNTIME_SCHEMA_VERSION || state.platform !== "win32"
    || !["active", "recovery"].includes(state.session) || state.ownsSession !== true) {
    fail("INVALID_STATE", "Windows runtime state header is invalid");
  }
  const recovery = state.session === "recovery";
  if (!SESSION_TOKEN_PATTERN.test(String(state.sessionToken || ""))) fail("INVALID_STATE", "Session token is invalid");
  if (!THEME_ID_PATTERN.test(String(state.themeId || ""))) fail("INVALID_STATE", "Theme id is invalid");
  if (state.themeRevision !== null && state.themeRevision !== undefined
    && !REVISION_PATTERN.test(String(state.themeRevision))) fail("INVALID_STATE", "Theme revision is invalid");
  if (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535) fail("INVALID_STATE", "Port is invalid");
  if ((!recovery || state.browserId !== null) && !CDP_ID_PATTERN.test(String(state.browserId || ""))) {
    fail("INVALID_STATE", "Browser identity is invalid");
  }
  const identityPresent = (prefix) => {
    const pid = state[`${prefix}Pid`];
    const startedAt = state[`${prefix}StartedAt`];
    const executablePath = state[`${prefix}Exe`];
    const any = pid !== null || startedAt !== null
      || (prefix === "watcher" && executablePath !== null);
    if (!any) return false;
    if (!Number.isInteger(pid) || pid <= 0 || typeof startedAt !== "string" || !startedAt
      || typeof executablePath !== "string" || !path.win32.isAbsolute(executablePath)) {
      fail("INVALID_STATE", `${prefix} process identity is invalid`);
    }
    return true;
  };
  const workbuddyIdentityPresent = identityPresent("workbuddy");
  const watcherIdentityPresent = identityPresent("watcher");
  if (!recovery && (!workbuddyIdentityPresent || !watcherIdentityPresent)) {
    fail("INVALID_STATE", "Active runtime state requires WorkBuddy and watcher identities");
  }
  let listenerIdentityCount = 0;
  if (state.listenerIdentities !== undefined) {
    if (!Array.isArray(state.listenerIdentities) || state.listenerIdentities.length > 32) {
      fail("INVALID_STATE", "Recorded listener identities are invalid");
    }
    for (const identity of state.listenerIdentities) {
      if (!Number.isInteger(identity?.pid) || identity.pid <= 0
        || typeof identity.startedAt !== "string" || !identity.startedAt
        || typeof identity.executablePath !== "string"
        || !path.win32.isAbsolute(identity.executablePath)) {
        fail("INVALID_STATE", "Recorded listener identity is invalid");
      }
    }
    listenerIdentityCount = state.listenerIdentities.length;
  }
  if (recovery && !workbuddyIdentityPresent && !watcherIdentityPresent && listenerIdentityCount === 0) {
    fail("INVALID_STATE", "Recovery runtime state requires a residual process identity");
  }
  if (typeof state.createdAt !== "string" || !state.createdAt) fail("INVALID_STATE", "createdAt is invalid");
  for (const key of ["statePath", "workbuddyExe", "runtimePath", "themeDir"]) {
    if (typeof state[key] !== "string" || !path.win32.isAbsolute(state[key])) {
      fail("INVALID_STATE", `${key} is invalid`);
    }
  }
  if (path.win32.basename(state.workbuddyExe).toLowerCase() !== "workbuddy.exe") {
    fail("INVALID_STATE", "Recorded WorkBuddy executable is invalid");
  }
  if (path.win32.basename(state.runtimePath).toLowerCase() !== "workbuddy-runtime-windows.mjs") {
    fail("INVALID_STATE", "Recorded Windows runtime path is invalid");
  }
  if (state.signerCommonName !== WORKBUDDY_WINDOWS_SIGNER) fail("INVALID_STATE", "Recorded signer is invalid");
  if (state.skinVersion !== WORKBUDDY_SKIN_VERSION) fail("INVALID_STATE", "Recorded skin version is invalid");
  if (stateRoot && !sameWindowsPath(path.win32.dirname(state.statePath || ""), stateRoot)) {
    fail("INVALID_STATE", "Recorded state path is outside the runtime state root");
  }
  return { ...state };
}

function sameNativePath(left, right) {
  if (process.platform === "win32") return sameWindowsPath(left, right);
  return path.resolve(left) === path.resolve(right);
}

export async function ensureSecureDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
  return validateSecureDirectory(directoryPath);
}

async function validateSecureDirectory(directoryPath) {
  const stat = await fs.lstat(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("UNSAFE_STATE_PATH", `Runtime directory is not a real directory: ${directoryPath}`);
  }
  return fs.realpath(directoryPath);
}

export async function readBoundedJsonFile(filePath, {
  maxBytes = MAX_WINDOWS_STATE_BYTES,
  allowedRoot = null,
  errorCode = "INVALID_STATE_FILE",
} = {}) {
  if (allowedRoot) {
    const root = await validateSecureDirectory(allowedRoot);
    const parent = await fs.realpath(path.dirname(filePath));
    if (!sameNativePath(parent, root)) fail(errorCode, "JSON state file is outside its allowed root");
  }
  const before = await fs.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || before.size <= 0 || before.size > maxBytes) {
    fail(errorCode, "JSON state file must be a bounded regular file");
  }
  const real = await fs.realpath(filePath);
  const expected = path.join(await fs.realpath(path.dirname(filePath)), path.basename(filePath));
  if (!sameNativePath(real, expected)) fail(errorCode, "JSON state file resolves through a link");
  const handle = await fs.open(filePath, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size <= 0 || opened.size > maxBytes
      || (before.dev !== undefined && opened.dev !== before.dev)
      || (before.ino !== undefined && opened.ino !== before.ino)) {
      fail(errorCode, "JSON state file changed while it was opened");
    }
    const buffer = await handle.readFile();
    if (buffer.length !== opened.size || buffer.length > maxBytes) {
      fail(errorCode, "JSON state file changed while it was read");
    }
    try {
      return JSON.parse(buffer.toString("utf8"));
    } catch (error) {
      fail(errorCode, `JSON state file is invalid: ${error.message}`);
    }
  } finally {
    await handle.close();
  }
}

async function writeJsonAtomic(filePath, value) {
  await ensureSecureDirectory(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
}

export class WindowsOperationLock {
  constructor(lockPath, { pid = process.pid, token = crypto.randomBytes(16).toString("hex"), isPidAlive } = {}) {
    this.lockPath = lockPath;
    this.pid = pid;
    this.token = token;
    this.isPidAlive = isPidAlive || ((candidate) => {
      try {
        process.kill(candidate, 0);
        return true;
      } catch {
        return false;
      }
    });
    this.held = false;
  }

  async acquire() {
    await ensureSecureDirectory(path.dirname(this.lockPath));
    const ownerRecord = {
      pid: this.pid,
      token: this.token,
      createdAt: new Date().toISOString(),
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimPath = `${this.lockPath}.claim-${this.pid}-${this.token}`;
      await fs.rm(claimPath, { recursive: true, force: true });
      try {
        await fs.mkdir(claimPath, { mode: 0o700 });
        await fs.writeFile(
          path.join(claimPath, "owner.json"),
          JSON.stringify(ownerRecord),
          { mode: 0o600 },
        );
        await fs.rename(claimPath, this.lockPath);
        this.held = true;
        return;
      } catch (error) {
        await fs.rm(claimPath, { recursive: true, force: true });
        try {
          await fs.stat(this.lockPath);
        } catch {
          throw error;
        }
      }
      let owner;
      try {
        owner = await readBoundedJsonFile(path.join(this.lockPath, "owner.json"), {
          maxBytes: MAX_WINDOWS_LOCK_OWNER_BYTES,
          allowedRoot: this.lockPath,
          errorCode: "INVALID_LOCK_OWNER",
        });
      } catch {
        fail("OPERATION_LOCKED", "The WorkBuddy skin operation lock owner is invalid");
      }
      if (!Number.isInteger(owner?.pid) || owner.pid <= 0 || !SESSION_TOKEN_PATTERN.test(owner.token || "")) {
        fail("OPERATION_LOCKED", "The WorkBuddy skin operation lock owner is invalid");
      }
      if (this.isPidAlive(owner.pid)) {
        fail("OPERATION_LOCKED", "Another WorkBuddy skin operation is already running");
      }
      const quarantine = `${this.lockPath}.stale-${this.pid}-${this.token}-${attempt}`;
      try {
        await fs.rename(this.lockPath, quarantine);
      } catch {
        continue;
      }
      let movedOwner = null;
      try {
        movedOwner = await readBoundedJsonFile(path.join(quarantine, "owner.json"), {
          maxBytes: MAX_WINDOWS_LOCK_OWNER_BYTES,
          allowedRoot: quarantine,
          errorCode: "INVALID_LOCK_OWNER",
        });
      } catch {}
      if (movedOwner?.pid !== owner.pid || movedOwner?.token !== owner.token) {
        try { await fs.rename(quarantine, this.lockPath); } catch {}
        fail("OPERATION_LOCKED", "The WorkBuddy skin operation lock changed during recovery");
      }
      await fs.rm(quarantine, { recursive: true, force: true });
    }
    fail("OPERATION_LOCKED", "The WorkBuddy skin operation lock could not be acquired");
  }

  async release() {
    if (!this.held) return;
    const quarantine = `${this.lockPath}.release-${this.pid}-${this.token}`;
    try {
      await fs.rm(quarantine, { recursive: true, force: true });
      await fs.rename(this.lockPath, quarantine);
      const owner = await readBoundedJsonFile(path.join(quarantine, "owner.json"), {
        maxBytes: MAX_WINDOWS_LOCK_OWNER_BYTES,
        allowedRoot: quarantine,
        errorCode: "INVALID_LOCK_OWNER",
      });
      if (owner?.pid === this.pid && owner?.token === this.token) {
        await fs.rm(quarantine, { recursive: true, force: true });
      } else {
        try { await fs.rename(quarantine, this.lockPath); } catch {}
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    this.held = false;
  }
}

async function waitUntil(check, { timeoutMs, intervalMs = 200, sleep = delay }) {
  const deadline = Date.now() + timeoutMs;
  let result = null;
  while (Date.now() < deadline) {
    result = await check();
    if (result) return result;
    await sleep(intervalMs);
  }
  return null;
}

function identityFromState(state, prefix) {
  if (!Number.isInteger(state[`${prefix}Pid`])) return null;
  return {
    pid: state[`${prefix}Pid`],
    executablePath: state[`${prefix}Exe`],
    startedAt: state[`${prefix}StartedAt`],
  };
}

export class WindowsWorkBuddyRuntime {
  constructor({ host = createDefaultWindowsHost(), config = null, env = process.env } = {}) {
    this.host = host;
    this.config = config || (host.platform === "win32" ? resolveWindowsRuntimeConfig(env) : {});
    this.oneShot = host.oneShot || runWindowsWorkBuddyOneShot;
  }

  assertWindows() {
    if (this.host.platform !== "win32") fail("UNSUPPORTED_PLATFORM", "This runtime requires Windows");
  }

  async withLock(callback) {
    const lock = new WindowsOperationLock(this.config.lockPath);
    await lock.acquire();
    try {
      return await callback();
    } finally {
      await lock.release();
    }
  }

  async snapshots() {
    return normalizeProcessSnapshots(await this.host.processSnapshots());
  }

  async discover(options = {}) {
    const processes = await this.snapshots();
    const registryEntries = await this.host.registryEntries();
    return discoverOfficialWorkBuddy({
      explicitPath: options.workbuddyExe,
      envPath: this.config.explicitExecutable,
      localAppData: this.config.localAppData,
      processes,
      registryEntries,
      inspectExecutable: (candidate) => this.host.executableEvidence(candidate),
      isFile: this.host.isFile || pathIsFile,
    });
  }

  async readState({ required = false } = {}) {
    try {
      const state = await readBoundedJsonFile(this.config.statePath, {
        maxBytes: MAX_WINDOWS_STATE_BYTES,
        allowedRoot: this.config.stateRoot,
        errorCode: "INVALID_STATE_FILE",
      });
      return validateWindowsRuntimeState(state, { stateRoot: this.config.stateRoot });
    } catch (error) {
      if (error.code === "ENOENT" && !required) return null;
      if (error instanceof WindowsRuntimeError) throw error;
      if (!required && error.code === "ENOENT") return null;
      fail("INVALID_STATE", `Could not read Windows runtime state: ${error.message}`);
    }
  }

  async persistState(state) {
    validateWindowsRuntimeState(state, { stateRoot: this.config.stateRoot });
    await writeJsonAtomic(this.config.statePath, state);
  }

  async currentProcess(identity) {
    return (await this.snapshots()).find((entry) => processMatchesIdentity(entry, identity)) || null;
  }

  async portOwnership(port, ownerIdentity) {
    const [listeners, processes] = await Promise.all([
      this.host.listeners(port),
      this.snapshots(),
    ]);
    return validateOwnedPort({ listeners, processes, port, ownerIdentity });
  }

  async cdpIdentity(port, browserId = null) {
    return resolveBrowserIdentity(port, browserId, this.host.fetchImpl);
  }

  async status(options = {}) {
    this.assertWindows();
    return this.withLock(async () => {
      let state;
      try {
        state = await this.readState();
      } catch (error) {
        return { session: "orphaned-unverified", stateValid: false, error: error.message };
      }
      if (!state) {
        let official = null;
        try {
          official = await this.discover(options);
        } catch (error) {
          if (!(error instanceof WindowsRuntimeError) || error.code !== "WORKBUDDY_NOT_FOUND"
            || options.workbuddyExe || this.config.explicitExecutable) throw error;
        }
        const processes = official ? await this.snapshots() : [];
        return {
          session: "off",
          stateValid: true,
          workbuddyRunning: Boolean(official && processes.some((entry) => isWorkBuddyMainProcess(entry, official.path))),
          workbuddyVersion: official?.productVersion ?? null,
        };
      }
      const appIdentity = identityFromState(state, "workbuddy");
      const watcherIdentity = identityFromState(state, "watcher");
      const processes = await this.snapshots();
      const appAlive = Boolean(appIdentity
        && processes.some((entry) => processMatchesIdentity(entry, appIdentity)));
      const watcher = watcherIdentity
        ? processes.find((entry) => processMatchesIdentity(entry, watcherIdentity))
        : null;
      const watcherAlive = Boolean(watcher && watcher.commandLine.includes(state.sessionToken)
        && watcher.commandLine.includes("__watch")
        && windowsCommandLineContainsPath(watcher.commandLine, state.runtimePath));
      let cdpOk = false;
      if (appAlive) {
        try {
          validateOwnedPort({ listeners: await this.host.listeners(state.port), processes, port: state.port, ownerIdentity: appIdentity });
          await this.cdpIdentity(state.port, state.browserId);
          cdpOk = true;
        } catch {}
      }
      const session = state.session === "active" && appAlive && watcherAlive && cdpOk
        ? "active"
        : "degraded";
      return {
        session,
        recoveryRequired: state.session === "recovery",
        stateValid: true,
        themeId: state.themeId,
        themeRevision: state.themeRevision ?? null,
        port: state.port,
        browserId: state.browserId,
        workbuddyVersion: state.workbuddyVersion,
        workbuddyAlive: appAlive,
        watcherAlive,
        cdpOk,
      };
    });
  }

  async stopIdentity(identity, { graceful = false, commandToken = "", timeoutMs = 15_000 } = {}) {
    if (!await this.currentProcess(identity)) return true;
    if (graceful) {
      await this.host.stopExactProcess(identity, { graceful: true, commandToken });
      const closed = await waitUntil(async () => !await this.currentProcess(identity), {
        timeoutMs,
        sleep: this.host.sleep,
      });
      if (closed) return true;
    }
    if (!await this.currentProcess(identity)) return true;
    await this.host.stopExactProcess(identity, { graceful: false, commandToken });
    const stopped = await waitUntil(async () => !await this.currentProcess(identity), {
      timeoutMs: 7_000,
      sleep: this.host.sleep,
    });
    if (!stopped) fail("PROCESS_DID_NOT_STOP", `Owned process ${identity.pid} did not stop`);
    return true;
  }

  async stopOfficialMainProcesses(executablePath, processes) {
    const mains = normalizeProcessSnapshots(processes).filter((entry) => isWorkBuddyMainProcess(entry, executablePath));
    for (const process of mains) {
      const identity = processIdentity(process);
      if (!identity) fail("PROCESS_IDENTITY", `Could not record WorkBuddy PID ${process.pid}`);
      await this.stopIdentity(identity, { graceful: true });
    }
    return mains.length > 0;
  }

  async choosePort(preferred, explicit) {
    const last = Math.min(65535, preferred + (explicit ? 0 : 100));
    for (let port = preferred; port <= last; port += 1) {
      const listeners = normalizeListeners(await this.host.listeners(port));
      if (listeners.length === 0) return port;
      if (explicit) fail("PORT_IN_USE", `Port ${port} is already in use`);
    }
    fail("PORT_IN_USE", "No available loopback debugging port was found");
  }

  async waitForOwnedCdp(port, executablePath, launchedPid) {
    return waitUntil(async () => {
      try {
        const processes = await this.snapshots();
        const listeners = normalizeListeners(await this.host.listeners(port));
        if (listeners.length === 0) return null;
        const byPid = processMap(processes);
        const candidates = [];
        for (const listener of validateLoopbackListeners(listeners, port)) {
          let current = byPid.get(listener.pid);
          const visited = new Set();
          while (current && !visited.has(current.pid)) {
            visited.add(current.pid);
            if (isWorkBuddyMainProcess(current, executablePath)) candidates.push(current);
            if (!current.parentPid || current.parentPid === current.pid) break;
            current = byPid.get(current.parentPid);
          }
        }
        const unique = [...new Map(candidates.map((entry) => [entry.pid, entry])).values()];
        const launched = unique.find((entry) => entry.pid === launchedPid);
        const owner = launched || (unique.length === 1 ? unique[0] : null);
        const identity = processIdentity(owner);
        if (!identity) return null;
        const ownership = validateOwnedPort({ listeners, processes, port, ownerIdentity: identity });
        const listenerIdentities = [...new Map(ownership.listeners.map((listener) => {
          const listenerIdentity = processIdentity(byPid.get(listener.pid));
          return [listener.pid, listenerIdentity];
        })).values()];
        if (listenerIdentities.some((listenerIdentity) => !listenerIdentity)) return null;
        const browser = await this.cdpIdentity(port);
        return { identity, browser, listenerIdentities };
      } catch {
        return null;
      }
    }, { timeoutMs: DEFAULT_TIMEOUT_MS, intervalMs: 350, sleep: this.host.sleep });
  }

  async waitForWatcher(pid, watcherExe, token) {
    return waitUntil(async () => {
      const process = (await this.snapshots()).find((entry) => entry.pid === pid
        && sameWindowsPath(entry.executablePath, watcherExe)
        && entry.commandLine.includes("__watch")
        && entry.commandLine.includes(token));
      return processIdentity(process);
    }, { timeoutMs: 10_000, sleep: this.host.sleep });
  }

  async launchNormalAndWait(executablePath) {
    validateWorkBuddyExecutableEvidence(
      await this.host.executableEvidence(executablePath),
      executablePath,
    );
    const before = await this.snapshots();
    const existing = before.filter((entry) => isWorkBuddyMainProcess(entry, executablePath)
      && !isDebugLaunchedWorkBuddyMain(entry, executablePath));
    if (existing.length > 1) fail("NORMAL_RESTART_FAILED", "Multiple normal WorkBuddy processes are already running");
    if (existing.length === 1) return processIdentity(existing[0]);
    const beforeKeys = new Set(before.map(processIdentityKey).filter(Boolean));
    const launched = this.host.launchWorkBuddy(executablePath, { debugPort: null });
    const identity = await waitUntil(async () => {
      const mains = (await this.snapshots()).filter((entry) => (
        isWorkBuddyMainProcess(entry, executablePath)
        && !isDebugLaunchedWorkBuddyMain(entry, executablePath)
      ));
      const direct = mains.find((entry) => entry.pid === launched.pid);
      if (direct) return processIdentity(direct);
      const added = mains.filter((entry) => !beforeKeys.has(processIdentityKey(entry)));
      return added.length === 1 ? processIdentity(added[0]) : null;
    }, { timeoutMs: 15_000, intervalMs: 100, sleep: this.host.sleep });
    if (!identity) fail("NORMAL_RESTART_FAILED", "WorkBuddy did not stay running after its normal restart");
    return identity;
  }

  async apply(options) {
    this.assertWindows();
    return this.withLock(async () => {
      await fs.mkdir(this.config.stateRoot, { recursive: true, mode: 0o700 });
      const existing = await this.readState();
      let official = await this.discover({
        ...options,
        workbuddyExe: options.workbuddyExe || existing?.workbuddyExe || null,
      });
      const themeId = options.themeId || DEFAULT_THEME_ID;
      const themeDir = path.resolve(this.config.themesRoot, themeId);
      if (!THEME_ID_PATTERN.test(themeId) || !await pathIsFile(path.join(themeDir, "theme.json"))) {
        fail("THEME_NOT_FOUND", `Theme not found: ${themeId}`);
      }
      for (const required of [this.config.cssPath, this.config.templatePath, this.config.registryPath]) {
        if (!await pathIsFile(required)) fail("RUNTIME_ASSET_MISSING", `Runtime asset is missing: ${required}`);
      }

      const originalProcesses = await this.snapshots();
      const wasRunning = Boolean(existing)
        || originalProcesses.some((entry) => isWorkBuddyMainProcess(entry, official.path));
      const requestedPort = existing && !options.portExplicit ? existing.port : options.port;
      const reusesExistingPort = Boolean(existing?.session === "active"
        && requestedPort === existing.port);
      const port = reusesExistingPort
        ? requestedPort
        : await this.choosePort(requestedPort, options.portExplicit);
      let appIdentity = null;
      let watcherIdentity = null;
      let listenerIdentities = [];
      const sessionToken = this.host.randomToken?.() || crypto.randomBytes(16).toString("hex");
      let browserId = null;
      let previousSessionRemoved = false;
      let debugLaunch = null;
      let watcherLaunch = null;
      let launchBaselineKeys = new Set();
      try {
        if (existing) {
          await this.restoreLocked(existing, { relaunch: false });
          previousSessionRemoved = true;
        } else {
          await this.stopOfficialMainProcesses(official.path, originalProcesses);
        }
        const launchEvidence = validateWorkBuddyExecutableEvidence(
          await this.host.executableEvidence(official.path),
          official.path,
        );
        if (launchEvidence.productVersion !== official.productVersion
          || (official.signerThumbprint
            && launchEvidence.signerThumbprint !== official.signerThumbprint)) {
          fail("WORKBUDDY_CHANGED", "WorkBuddy changed after validation; run apply again");
        }
        official = launchEvidence;
        launchBaselineKeys = new Set((await this.snapshots()).map(processIdentityKey).filter(Boolean));
        debugLaunch = this.host.launchWorkBuddy(official.path, { debugPort: port });
        const owned = await this.waitForOwnedCdp(port, official.path, debugLaunch.pid);
        if (!owned) fail("CDP_START_FAILED", "WorkBuddy did not expose an owned loopback CDP endpoint");
        appIdentity = owned.identity;
        listenerIdentities = owned.listenerIdentities.map((identity) => ({ ...identity }));
        browserId = owned.browser.browserId;
        const initial = await this.oneShot({
          mode: "apply",
          port,
          browserId,
          executablePath: official.path,
          themeDir,
          cssPath: this.config.cssPath,
          templatePath: this.config.templatePath,
          registryPath: this.config.registryPath,
          fetchImpl: this.host.fetchImpl,
          Session: this.host.Session,
        });
        if (!initial.pass) fail("INJECTION_FAILED", "The initial Windows WorkBuddy theme injection failed");

        const watcherArgs = [
          "__watch",
          "--state-path", this.config.statePath,
          "--session-token", sessionToken,
          "--port", String(port),
          "--browser-id", browserId,
          "--workbuddy-pid", String(appIdentity.pid),
          "--workbuddy-started-at", appIdentity.startedAt,
          "--workbuddy-exe", official.path,
          "--theme-dir", themeDir,
        ];
        watcherLaunch = this.host.launchWatcher(this.config.runtimePath, watcherArgs, {
          stdoutPath: this.config.watcherLogPath,
          stderrPath: this.config.watcherErrorLogPath,
        });
        watcherIdentity = await this.waitForWatcher(
          watcherLaunch.pid,
          watcherLaunch.executablePath,
          sessionToken,
        );
        if (!watcherIdentity) fail("WATCHER_START_FAILED", "The detached Windows skin watcher did not stay running");

        const state = {
          schemaVersion: WINDOWS_RUNTIME_SCHEMA_VERSION,
          platform: "win32",
          skinVersion: WORKBUDDY_SKIN_VERSION,
          session: "active",
          ownsSession: true,
          sessionToken,
          statePath: this.config.statePath,
          runtimePath: this.config.runtimePath,
          port,
          browserId,
          themeId,
          themeDir,
          themeRevision: options.revision ?? null,
          workbuddyPid: appIdentity.pid,
          workbuddyStartedAt: appIdentity.startedAt,
          workbuddyExe: official.path,
          workbuddyVersion: official.productVersion,
          signerCommonName: official.signerCommonName,
          signerThumbprint: official.signerThumbprint,
          watcherPid: watcherIdentity.pid,
          watcherStartedAt: watcherIdentity.startedAt,
          watcherExe: watcherIdentity.executablePath,
          listenerIdentities,
          wasRunningBeforeApply: wasRunning,
          createdAt: this.host.now(),
        };
        await this.persistState(state);
        await fs.writeFile(this.config.lastThemePath, `${themeId}\n`, { mode: 0o600 });
        return {
          session: "active",
          platform: "win32",
          themeId,
          themeRevision: state.themeRevision,
          port,
          browserId,
          workbuddyVersion: official.productVersion,
          pass: true,
        };
      } catch (error) {
        const rollbackFailures = [];
        const recordRollbackFailure = (stage, rollbackError) => {
          rollbackFailures.push({
            stage,
            code: rollbackError?.code || null,
            message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          });
        };
        let rollbackWatcherIdentity = watcherIdentity;
        const rollbackAppIdentities = appIdentity ? [appIdentity] : [];
        const rollbackListenerIdentities = listenerIdentities.map((identity) => ({ ...identity }));
        if (!rollbackWatcherIdentity && watcherLaunch) {
          try {
            const watcher = (await this.snapshots()).find((entry) => (
              entry.pid === watcherLaunch.pid
              && sameWindowsPath(entry.executablePath, watcherLaunch.executablePath)
              && entry.commandLine.includes("__watch")
              && entry.commandLine.includes(sessionToken)
            ));
            rollbackWatcherIdentity = processIdentity(watcher);
          } catch (rollbackError) {
            recordRollbackFailure("identify-watcher", rollbackError);
          }
        }
        if (rollbackWatcherIdentity) {
          try {
            await this.stopIdentity(rollbackWatcherIdentity, { commandToken: sessionToken });
          } catch (rollbackError) {
            recordRollbackFailure("stop-watcher", rollbackError);
          }
        }
        if (!appIdentity && debugLaunch) {
          try {
            const candidates = (await this.snapshots()).filter((entry) => (
              (entry.pid === debugLaunch.pid || isDebugLaunchedWorkBuddyMain(entry, official.path))
              && isWorkBuddyMainProcess(entry, official.path)
              && !launchBaselineKeys.has(processIdentityKey(entry))
            ));
            for (const candidate of candidates) {
              const identity = processIdentity(candidate);
              if (identity) rollbackAppIdentities.push(identity);
            }
          } catch (rollbackError) {
            recordRollbackFailure("identify-debug-launch", rollbackError);
          }
        }
        for (const identity of rollbackAppIdentities) {
          try {
            await this.stopIdentity(identity, { graceful: true });
          } catch (rollbackError) {
            recordRollbackFailure("stop-themed-workbuddy", rollbackError);
          }
        }
        for (const identity of rollbackListenerIdentities) {
          if (rollbackAppIdentities.some((app) => processMatchesIdentity(identity, app))) continue;
          try {
            await this.stopIdentity(identity);
          } catch (rollbackError) {
            recordRollbackFailure("stop-owned-listener", rollbackError);
          }
        }

        let residualAppIdentity = null;
        let residualWatcherIdentity = null;
        let residualListenerIdentities = rollbackListenerIdentities;
        if (!existing || previousSessionRemoved) {
          try {
            const afterRollback = await this.snapshots();
            residualAppIdentity = rollbackAppIdentities.find((identity) => (
              afterRollback.some((entry) => processMatchesIdentity(entry, identity))
            )) || null;
            residualWatcherIdentity = rollbackWatcherIdentity
              && afterRollback.some((entry) => processMatchesIdentity(entry, rollbackWatcherIdentity))
              ? rollbackWatcherIdentity
              : null;
            residualListenerIdentities = rollbackListenerIdentities.filter((identity) => (
              afterRollback.some((entry) => processMatchesIdentity(entry, identity))
            ));
          } catch (rollbackError) {
            recordRollbackFailure("inspect-residual-processes", rollbackError);
          }
        }

        let recoveryStatePreserved = false;
        if (residualAppIdentity || residualWatcherIdentity || residualListenerIdentities.length > 0) {
          if (!rollbackFailures.some((entry) => entry.stage.startsWith("stop-"))) {
            recordRollbackFailure(
              "residual-processes",
              new Error("A themed WorkBuddy process or owned CDP listener remained after rollback"),
            );
          }
          try {
            const recoveryState = {
              schemaVersion: WINDOWS_RUNTIME_SCHEMA_VERSION,
              platform: "win32",
              skinVersion: WORKBUDDY_SKIN_VERSION,
              session: "recovery",
              ownsSession: true,
              sessionToken,
              statePath: this.config.statePath,
              runtimePath: this.config.runtimePath,
              port,
              browserId,
              themeId,
              themeDir,
              themeRevision: options.revision ?? null,
              workbuddyPid: residualAppIdentity?.pid ?? null,
              workbuddyStartedAt: residualAppIdentity?.startedAt ?? null,
              workbuddyExe: official.path,
              workbuddyVersion: official.productVersion,
              signerCommonName: official.signerCommonName,
              signerThumbprint: official.signerThumbprint,
              watcherPid: residualWatcherIdentity?.pid ?? null,
              watcherStartedAt: residualWatcherIdentity?.startedAt ?? null,
              watcherExe: residualWatcherIdentity?.executablePath ?? null,
              listenerIdentities: residualListenerIdentities,
              wasRunningBeforeApply: wasRunning,
              createdAt: this.host.now(),
              recoveryReason: error instanceof Error ? error.message : String(error),
              rollbackFailures,
            };
            await this.persistState(recoveryState);
            recoveryStatePreserved = true;
          } catch (rollbackError) {
            recordRollbackFailure("persist-recovery-state", rollbackError);
          }
        } else if (!existing || previousSessionRemoved) {
          try {
            await fs.rm(this.config.statePath, { force: true });
          } catch (rollbackError) {
            recordRollbackFailure("remove-state", rollbackError);
          }
          if (wasRunning) {
            try {
              const stillRunning = (await this.snapshots())
                .some((entry) => isWorkBuddyMainProcess(entry, official.path));
              if (!stillRunning) await this.launchNormalAndWait(official.path);
            } catch (rollbackError) {
              recordRollbackFailure("restart-native-workbuddy", rollbackError);
            }
          }
        }
        const failure = rollbackFailure(error, rollbackFailures);
        if (failure instanceof WindowsRuntimeError && failure.code === "APPLY_ROLLBACK_FAILED") {
          failure.details = {
            ...failure.details,
            recoveryStatePreserved,
            recoveryStatePath: recoveryStatePreserved ? this.config.statePath : null,
          };
        }
        throw failure;
      }
    });
  }

  async assertLiveState(state) {
    if (state.session !== "active") {
      fail("DEGRADED_SESSION", "The Windows skin session requires recovery before it can be verified");
    }
    const appIdentity = identityFromState(state, "workbuddy");
    const watcherIdentity = identityFromState(state, "watcher");
    const processes = await this.snapshots();
    const app = processes.find((entry) => processMatchesIdentity(entry, appIdentity));
    if (!app) fail("DEGRADED_SESSION", "The recorded WorkBuddy process is not alive");
    const watcher = processes.find((entry) => processMatchesIdentity(entry, watcherIdentity));
    if (!watcher || !watcher.commandLine.includes(state.sessionToken)
      || !watcher.commandLine.includes("__watch")
      || !windowsCommandLineContainsPath(watcher.commandLine, state.runtimePath)) {
      fail("DEGRADED_SESSION", "The recorded Windows skin watcher is not alive or no longer owned");
    }
    validateOwnedPort({
      listeners: await this.host.listeners(state.port),
      processes,
      port: state.port,
      ownerIdentity: appIdentity,
    });
    await this.cdpIdentity(state.port, state.browserId);
    return { appIdentity, watcherIdentity };
  }

  async verify(options) {
    this.assertWindows();
    return this.withLock(async () => {
      const state = await this.readState({ required: true });
      await this.assertLiveState(state);
      const result = await this.oneShot({
        mode: "verify",
        port: state.port,
        browserId: state.browserId,
        executablePath: state.workbuddyExe,
        themeDir: state.themeDir,
        cssPath: this.config.cssPath,
        templatePath: this.config.templatePath,
        registryPath: this.config.registryPath,
        screenshot: options.screenshot,
        fetchImpl: this.host.fetchImpl,
        Session: this.host.Session,
      });
      if (!result.pass) fail("VERIFY_FAILED", "Windows WorkBuddy skin DOM verification failed", result);
      return {
        ...result,
        persistence: {
          watcherAlive: true,
          workbuddyAlive: true,
          cdpOwned: true,
        },
      };
    });
  }

  async restoreLocked(state, { relaunch = true } = {}) {
    const currentEvidence = validateWorkBuddyExecutableEvidence(
      await this.host.executableEvidence(state.workbuddyExe),
      state.workbuddyExe,
    );
    const hostChangedSinceApply = currentEvidence.productVersion !== state.workbuddyVersion
      || Boolean(state.signerThumbprint
        && currentEvidence.signerThumbprint !== state.signerThumbprint);
    const appIdentity = identityFromState(state, "workbuddy");
    const watcherIdentity = identityFromState(state, "watcher");
    const processes = await this.snapshots();
    const appAlive = Boolean(appIdentity
      && processes.some((entry) => processMatchesIdentity(entry, appIdentity)));
    const watcher = watcherIdentity
      ? processes.find((entry) => processMatchesIdentity(entry, watcherIdentity))
      : null;
    const watcherOwned = Boolean(watcher && watcher.commandLine.includes("__watch")
      && watcher.commandLine.includes(state.sessionToken)
      && windowsCommandLineContainsPath(watcher.commandLine, state.runtimePath));
    if (watcher && !watcherOwned) {
      fail("WATCHER_OWNERSHIP", "The recorded watcher PID no longer belongs to this skin session");
    }

    let domRemoved = false;
    let domRemovalSkippedReason = null;
    let ownedListenerIdentities = Array.isArray(state.listenerIdentities)
      ? state.listenerIdentities.map((identity) => ({ ...identity }))
      : [];
    if (appAlive) {
      let ownershipConfirmed = false;
      try {
        const liveListeners = await this.host.listeners(state.port);
        const ownership = validateOwnedPort({
          listeners: liveListeners,
          processes,
          port: state.port,
          ownerIdentity: appIdentity,
        });
        const byPid = processMap(processes);
        ownedListenerIdentities = ownership.listeners.map((listener) => processIdentity(byPid.get(listener.pid)));
        if (ownedListenerIdentities.some((identity) => !identity)) {
          fail("PORT_OWNERSHIP", "An owned listener process identity could not be recorded");
        }
        ownershipConfirmed = true;
      } catch (error) {
        domRemovalSkippedReason = error instanceof Error ? error.message : String(error);
      }
      if (ownershipConfirmed && ownedListenerIdentities.length > 0) {
        await this.persistState({ ...state, listenerIdentities: ownedListenerIdentities });
      }
      if (ownershipConfirmed) {
        try {
          const browser = await this.cdpIdentity(state.port);
          const removed = await this.oneShot({
            mode: "remove",
            port: state.port,
            browserId: browser.browserId,
            executablePath: state.workbuddyExe,
            themeDir: state.themeDir,
            fetchImpl: this.host.fetchImpl,
            Session: this.host.Session,
          });
          if (!removed.pass) throw new Error("The WorkBuddy skin DOM could not be removed");
          domRemoved = true;
        } catch (error) {
          domRemovalSkippedReason = error instanceof Error ? error.message : String(error);
        }
      }
    }

    if (watcherOwned) await this.stopIdentity(watcherIdentity, { commandToken: state.sessionToken });
    if (appAlive) await this.stopIdentity(appIdentity, { graceful: true });
    for (const identity of ownedListenerIdentities) {
      if (appIdentity && processMatchesIdentity(identity, appIdentity)) continue;
      await this.stopIdentity(identity);
    }
    if (ownedListenerIdentities.length > 0) {
      const listenersStopped = await waitUntil(async () => {
        const liveProcesses = await this.snapshots();
        return ownedListenerIdentities.every((identity) => (
          !liveProcesses.some((entry) => processMatchesIdentity(entry, identity))
        ));
      }, { timeoutMs: 7_000, intervalMs: 150, sleep: this.host.sleep });
      if (!listenersStopped) {
        fail("OWNED_LISTENER_DID_NOT_STOP", "An owned WorkBuddy CDP listener did not stop; state was preserved");
      }
    }
    await fs.rm(this.config.statePath, { force: true });
    let relaunchedIdentity = null;
    if (relaunch) {
      relaunchedIdentity = await this.launchNormalAndWait(state.workbuddyExe);
    }
    return {
      session: "off",
      restored: true,
      domRemoved,
      domRemovalSkippedReason,
      hostChangedSinceApply,
      relaunched: relaunch,
      workbuddyPid: relaunchedIdentity?.pid ?? null,
    };
  }

  async restore() {
    this.assertWindows();
    return this.withLock(async () => {
      const state = await this.readState();
      if (!state) return { session: "off", restored: false, reason: "no-active-state" };
      return this.restoreLocked(state, { relaunch: true });
    });
  }
}

export async function runWindowsWatcher(options, {
  host = createDefaultWindowsHost(),
  config = null,
} = {}) {
  if (host.platform !== "win32") fail("UNSUPPORTED_PLATFORM", "The Windows watcher requires Windows");
  config ||= resolveWindowsRuntimeConfig(process.env);
  const ownerIdentity = {
    pid: options.workbuddyPid,
    executablePath: null,
    startedAt: options.workbuddyStartedAt,
  };
  const evidence = await discoverOfficialWorkBuddy({
    explicitPath: options.workbuddyExe || process.env.WORKBUDDY_EXE || null,
    envPath: null,
    localAppData: config.localAppData,
    processes: await host.processSnapshots(),
    registryEntries: await host.registryEntries(),
    inspectExecutable: (candidate) => host.executableEvidence(candidate),
  });
  ownerIdentity.executablePath = evidence.path;
  const payload = await loadWorkBuddyPayload({
    themeDir: options.themeDir,
    cssPath: config.cssPath,
    templatePath: config.templatePath,
    registryPath: config.registryPath,
  });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const sessions = new Map();
  const failures = new WatcherFailureBudget();
  try {
    const recordedState = await waitUntil(async () => {
      try {
        const state = validateWindowsRuntimeState(await readBoundedJsonFile(options.statePath, {
          maxBytes: MAX_WINDOWS_STATE_BYTES,
          allowedRoot: path.dirname(options.statePath),
          errorCode: "INVALID_STATE_FILE",
        }), {
          stateRoot: path.win32.dirname(options.statePath),
        });
        if (state.session !== "active"
          || state.sessionToken !== options.sessionToken
          || state.port !== options.port
          || state.browserId !== options.browserId
          || state.workbuddyPid !== options.workbuddyPid
          || state.workbuddyStartedAt !== options.workbuddyStartedAt
          || !sameWindowsPath(state.workbuddyExe, evidence.path)
          || !sameWindowsPath(state.themeDir, options.themeDir)) return null;
        return state;
      } catch {
        return null;
      }
    }, { timeoutMs: 15_000, intervalMs: 100, sleep: host.sleep });
    if (!recordedState) fail("INVALID_STATE", "The Windows watcher could not validate its recorded session");
    while (!stopping) {
      let liveState;
      try {
        liveState = validateWindowsRuntimeState(await readBoundedJsonFile(options.statePath, {
          maxBytes: MAX_WINDOWS_STATE_BYTES,
          allowedRoot: path.dirname(options.statePath),
          errorCode: "INVALID_STATE_FILE",
        }), {
          stateRoot: path.win32.dirname(options.statePath),
        });
      } catch {
        break;
      }
      if (liveState.session !== "active"
        || liveState.sessionToken !== options.sessionToken
        || liveState.workbuddyPid !== ownerIdentity.pid
        || liveState.workbuddyStartedAt !== ownerIdentity.startedAt
        || liveState.port !== options.port
        || liveState.browserId !== options.browserId) break;
      const processes = normalizeProcessSnapshots(await host.processSnapshots());
      if (!processes.some((entry) => processMatchesIdentity(entry, ownerIdentity))) break;
      let loopDelayMs = 900;
      try {
        validateOwnedPort({
          listeners: await host.listeners(options.port),
          processes,
          port: options.port,
          ownerIdentity,
        });
        await resolveBrowserIdentity(options.port, options.browserId, host.fetchImpl);
        const targets = await listPageTargets(options.port, null, host.fetchImpl);
        failures.reset("host");
        const activeIds = new Set(targets.map((target) => target.id));
        for (const [id, entry] of sessions) {
          if (!activeIds.has(id) || entry.closed) {
            entry.close();
            sessions.delete(id);
          }
        }
        for (const target of targets) {
          if (sessions.has(target.id) || !isPlausibleWindowsWorkBuddyRendererTarget(target, evidence.path)) continue;
          const failureKey = `target:${target.id}`;
          if (!failures.ready(failureKey)) continue;
          let session;
          try {
            session = await new host.Session(target, options.port).open();
            const probe = await probeWindowsWorkBuddySession(session, target, evidence.path);
            if (!probe.matched) throw new Error("renderer fingerprint did not match");
            await applyWorkBuddySession(session, payload.payload);
            sessions.set(target.id, session);
            failures.reset(failureKey);
            session.on("Page.loadEventFired", () => {
              setTimeout(async () => {
                try {
                  const current = await probeWindowsWorkBuddySession(session, target, evidence.path);
                  if (!current.matched) throw new Error("renderer fingerprint changed");
                  await applyWorkBuddySession(session, payload.payload);
                } catch (error) {
                  session.close();
                  sessions.delete(target.id);
                  const failure = failures.record(failureKey, error.message);
                  if (failure.shouldLog) {
                    console.error(`[workbuddy-skin] Windows watcher target ${target.id}: ${error.message} (attempt ${failure.count})`);
                  }
                  if (failure.fatal) stopping = true;
                }
              }, 350);
            });
          } catch (error) {
            session?.close();
            const failure = failures.record(failureKey, error.message);
            if (failure.shouldLog) {
              console.error(`[workbuddy-skin] Windows watcher target ${target.id}: ${error.message} (attempt ${failure.count})`);
            }
            if (failure.fatal) {
              stopping = true;
              break;
            }
          }
        }
      } catch (error) {
        const failure = failures.record("host", error.message);
        loopDelayMs = failure.delayMs;
        if (failure.shouldLog) {
          console.error(`[workbuddy-skin] Windows watcher: ${error.message} (attempt ${failure.count})`);
        }
        if (failure.fatal) stopping = true;
      }
      if (!stopping) await host.sleep(loopDelayMs);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    for (const session of sessions.values()) session.close();
  }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseWindowsRuntimeArgs(argv);
  if (options.command === "__watch") return runWindowsWatcher(options, dependencies);
  const runtime = dependencies.runtime || new WindowsWorkBuddyRuntime(dependencies);
  let result;
  if (options.command === "status") result = await runtime.status(options);
  else if (options.command === "apply") result = await runtime.apply(options);
  else if (options.command === "verify") result = await runtime.verify(options);
  else result = await runtime.restore(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  main().catch((error) => {
    const code = error instanceof WindowsRuntimeError ? error.code : "UNEXPECTED_ERROR";
    console.error(`WorkBuddy Dream Skin [${code}]: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
