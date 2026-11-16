# Store listings

Text for the Chrome Web Store form (addons.mozilla.org takes its listing from
`amo-metadata.json`). Upload `knobdeck-browser-companion-chrome-<version>.zip` from a GitHub release.
Edge, Brave and other Chromium browsers install from the Chrome Web Store; there is no Edge Add-ons
listing.

## Store listing tab

- **Name:** KnobDeck Browser Companion (from the manifest)
- **Summary** (≤132 characters): Lets the KnobDeck dial and deck control this browser: tabs,
  windows, zoom, bookmarks and history, without keyboard shortcuts.
- **Category:** *Productivity → Tools* (*Tools* in the older form)
- **Language:** English
- **Homepage:** https://knobdeck.harshalkudale.com
- **Support:** https://github.com/Knobdeck/knobdeck-browser-companion/issues
- **Privacy policy:** https://github.com/Knobdeck/knobdeck-browser-companion/blob/master/PRIVACY.md

### Description

```
KnobDeck Browser Companion connects your browser to KnobDeck, the app for the KnobDeck dial and deck, so its Browser Controls buttons work through the browser's own extension APIs instead of keyboard shortcuts.

What your dial and deck can do:
• Tabs: new, close, reopen closed, next, previous
• Windows: new window, new private window, fullscreen
• Pages: reload, hard reload, back, forward, stop, print, bookmark
• Zoom: turn the dial to zoom the page, or hold to zoom
• Bookmarks and history wheels: your 16 newest of each, on the dial
• Open a link, and send key presses to the page (Custom Keybind)

How it works: install the extension and keep KnobDeck running. KnobDeck lists every connected browser under Browser in its Browser Controls actions.

Private: the extension talks only to KnobDeck on your own computer (127.0.0.1). It has no analytics or telemetry, sends nothing over the internet and doesn't read page content.

Requires the KnobDeck app with its Browser Controls plugin.
```

## Chrome Web Store: Privacy practices tab

**Single purpose:**

```
Lets the KnobDeck desktop app (a hardware dial and button deck) control this browser: when a KnobDeck button is pressed, KnobDeck sends the action over a local connection (127.0.0.1) and the extension performs it with the browser's extension APIs.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `tabs` | To act on the active tab when a KnobDeck button is pressed: open, close, switch, reload, go back/forward, change zoom, and read the active tab's URL and title for Bookmark Page. |
| `bookmarks` | For the Bookmark Page button and the bookmarks wheel, which lists the 16 most recent bookmarks on the KnobDeck dial so one can be opened. |
| `history` | For the history wheel, which lists the 16 most recent history entries on the KnobDeck dial so one can be opened. |
| `sessions` | For the Reopen Closed Tab button (restores the most recently closed tab). |
| `scripting` | Print Page, Stop Loading and Custom Keybind run a one-line function in the active tab (window.print(), window.stop(), or dispatching the key events the user configured). Nothing is read from the page. |
| `storage` | Stores a random id for this browser profile (so KnobDeck can tell browsers apart) and the optional local port setting. |
| `alarms` | Reconnects to the KnobDeck app every 30 seconds while it isn't running, so buttons work as soon as KnobDeck starts. |
| Host permission `<all_urls>` | `scripting` needs access to whichever site is open in the active tab for Print Page, Stop Loading and Custom Keybind. The extension never reads page content. |

**Remote code:** *No, I am not using remote code.*

**Data usage:** tick **Web history** only. The bookmarks and history lists and the active tab's URL
go to the KnobDeck app on the same computer to show on the dial; nothing leaves the computer. Then
tick all three certifications (not sold, not used for unrelated purposes, not used for
creditworthiness).

## Images

| | |
|---|---|
| Icon | 128×128 (in the zip) |
| Screenshots | at least 1, 1280×800 or 640×400 |
| Small promo tile | 440×280 |
