import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) {
    throw new Error(`invalid argument near ${key || "end of command"}`);
  }
  args.set(key.slice(2), value);
}

const required = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
};

const root = resolve(new URL("..", import.meta.url).pathname);
const version = required("version");
const outputDir = resolve(required("output-dir"));
const libraryAsset = required("library-asset");

const digest = async (file, role) => {
  const data = await readFile(file);
  const info = await stat(file);
  return {
    role,
    file: basename(file),
    source: relative(root, file),
    bytes: info.size,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
};

const assetFiles = [
  [join(root, "dist/index.html"), "index"],
  [join(root, "overrides/sw.js"), "service-worker"],
  [join(root, "dist/client/assets", libraryAsset), "react-client"],
  [join(root, "app/readerChromeBridge.js"), "reader-interactions-source"],
  [join(root, "app/bookFontScale.js"), "book-font-scale-source"],
  [join(root, "app/reader-chrome.css"), "reader-chrome-source"],
  [join(root, "app/reader-layout.css"), "reader-layout-source"],
  [join(root, "app/readAloudEngine.ts"), "read-aloud-source"],
];

const record = {
  schemaVersion: 1,
  application: "Reading Room",
  version: Number(version),
  deployedAt: new Date().toISOString(),
  previousVersion: Number(required("previous-version")),
  mode: required("mode"),
  git: {
    commit: required("commit"),
    branch: required("branch"),
    tag: args.get("tag") || null,
    sourceTreeClean: required("source-clean") === "true",
  },
  assets: await Promise.all(assetFiles.map(([file, role]) => digest(file, role))),
  verification: {
    lan: required("lan-result"),
    tailscale: required("tailscale-result"),
    liveReference: `rr-app-version:${version}`,
  },
  rollback: {
    directory: required("rollback"),
  },
};

await mkdir(outputDir, { recursive: true });
const destination = join(outputDir, `v${version}.json`);
const temporary = `${destination}.tmp-${process.pid}`;
await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
await rename(temporary, destination);
console.log(`    deployment record: ${destination}`);
