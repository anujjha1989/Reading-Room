// The Reference Room as Home Books' second library. Fails if any link in the
// chain is missing: the server catalogue and file route, the client's Library
// filter, and the prerendered template the client hydrates against (a filter
// changed in the component but not the template is a hydration error on load).
import { readFileSync } from "node:fs";
let failed = 0;
const t = (ok, name) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failed += 1; };
const server = readFileSync("server/standalone-server.mjs", "utf8");
const client = readFileSync("app/LibraryClient.tsx", "utf8");
const template = readFileSync("dist/index.html", "utf8");
t(/case "\/reference-catalog\.json"/.test(server), "server serves /reference-catalog.json");
t(/id: `ref-\$\{row\.id\}`|const id = `ref-\$\{row\.id\}`/.test(server) && /id\.startsWith\("ref-"\)/.test(server), "reference ids are prefixed and served from disk");
t(/fetch\("\/reference-catalog\.json"\)/.test(client), "client loads the Reference Room catalogue");
t(/<option value="reading">Reading Room<\/option><option value="reference">Reference Room<\/option>/.test(client), "Library filter offers both libraries");
t(!/label="Collection"/.test(client), "Collection filter removed");
t(template.includes('<label><span>Library</span><select><option value="reading" selected="">Reading Room</option><option value="reference">Reference Room</option></select></label>')
  && !template.includes("<span>Collection</span>"), "template matches the client's first render");
t(/useState<"reading" \| "reference">\("reading"\)/.test(client), "Reading Room is the default on every launch");
if (failed) process.exit(1);
