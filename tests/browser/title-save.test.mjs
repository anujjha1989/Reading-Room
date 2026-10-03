import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { launchBrowser } from "./cdp-browser.mjs";

test("editing a Continue title survives library reload and server restart", { timeout: 60000 }, async t => {
  const root = new URL("../../", import.meta.url).pathname;
  const dir = await mkdtemp(join(tmpdir(), "hb-title-save-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const site = join(dir, "site"), data = join(dir, "data");
  await mkdir(site); await mkdir(data);
  await writeFile(join(site, "index.html"), await readFile(join(root, "dist/index.html")));
  await symlink(join(root, "dist/client/assets"), join(site, "assets"));
  const id = "test-thrones-book";
  await writeFile(join(site, "catalog.json"), JSON.stringify([{ id, title: "5. A Song of Ice and Fire Series", author: "George R.R. Ma", path: "Books / 5. A Song of Ice and Fire Series by George R.R. Ma", format: "EPUB", source: "Local", url: "/unused" }]));
  await writeFile(join(data, "cover-cache.json"), JSON.stringify({ [id]: { found: true, url: "/unused-cover" } }));
  await writeFile(join(data, "library-state.json"), JSON.stringify([{ bookId: id, lastOpened: Date.now(), status: "reading", progressLabel: "Page 10 of 100", updatedAt: Date.now() }]));
  const port = 30000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
  let server;
  const start = async () => {
    server = spawn(process.execPath, [join(root, "server/standalone-server.mjs")], { env: { ...process.env, READING_ROOM_HOST: "127.0.0.1", PORT: String(port), READING_ROOM_SITE: site, READING_ROOM_DATA: data, READING_ROOM_PUBLIC_PORT: "0" }, stdio: "ignore" });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + "/api/health")).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
    throw Error("Test server did not start");
  };
  const stop = () => new Promise(resolve => { server.once("exit", resolve); server.kill("SIGTERM"); });
  t.after(() => server?.kill("SIGTERM")); await start();
  const browser = await launchBrowser(); t.after(() => browser.close());
  await browser.goto(base);
  await browser.waitFor(`!!document.querySelector('.rr-card-more')`);
  await browser.evaluate(`document.querySelector('.rr-card-more').click()`);
  await browser.waitFor(`!!document.querySelector('[role="menu"]')`);
  await browser.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(b => /Update Metadata/.test(b.textContent)).click()`);
  await browser.waitFor(`!!document.querySelector('#rr-metafix input')`);
  await browser.evaluate(`(() => { const input = document.querySelector('#rr-metafix input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'A Game of Thrones'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await browser.evaluate(`document.querySelector('.rr-mf-save').click()`);
  await browser.waitFor(`!document.querySelector('#rr-metafix')`);
  await browser.waitFor(`document.body.textContent.includes('A Game of Thrones')`);
  await stop(); await start(); await browser.goto(base);
  await browser.waitFor(`document.body.textContent.includes('A Game of Thrones')`);
  const catalog = await (await fetch(base + "/catalog.json")).json();
  assert.equal(catalog[0].title, "A Game of Thrones"); assert.equal(catalog[0].titleCorrected, true);
  assert.equal(catalog[0].id, id);
  assert.match(await readFile(join(data, "library-state.json"), "utf8"), /Page 10 of 100/);
});
