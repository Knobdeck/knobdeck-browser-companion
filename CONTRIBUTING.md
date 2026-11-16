# Developing the KnobDeck Browser Companion

One of the [KnobDeck companions](https://github.com/Knobdeck/knobdeck-companion). The extension
dials the KnobDeck `browser-plugin` on `127.0.0.1:32147`; the message format is in that repo's
[PROTOCOL.md](https://github.com/Knobdeck/knobdeck-companion/blob/master/PROTOCOL.md). Ids are a
contract: add, never rename.

## Build and test

Node 22+ and `zip`:

```sh
npm run build            # dist/chrome and dist/firefox
npm run package          # also dist/*.zip
KNOBDECK_BROWSER_PLUGIN=…/knobdeck-plugins/target/release/browser-plugin npm test
```

The tests run the real `browser-plugin` (`cargo build -p browser-plugin` in
[knobdeck-plugins](https://github.com/Knobdeck/knobdeck-plugins)) against `src/background.js` with a
recording stand-in for the browser APIs. Without `KNOBDECK_BROWSER_PLUGIN` the end-to-end tests
skip. CI runs them on Linux and Windows (and macOS on pull requests and manual CI runs; releases skip macOS).

`test/compat/driver.mjs` is a copy of `compat/driver.mjs` in knobdeck-companion; keep them in step.

## Releasing

1. Bump `version` in `package.json` (the build writes it into both manifests) and add a
   `CHANGELOG.md` entry. Merge to `master`.
2. **Actions → Release → Run workflow** on `master`.

The workflow runs CI, creates the tag `v<version>` and a GitHub release with both zips, then submits
the Chrome zip to the Chrome Web Store and Microsoft Edge Add-ons and the Firefox build to
addons.mozilla.org. Each store then reviews it before it goes live. A store whose secrets aren't set
is skipped with a warning; re-running the workflow for a released version only retries the stores.

### Store setup

The Chrome Web Store and Edge Add-ons need the **first** version uploaded by hand (their APIs only
update existing listings): upload the Chrome zip from a GitHub release. addons.mozilla.org creates
the listing from the workflow. Then set these in **Settings → Environments → `release`**:

| Store | Secrets | Variables |
|---|---|---|
| Chrome Web Store | `CWS_SERVICE_ACCOUNT_KEY`: JSON key of a Google Cloud service account (Chrome Web Store API enabled) that is added under *Account → Service accounts* in the developer dashboard | `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID` |
| Microsoft Edge Add-ons | `EDGE_API_KEY`, `EDGE_CLIENT_ID` (Partner Center → *Publish API*) | `EDGE_PRODUCT_ID` |
| addons.mozilla.org | `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` ([API keys](https://addons.mozilla.org/developers/addon/api/key/)) | |

The Firefox add-on id is `browser-companion@knobdeck.harshalkudale.com`; never change it.
`store/amo-metadata.json` is the listing metadata AMO uses when the add-on is new.
