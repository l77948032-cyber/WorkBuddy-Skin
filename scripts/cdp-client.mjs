import fs from "node:fs/promises";
import path from "node:path";

import { matchesImageSignature } from "../src/core/theme-model.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const CDP_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
const MAX_CDP_JSON_BYTES = 2 * 1024 * 1024;

export class CdpIdentityMismatchError extends Error {}

export function validatedDebuggerUrl(target, port, expectedKind = null) {
  let url;
  try {
    url = new URL(target?.webSocketDebuggerUrl);
  } catch {
    throw new Error("Rejected an invalid CDP WebSocket URL");
  }
  const match = url.pathname.match(/^\/devtools\/(page|browser)\/([A-Za-z0-9._-]{1,200})$/);
  const kindMatches = expectedKind === null || match?.[1] === expectedKind;
  if (
    url.protocol !== "ws:"
    || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
    || Number(url.port) !== port
    || url.username
    || url.password
    || url.search
    || url.hash
    || !match
    || !kindMatches
  ) {
    throw new Error("Rejected a CDP WebSocket URL outside the allowed loopback endpoint shape");
  }
  return url.href;
}

export function browserIdFromVersion(version, port) {
  const url = new URL(validatedDebuggerUrl(version, port, "browser"));
  const browserId = url.pathname.slice("/devtools/browser/".length);
  if (!CDP_ID_PATTERN.test(browserId)) throw new Error("Rejected an invalid CDP browser ID");
  return browserId;
}

export function isValidPageTarget(target, port) {
  if (
    target?.type !== "page"
    || typeof target.id !== "string"
    || !CDP_ID_PATTERN.test(target.id)
    || typeof target.url !== "string"
    || !target.webSocketDebuggerUrl
  ) return false;

  try {
    const url = new URL(validatedDebuggerUrl(target, port, "page"));
    return url.pathname === `/devtools/page/${target.id}`;
  } catch {
    return false;
  }
}

function requireWebSocket() {
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error(
      "This Node.js runtime does not expose WebSocket. Use Node 22+ or Node 20 with --experimental-websocket.",
    );
  }
  return globalThis.WebSocket;
}

export class CdpSession {
  constructor(target, port, WebSocketCtor = requireWebSocket()) {
    this.target = target;
    this.ws = new WebSocketCtor(validatedDebuggerUrl(target, port, "page"));
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try { this.ws.close(); } catch {}
        reject(new Error("CDP WebSocket open timed out"));
      }, 5000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("CDP WebSocket open failed"));
      }, { once: true });
    });

    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("error", () => this.close());
    this.ws.addEventListener("close", () => {
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      this.close();
      return;
    }
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timeout);
      this.pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      } else {
        waiter.resolve(message.result);
      }
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) {
      try { listener(message.params ?? {}); } catch {}
    }
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  close() {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("CDP session closed"));
    }
    this.pending.clear();
    if (!this.closed) {
      try { this.ws.close(); } catch {}
    }
    this.closed = true;
  }
}

export async function fetchCdpJson(port, resource, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("This Node.js runtime does not expose fetch");
  if (resource !== "/json/list" && resource !== "/json/version") {
    throw new Error(`Rejected unsupported CDP JSON resource: ${resource}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}${resource}`, {
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`CDP endpoint returned HTTP ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_CDP_JSON_BYTES) {
      throw new Error("CDP JSON response is too large");
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveBrowserIdentity(
  port,
  expectedBrowserId = null,
  fetchImpl = globalThis.fetch,
) {
  const version = await fetchCdpJson(port, "/json/version", fetchImpl);
  const browserId = browserIdFromVersion(version, port);
  if (expectedBrowserId && browserId !== expectedBrowserId) {
    throw new CdpIdentityMismatchError(
      `CDP browser identity changed from ${expectedBrowserId} to ${browserId}`,
    );
  }
  return {
    browserId,
    product: typeof version.Browser === "string" ? version.Browser.slice(0, 200) : null,
    webSocketDebuggerUrl: validatedDebuggerUrl(version, port, "browser"),
  };
}

export async function listPageTargets(port, targetId = null, fetchImpl = globalThis.fetch) {
  const targets = await fetchCdpJson(port, "/json/list", fetchImpl);
  if (!Array.isArray(targets)) throw new Error("CDP target list is not an array");
  return targets
    .filter((target) => isValidPageTarget(target, port))
    .filter((target) => !targetId || target.id === targetId);
}

export async function captureScreenshot(session, outputPath) {
  const result = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  if (typeof result?.data !== "string" || !result.data) {
    throw new Error("CDP did not return screenshot data");
  }
  const data = Buffer.from(result.data, "base64");
  if (data.length < 8 || !matchesImageSignature(data, ".png")) {
    throw new Error("CDP returned an invalid PNG screenshot");
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, data);
  return { path: outputPath, bytes: data.length };
}
