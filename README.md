# KnobDeck Browser Companion

A small extension for Chrome, Edge, Brave and other Chromium browsers, and for Firefox and Zen. It
lets the [KnobDeck](https://knobdeck.harshalkudale.com) `browser-plugin` control the browser through
its real extension APIs, instead of focusing the window and sending keyboard shortcuts.

Open KnobDeck, add a Browser Controls action and pick your browser from **Browser**: the list shows
the browsers that are connected right now. No browser listed? Check that the extension is installed
and enabled, and that KnobDeck is running.

## What it does

Everything the KnobDeck browser actions do runs in the browser: new / close / reopen / next /
previous tab, new window, private window, reload, hard reload, back, forward, stop, print, bookmark
the page, fullscreen, page zoom (the dial slider and hold zoom), open a URL, the bookmarks and
history wheels, and Custom Keybind (sent to the page as key events).

Not every action has an extension API in every browser. These still send a keyboard shortcut to the
browser (KnobDeck brings it to the front first): Focus Address Bar, Find in Page and Save Page in all
browsers, and Open Downloads / History / Bookmarks Manager in Firefox and Zen. Custom Keybind reaches
the page only (a page can ignore synthetic keys; browser shortcuts like Ctrl+T don't work through it).

**Private windows.** Browsers only let an extension open one after you allow it in private windows
(Chrome: *Allow in Incognito*; Firefox: *Run in Private Windows*).

## Install

Until the store listings exist, load the build from a release (`browser-v<version>`):

- **Chrome / Edge / Brave:** unzip `knobdeck-browser-companion-chrome-*.zip`, open
  `chrome://extensions`, turn on *Developer mode*, *Load unpacked*, pick the folder.
- **Firefox / Zen:** `about:debugging` → *This Firefox* → *Load Temporary Add-on…* → the
  `manifest.json` of the unzipped `…-firefox-*.zip` (temporary until the add-on is signed).

## Build and test (Node 22+)

```sh
cd browser
npm run build            # dist/chrome and dist/firefox
npm run package          # also dist/*.zip
KNOBDECK_BROWSER_PLUGIN=…/knobdeck-plugins/target/release/browser-plugin npm test
```

The tests run the real `browser-plugin` against `src/background.js` with a recording stand-in for
the browser APIs. Without `KNOBDECK_BROWSER_PLUGIN` the end-to-end tests skip.

The extension reads an optional `port` from its local storage (default `32147`), matching the
plugin's `BROWSER_PORT` setting.

## Releasing

Bump `version` in `package.json` (the build writes it into both manifests), add a changelog entry,
merge to `master`, push the tag `browser-v<version>`. CI tests, builds both zips and attaches them to
the GitHub release. Store publishing (Chrome Web Store, Edge Add-ons, addons.mozilla.org) is not
set up yet.
