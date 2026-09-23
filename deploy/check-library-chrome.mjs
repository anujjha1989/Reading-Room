import { readFileSync } from "node:fs";

const component = readFileSync("app/LibraryChrome.tsx", "utf8");
const settings = readFileSync("app/SettingsPanel.tsx", "utf8");
const client = readFileSync("app/LibraryClient.tsx", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const renderer = readFileSync("deploy/render-index.mjs", "utf8");
const legacy = readFileSync("overrides/book-art/fullscreen-bundle.js", "utf8");

let failed = false;
const check = (condition, message) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${message}`);
  if (!condition) failed = true;
};

for (const id of ["rr-filter-btn", "rr-sort-btn", "rr-settings-link", "rr-sort-menu"]) {
  check(component.includes(`id=\"${id}\"`), `React owns #${id}`);
}
check(settings.includes('id="rr-settings-overlay"') && component.includes("<SettingsPanel"), "React owns the Settings panel");
check(!component.includes("<iframe") && !component.includes("settingsUrl"), "library no longer loads Settings through an iframe");
for (const label of ["Library sources", "Library maintenance", "Metadata & artwork", "Appearance", "About", "Refresh Library", "Drop folder", "Sync new additions", "Version"]) {
  check(settings.includes(label), `React Settings retains ${label}`);
}
for (const action of ['action: "add"', 'action: "toggle"', 'action: "remove"', 'action: "dropFolder"', 'mode: "full"', 'mode: "incremental"']) {
  check(settings.includes(action), `React Settings retains ${action}`);
}
check(component.includes('className="rr-library-dock"'), "React owns the library navigation dock");
check(client.includes("<LibraryChrome"), "LibraryClient renders the typed chrome component");
check(layout.includes('name="rr-react-library-chrome"'), "new renders declare React chrome ownership");
check(renderer.includes('name="rr-react-library-chrome"'), "the committed prerender is reconciled to React ownership");
check(renderer.includes('["<h1>Find your next book.</h1>", "<h1>Home</h1>"]'), "the prerendered heading matches hydration");
check(component.includes('stroke="var(--rr-library-icon)"')
  && component.includes('fill="var(--rr-library-icon)"'), "React icons declare their own themed stroke and fill");
const globalCss = readFileSync("app/globals.css", "utf8");
check(globalCss.includes(':root[data-rr-theme="dark"] { --rr-library-icon:#f5f5f7; }')
  && globalCss.includes(':root[data-rr-theme="light"] { --rr-library-icon:#26332f; }'), "library icon token covers explicit light and dark themes");
check(!legacy.includes("rr-library-dock"), "legacy navigation injector is deleted");
check(!legacy.includes('var ID = "rr-settings-link"'), "legacy Settings injector is deleted");
check(!legacy.includes('FILTER_ID = "rr-filter-btn"'), "legacy filter/sort injector is deleted");

process.exit(failed ? 1 : 0);
