import { existsSync, readFileSync, readdirSync } from "node:fs";

const reader = readFileSync("app/BookReader.tsx", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const html = readFileSync("dist/index.html", "utf8");
const assets = readdirSync("dist/client/assets");
const css = assets.filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(`dist/client/assets/${name}`, "utf8")).join("\n");
const js = assets.filter((name) => /LibraryClient-.*\.js$/.test(name))
  .map((name) => readFileSync(`dist/client/assets/${name}`, "utf8")).join("\n");

const checks = [
  [!existsSync("overrides/book-art/fullscreen-bundle.js")
    && !existsSync("overrides/book-art/fullscreen-bundle.css")
    && !existsSync("overrides/assets/reader-fix.js")
    && !existsSync("overrides/assets/reader-fix.css"), "retired reader overrides are absent"],
  [reader.includes('import "./readerChromeBridge.js"')
    && reader.includes('import "./bookFontScale.js"'), "reader owns its interaction and font modules"],
  [layout.includes('import "./reader-chrome.css"')
    && layout.includes('import "./reader-layout.css"'), "app layout owns reader styles"],
  [/name="rr-app-version" content="\d+"/.test(html), "rendered HTML contains an explicit version"],
  [!/fullscreen-bundle-v|reader-fix\.(?:js|css)/.test(html), "rendered HTML loads no retired reader assets"],
  [js.includes("rr-light-reading") && js.includes("rr-meta-corrections")
    && js.includes("__rrFontScaleFixed"), "built client contains reader, metadata and font code"],
  [css.includes("rr-spring-menu-in") && css.includes("rr-panel-close"),
    "built stylesheet contains reader chrome and motion"],
];

let failures = 0;
for (const [passed, label] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
  if (!passed) failures += 1;
}
process.exit(failures ? 1 : 0);
