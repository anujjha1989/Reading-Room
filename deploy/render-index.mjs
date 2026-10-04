// Generate this build's complete document and hydration payload from React.
import { readFile, writeFile } from "node:fs/promises";
import { register } from "node:module";
register("../tests/cloudflare-loader.mjs", import.meta.url);
const root = new URL("../", import.meta.url);
const version = (await readFile(new URL("overrides/VERSION", root), "utf8")).trim();
if (!/^\d+$/.test(version)) throw new Error("Invalid release version");
const { default: worker } = await import(new URL("dist/server/index.js", root));
const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
}, { waitUntil() {}, passThroughOnException() {} });
if (!response.ok || !response.headers.get("content-type")?.startsWith("text/html")) throw new Error(`Source render failed: ${response.status}`);
const html = await response.text();
if (!html.includes("__VINEXT_RSC_DONE__") || !html.includes('name="rr-react-library-chrome"')) throw new Error("Incomplete source render");
// Deployment metadata only: visual markup and RSC come entirely from current source.
await writeFile(new URL("dist/index.html", root), html.replace("<head>", `<head><meta name="rr-app-version" content="${version}"/>`));
console.log(`Rendered Home Books v${version} from the current build`);
