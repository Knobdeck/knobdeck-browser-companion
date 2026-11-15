// Builds the two extensions into dist/chrome and dist/firefox (and, with --zip, dist/*.zip).
// The script is shared; only the manifest differs (Chrome: MV3 service worker, Firefox: MV2 page).

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

rmSync(dist, { recursive: true, force: true });
for (const target of ["chrome", "firefox"]) {
  const out = join(dist, target);
  mkdirSync(out, { recursive: true });
  cpSync(join(root, "src/background.js"), join(out, "background.js"));
  cpSync(join(root, "icons"), join(out, "icons"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, `manifest.${target}.json`), "utf8"));
  manifest.version = version; // package.json is the one place the version lives
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (process.argv.includes("--zip")) {
    const zip = join(dist, `knobdeck-browser-companion-${target}-${version}.zip`);
    execFileSync("zip", ["-qr", zip, "."], { cwd: out });
    console.log(zip);
  } else {
    console.log(out);
  }
}
