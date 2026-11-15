// KnobDeck Browser Companion: one background script for Chrome-family (MV3 service worker) and
// Firefox-family (MV2 persistent page) browsers.
//
// It dials the KnobDeck `browser-plugin` on 127.0.0.1 (WebSocket), says which browser this is,
// then runs the actions the plugin sends through the browser's own extension APIs.
// The wire format is ../../PROTOCOL.md ("Browser extension").

"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const IS_FIREFOX = typeof globalThis.browser !== "undefined" && typeof globalThis.browser.runtime.getBrowserInfo === "function";
const DEFAULT_PORT = 32147;
const PROTOCOL = 1;
const PING_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;

class Unsupported extends Error {}

// ── Connection ───────────────────────────────────────────────────────────────

let socket = null;
let pingTimer = null;
let retryTimer = null;
let backoff = 1000;

async function instanceId() {
  const stored = await api.storage.local.get("instanceId");
  if (stored.instanceId) return stored.instanceId;
  const id = crypto.randomUUID();
  await api.storage.local.set({ instanceId: id });
  return id;
}

/** Which browser this is: `browser` is the key KnobDeck uses, `name` what the user sees. */
async function identify() {
  if (IS_FIREFOX) {
    let name = "";
    try {
      name = (await api.runtime.getBrowserInfo()).name ?? "";
    } catch {}
    if (/zen/i.test(name) || /zen/i.test(navigator.userAgent)) return { browser: "zen", name: "Zen", family: "firefox" };
    return { browser: "firefox", name: "Firefox", family: "firefox" };
  }
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return { browser: "msedge", name: "Microsoft Edge", family: "chromium" };
  try {
    if (navigator.brave && (await navigator.brave.isBrave())) return { browser: "brave", name: "Brave", family: "chromium" };
  } catch {}
  if (/OPR\//.test(ua)) return { browser: "opera", name: "Opera", family: "chromium" };
  return { browser: "chrome", name: "Chrome", family: "chromium" };
}

async function port() {
  const stored = await api.storage.local.get("port");
  const n = Number(stored.port);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

let stopped = false; // set only by the tests

function scheduleRetry() {
  if (stopped) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
}

async function connect() {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${await port()}`);
  } catch {
    scheduleRetry();
    return;
  }
  socket = ws;
  ws.onopen = async () => {
    const who = await identify();
    send({ type: "hello", protocol: PROTOCOL, id: await instanceId(), version: api.runtime.getManifest().version, ...who });
  };
  ws.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "ready") {
      backoff = 1000;
      clearInterval(pingTimer);
      // Traffic both keeps Chrome's service worker alive and lets the plugin drop a dead link.
      pingTimer = setInterval(() => send({ type: "ping" }), PING_MS);
    } else if (message.action) {
      handle(message);
    }
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    clearInterval(pingTimer);
    scheduleRetry();
  };
  ws.onerror = () => {}; // `close` follows
}

async function handle({ id, action, params }) {
  try {
    if (!Object.hasOwn(actions, action)) throw new Unsupported();
    const run = actions[action];
    send({ id, ok: true, result: (await run(params ?? {})) ?? {} });
  } catch (e) {
    if (e instanceof Unsupported) send({ id, ok: false, unsupported: true, error: "The browser has no extension API for this action" });
    else send({ id, ok: false, error: e?.message ?? String(e) });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The active tab of the browser window the user last used (focus is irrelevant: KnobDeck has it). */
async function activeTab() {
  let [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true, windowType: "normal" });
  if (!tab) [tab] = await api.tabs.query({ active: true, windowType: "normal" });
  if (!tab) throw new Error("No browser window is open");
  return tab;
}

/** Bring a window forward, so a tab or window KnobDeck just opened is the one you see. */
async function raise(windowId) {
  try {
    await api.windows.update(windowId, { focused: true });
  } catch {}
}

function internalPage(browser, page) {
  const scheme = { msedge: "edge", brave: "brave", opera: "opera" }[browser] ?? "chrome";
  return `${scheme}://${page}`;
}

/** Run `fn(...args)` in the page itself (not an isolated copy of it). */
async function inPage(tab, fn, args = []) {
  if (api.scripting?.executeScript) {
    await api.scripting.executeScript({ target: { tabId: tab.id }, func: fn, args, world: "MAIN" });
  } else {
    await api.tabs.executeScript(tab.id, { code: `(${fn})(...${JSON.stringify(args)})` });
  }
}

function pageUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("URL is required");
  let url;
  try {
    url = new URL(text);
  } catch {
    url = new URL(`https://${text}`);
  }
  if (/^(javascript|data|blob|vbscript):$/i.test(url.protocol)) throw new Error("That kind of link can't be opened");
  return url.href;
}

const MIN_ZOOM = IS_FIREFOX ? 0.3 : 0.25;
const MAX_ZOOM = 5;

async function setZoom(tab, percent) {
  const factor = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, percent / 100));
  await api.tabs.setZoom(tab.id, factor);
  return { percent: Math.round(factor * 100) };
}

// KnobDeck key names (the Custom Keybind input) → KeyboardEvent key / code.
const NAMED_KEYS = {
  tab: ["Tab", "Tab"], enter: ["Enter", "Enter"], esc: ["Escape", "Escape"], space: [" ", "Space"], backspace: ["Backspace", "Backspace"],
  left: ["ArrowLeft", "ArrowLeft"], right: ["ArrowRight", "ArrowRight"], up: ["ArrowUp", "ArrowUp"], down: ["ArrowDown", "ArrowDown"],
  home: ["Home", "Home"], end: ["End", "End"], pgup: ["PageUp", "PageUp"], pgdn: ["PageDown", "PageDown"],
  del: ["Delete", "Delete"], delete: ["Delete", "Delete"], ins: ["Insert", "Insert"], insert: ["Insert", "Insert"],
  period: [".", "Period"], comma: [",", "Comma"], semicolon: [";", "Semicolon"], slash: ["/", "Slash"], backslash: ["\\", "Backslash"],
  minus: ["-", "Minus"], equals: ["=", "Equal"], quote: ["'", "Quote"], apostrophe: ["'", "Quote"],
  backtick: ["`", "Backquote"], grave: ["`", "Backquote"], lbracket: ["[", "BracketLeft"], rbracket: ["]", "BracketRight"],
};

/** "ctrl shift k" → { key, code, ctrlKey, … } for a KeyboardEvent. `mod` is ⌘ on macOS, Ctrl elsewhere. */
function parseKeys(text, mac) {
  const event = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  let main = null;
  for (const raw of String(text).toLowerCase().split(/\s+/).filter(Boolean)) {
    if (raw === "ctrl" || raw === "control") event.ctrlKey = true;
    else if (raw === "alt" || raw === "option") event.altKey = true;
    else if (raw === "shift") event.shiftKey = true;
    else if (raw === "cmd" || raw === "win" || raw === "meta" || raw === "super") event.metaKey = true;
    else if (raw === "mod") event[mac ? "metaKey" : "ctrlKey"] = true;
    else if (NAMED_KEYS[raw]) main = { key: NAMED_KEYS[raw][0], code: NAMED_KEYS[raw][1] };
    else if (/^f([1-9]|1\d|2[0-4])$/.test(raw)) main = { key: raw.toUpperCase(), code: raw.toUpperCase() };
    else if (/^[a-z]$/.test(raw)) main = { key: event.shiftKey ? raw.toUpperCase() : raw, code: `Key${raw.toUpperCase()}` };
    else if (/^[0-9]$/.test(raw)) main = { key: raw, code: `Digit${raw}` };
    else throw new Error(`Unknown key "${raw}"`);
  }
  if (!main) throw new Error("Keys are required");
  return { ...event, ...main };
}

// ── Actions ──────────────────────────────────────────────────────────────────
// One per KnobDeck action id. Throwing `Unsupported` makes the plugin use its fallback.

const actions = {
  async "new-tab"() {
    const tab = await api.tabs.create({});
    await raise(tab.windowId);
  },
  async "new-window"() {
    const win = await api.windows.create({});
    await raise(win.id);
  },
  async "new-private-window"() {
    try {
      const win = await api.windows.create({ incognito: true });
      await raise(win.id);
    } catch (e) {
      throw new Error(`${e?.message ?? "Can't open a private window"}. Allow the KnobDeck extension in private windows in the browser's extension settings.`);
    }
  },
  async "close-tab"() {
    await api.tabs.remove((await activeTab()).id);
  },
  async "reopen-closed-tab"() {
    try {
      await api.sessions.restore();
    } catch {
      throw new Error("There is no recently closed tab");
    }
  },
  async "next-tab"() {
    await stepTab(1);
  },
  async "previous-tab"() {
    await stepTab(-1);
  },
  async "reload-tab"() {
    await api.tabs.reload((await activeTab()).id);
  },
  async "hard-reload-tab"() {
    await api.tabs.reload((await activeTab()).id, { bypassCache: true });
  },
  async "go-back"() {
    await api.tabs.goBack((await activeTab()).id);
  },
  async "go-forward"() {
    await api.tabs.goForward((await activeTab()).id);
  },
  async "stop-loading"() {
    await inPage(await activeTab(), () => window.stop());
  },
  async "print-page"() {
    // Deferred: print() blocks until the dialog closes, and the plugin is waiting for our answer.
    await inPage(await activeTab(), () => setTimeout(() => window.print(), 0));
  },
  async "toggle-fullscreen"() {
    const tab = await activeTab();
    const win = await api.windows.get(tab.windowId);
    await api.windows.update(tab.windowId, { state: win.state === "fullscreen" ? "normal" : "fullscreen" });
  },
  async "bookmark-page"() {
    const tab = await activeTab();
    if (!tab.url) throw new Error("This page can't be bookmarked");
    if ((await api.bookmarks.search({ url: tab.url })).length === 0) await api.bookmarks.create({ title: tab.title || tab.url, url: tab.url });
  },
  async "open-downloads"() {
    await openInternal("downloads");
  },
  async "open-history"() {
    await openInternal("history");
  },
  async "open-bookmarks-manager"() {
    await openInternal("bookmarks");
  },
  async "open-url"({ url }) {
    const tab = await api.tabs.create({ url: pageUrl(url) });
    await raise(tab.windowId);
  },
  async "custom-keybind"({ keys }) {
    const platform = await api.runtime.getPlatformInfo();
    const event = parseKeys(keys, platform.os === "mac");
    await inPage(await activeTab(), (e) => {
      const target = document.activeElement || document.body;
      for (const type of ["keydown", "keypress", "keyup"]) target.dispatchEvent(new KeyboardEvent(type, { ...e, bubbles: true, cancelable: true, composed: true }));
    }, [event]);
  },
  async "zoom-set"({ percent }) {
    return setZoom(await activeTab(), Number(percent));
  },
  async "zoom-by"({ percent }) {
    const tab = await activeTab();
    return setZoom(tab, Math.round((await api.tabs.getZoom(tab.id)) * 100) + Number(percent));
  },
  async bookmarks() {
    const recent = await api.bookmarks.getRecent(16);
    return { items: recent.filter((b) => b.url).map((b) => ({ title: b.title, url: b.url })) };
  },
  async history() {
    const visits = await api.history.search({ text: "", maxResults: 16, startTime: 0 });
    return { items: visits.map((v) => ({ title: v.title, url: v.url })) };
  },
};

async function stepTab(direction) {
  const tab = await activeTab();
  const tabs = (await api.tabs.query({ windowId: tab.windowId })).sort((a, b) => a.index - b.index);
  const at = tabs.findIndex((t) => t.id === tab.id);
  await api.tabs.update(tabs[(at + direction + tabs.length) % tabs.length].id, { active: true });
}

/** downloads / history / bookmarks pages. Firefox lets no extension open its about: pages. */
async function openInternal(page) {
  if (IS_FIREFOX) throw new Unsupported();
  const { browser } = await identify();
  const tab = await api.tabs.create({ url: internalPage(browser, page === "bookmarks" && browser === "msedge" ? "favorites" : page) });
  await raise(tab.windowId);
}

// ── Start ────────────────────────────────────────────────────────────────────
// Listeners are registered synchronously: Chrome restarts the service worker for them.

if (api.alarms) {
  api.alarms.create("knobdeck-connect", { periodInMinutes: 0.5 });
  api.alarms.onAlarm.addListener(() => connect());
}
api.runtime.onStartup?.addListener(() => connect());
api.runtime.onInstalled?.addListener(() => connect());
connect();

// Test hooks (the extension itself never reads this).
globalThis.__knobdeck = {
  parseKeys,
  pageUrl,
  stop() {
    stopped = true;
    clearTimeout(retryTimer);
  },
};
