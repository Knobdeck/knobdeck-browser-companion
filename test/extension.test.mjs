// Runs the real KnobDeck `browser-plugin` and the real background.js against each other.
// The extension gets a recording stand-in for the browser's `chrome` API; the plugin is driven over
// its stdio protocol like the KnobDeck host does. Set KNOBDECK_BROWSER_PLUGIN to a built
// `browser-plugin` (cargo build -p browser-plugin in knobdeck-plugins); without it these tests skip.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { after, before, describe, it } from "node:test";
import vm from "node:vm";
import { PluginDriver } from "../../compat/driver.mjs";

const exe = process.env.KNOBDECK_BROWSER_PLUGIN;
const source = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");

function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** A browser stand-in: every extension API call is recorded in `calls`. */
function fakeBrowser(port, userAgent = "Mozilla/5.0 Chrome/130.0 Safari/537.36") {
  const calls = [];
  const store = { port };
  const tab = { id: 7, windowId: 1, index: 1, active: true, url: "https://example.com/", title: "Example" };
  const record = (name, result) => async (...args) => {
    calls.push(JSON.parse(JSON.stringify([name, ...args]))); // plain objects: the extension runs in its own vm realm
    return typeof result === "function" ? result(...args) : result;
  };
  let zoom = 1;
  const chrome = {
    runtime: { getManifest: () => ({ version: "1.0.0" }), getPlatformInfo: async () => ({ os: "linux" }), onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    tabs: {
      query: record("tabs.query", (q) => (q.windowId ? [{ ...tab, id: 6, index: 0 }, tab, { ...tab, id: 8, index: 2 }] : [tab])),
      create: record("tabs.create", (o) => ({ id: 9, windowId: 1, ...o })),
      remove: record("tabs.remove"),
      update: record("tabs.update"),
      reload: record("tabs.reload"),
      goBack: record("tabs.goBack"),
      goForward: record("tabs.goForward"),
      getZoom: record("tabs.getZoom", () => zoom),
      setZoom: record("tabs.setZoom", (id, z) => (zoom = z)),
    },
    windows: { create: record("windows.create", (o) => ({ id: 2, ...o })), update: record("windows.update"), get: record("windows.get", () => ({ state: "normal" })) },
    sessions: { restore: record("sessions.restore") },
    scripting: { executeScript: record("scripting.executeScript") },
    bookmarks: {
      search: record("bookmarks.search", () => []),
      create: record("bookmarks.create"),
      getRecent: record("bookmarks.getRecent", () => [{ title: "Docs", url: "https://docs.example" }, { title: "Folder" }]),
    },
    history: { search: record("history.search", () => [{ title: "", url: "https://a.example" }, { title: "B", url: "https://b.example" }]) },
  };
  // Everything the extension starts (timers, sockets) is tracked so a test can shut it down.
  const timers = [];
  const sockets = [];
  class TrackedWebSocket extends WebSocket {
    constructor(url) {
      super(url, { headers: { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" } }); // what a browser sends for an extension

      sockets.push(this);
    }
  }
  const timer = (start) => (...args) => {
    const t = start(...args);
    timers.push(t);
    return t;
  };
  const sandbox = { chrome, WebSocket: TrackedWebSocket, crypto, navigator: { userAgent }, URL, console, setTimeout: timer(setTimeout), clearTimeout, setInterval: timer(setInterval), clearInterval };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  const close = () => {
    timers.forEach((t) => (clearTimeout(t), clearInterval(t)));
    sandbox.__knobdeck.stop();
    sockets.forEach((ws) => ws.close());
  };
  return { calls, sandbox, chrome, close };
}

const connected = async (plugin) => {
  for (let i = 0; i < 100; i++) {
    const list = await plugin.request("query", { query_id: "connected_browser", inputs: {} });
    if (list.length) return list;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the extension never connected");
};

describe("extension ⇄ browser-plugin", { skip: exe ? false : "KNOBDECK_BROWSER_PLUGIN is not set" }, () => {
  let plugin, port, browser, input;
  const others = [];
  const press = (id, extra = {}, opts) => plugin.invoke(id, { browser: input, ...extra }, opts);
  const names = () => browser.calls.map((c) => c[0]);
  const reset = () => browser.calls.splice(0);

  before(async () => {
    port = await freePort();
    plugin = await PluginDriver.start(exe, { BROWSER_PORT: String(port) });
    browser = fakeBrowser(port);
    const list = await connected(plugin);
    assert.equal(list.length, 1);
    assert.equal(list[0].label, "Chrome");
    input = { value: list[0].value, label: list[0].label };
  });
  after(async () => {
    browser.close();
    others.forEach((b) => b.close());
    await plugin.stop();
  });

  it("lists only connected browsers", async () => {
    const list = await plugin.request("query", { query_id: "connected_browser", inputs: {} });
    assert.deepEqual(list.map((b) => b.label), ["Chrome"]);
  });

  it("runs tab and window actions through the extension APIs", async () => {
    for (const [id, expected] of [
      ["new-tab", "tabs.create"], ["new-window", "windows.create"], ["close-tab", "tabs.remove"], ["reopen-closed-tab", "sessions.restore"],
      ["reload-tab", "tabs.reload"], ["go-back", "tabs.goBack"], ["go-forward", "tabs.goForward"], ["stop-loading", "scripting.executeScript"],
      ["print-page", "scripting.executeScript"],
    ]) {
      reset();
      assert.deepEqual((await press(id)).errors, [], id);
      assert.ok(names().includes(expected), `${id} → ${expected}, got ${names()}`);
    }
    reset();
    await press("hard-reload-tab");
    assert.deepEqual(browser.calls.find((c) => c[0] === "tabs.reload").slice(1), [7, { bypassCache: true }]);
    reset();
    await press("new-private-window");
    assert.deepEqual(browser.calls.find((c) => c[0] === "windows.create")[1], { incognito: true });
  });

  it("cycles tabs and wraps", async () => {
    reset();
    await press("next-tab");
    assert.deepEqual(browser.calls.find((c) => c[0] === "tabs.update").slice(1), [8, { active: true }]);
    reset();
    await press("previous-tab");
    assert.deepEqual(browser.calls.find((c) => c[0] === "tabs.update").slice(1), [6, { active: true }]);
  });

  it("opens browser pages and URLs", async () => {
    reset();
    await press("open-history");
    assert.equal(browser.calls.find((c) => c[0] === "tabs.create")[1].url, "chrome://history");
    reset();
    await press("open-url", { url: "example.org/x" });
    assert.equal(browser.calls.find((c) => c[0] === "tabs.create")[1].url, "https://example.org/x");
    reset();
    const bad = await press("open-url", { url: "javascript:alert(1)" });
    assert.equal(bad.errors.length, 1);
    assert.ok(!names().includes("tabs.create"));
  });

  it("bookmarks the page once", async () => {
    reset();
    await press("bookmark-page");
    assert.deepEqual(browser.calls.find((c) => c[0] === "bookmarks.create").slice(1), [{ title: "Example", url: "https://example.com/" }]);
  });

  it("sets and steps zoom", async () => {
    reset();
    await press("page-zoom", { value: 150 }, { trigger: "adjust" });
    assert.deepEqual(browser.calls.find((c) => c[0] === "tabs.setZoom").slice(1), [7, 1.5]);
    reset();
    await press("hold-zoom-out", {}, { trigger: "hold_start" });
    await press("hold-zoom-out", {}, { trigger: "hold_end" });
    assert.deepEqual(browser.calls.find((c) => c[0] === "tabs.setZoom").slice(1), [7, 1.4]);
    reset();
    await press("page-zoom", { delta: 1, step: 5 }, { trigger: "adjust" });
    assert.deepEqual(browser.calls.find((c) => c[0] === "tabs.setZoom").slice(1), [7, 1.45]);
  });

  it("fills the bookmark and history wheels, and opens a child", async () => {
    const wheel = await plugin.request("wheel", { action_id: "bookmarks-wheel", inputs: { browser: input } });
    assert.deepEqual(wheel.slices.map((s) => s.label), ["Docs"]);
    const history = await plugin.request("wheel", { action_id: "history-wheel", inputs: { browser: input } });
    assert.deepEqual(history.slices.map((s) => s.label), ["https://a.example", "B"]);
    reset();
    assert.deepEqual((await plugin.invoke("history-wheel", { browser: input }, { childId: history.slices[1].id })).errors, []);
    assert.equal(browser.calls.find((c) => c[0] === "tabs.create")[1].url, "https://b.example/");
  });

  it("sends a custom keybind to the page as key events", async () => {
    reset();
    assert.deepEqual((await press("custom-keybind", { keys: "shift k" })).errors, []);
    const call = browser.calls.find((c) => c[0] === "scripting.executeScript")[1];
    assert.deepEqual(call.args[0], { ctrlKey: false, altKey: false, shiftKey: true, metaKey: false, key: "K", code: "KeyK" });
    assert.equal(call.world, "MAIN");
  });

  it("reports a missing selection and a browser that went away", async () => {
    assert.equal((await plugin.invoke("new-tab", {})).errors.length, 1);
    assert.equal((await plugin.invoke("new-tab", { browser: { value: "gone", label: "Gone" } })).errors.length, 1);
  });

  it("refuses web pages", async () => {
    const attempt = (headers) =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
        ws.onopen = () => resolve("open");
        ws.onerror = () => resolve("refused");
      });
    assert.equal(await attempt({ Origin: "https://evil.example" }), "refused"); // a web page
    assert.equal(await attempt(), "refused"); // no Origin at all: not an extension
  });

  it("keeps a second browser apart and lists both", async () => {
    const edge = fakeBrowser(port, "Mozilla/5.0 Chrome/130.0 Edg/130.0");
    others.push(edge);
    edge.chrome.storage.local.set({ instanceId: "second" });
    const list = await (async () => {
      for (let i = 0; i < 100; i++) {
        const l = await plugin.request("query", { query_id: "connected_browser", inputs: {} });
        if (l.length === 2) return l;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("second browser never connected");
    })();
    assert.deepEqual(list.map((b) => b.label).sort(), ["Chrome", "Microsoft Edge"]);
  });
});

describe("key names", () => {
  const fake = fakeBrowser(1);
  const { parseKeys } = fake.sandbox.__knobdeck;
  after(() => fake.close());
  it("parses chords", () => {
    assert.deepEqual({ ...parseKeys("ctrl pgdn", false) }, { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: "PageDown", code: "PageDown" });
    assert.equal(parseKeys("mod l", true).metaKey, true);
    assert.equal(parseKeys("mod l", false).ctrlKey, true);
    assert.equal(parseKeys("f11", false).key, "F11");
    assert.equal(parseKeys("cmd lbracket", true).code, "BracketLeft");
    assert.throws(() => parseKeys("ctrl", false), /required/);
    assert.throws(() => parseKeys("ctrl wat", false), /Unknown key/);
  });
});
