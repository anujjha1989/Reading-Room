import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWavCache } from "../server/wav-cache.mjs";
async function setup(t, maxBytes = 150) {
  const root = await mkdtemp(join(tmpdir(), "home-books-wav-cache-"));
  const cache = createWavCache(root, { maxBytes });
  t.after(async () => { await cache.close(); await rm(root, { recursive: true }); });
  await mkdir(join(root, "alba"));
  async function clip(number, old = true, name = number.toString(16).padStart(40, "0") + ".wav") {
    const file = join(root, "alba", name); await writeFile(file, Buffer.alloc(100));
    if (old) { const time = new Date(Date.now() - 600_000 + number); await utimes(file, time, time); }
    return file;
  }
  return { root, cache, clip };
}
test("under-budget audio is retained; over-budget pruning protects active and recent clips", async t => {
  const { cache, clip } = await setup(t);
  const oldest = await clip(1); assert.equal((await cache.prune()).removed, 0);
  const active = await clip(2), recent = await clip(3, false);
  const release = await cache.pin(active), releaseAgain = await cache.pin(active);
  assert.equal((await cache.prune()).removed, 1);
  await assert.rejects(stat(oldest), { code: "ENOENT" });
  assert.equal((await stat(active)).size, 100); assert.equal((await stat(recent)).size, 100);
  release(); release(); releaseAgain();
});
test("cache housekeeping never deletes voice models, temporary output or unrelated files", async t => {
  const { cache, clip, root } = await setup(t, 1);
  const model = await clip(1, true, "alba.onnx"), temporary = await clip(2, true, ".pending.wav");
  await writeFile(join(root, "book.epub"), "book");
  assert.equal((await cache.prune()).removed, 0);
  assert.ok(await stat(model)); assert.ok(await stat(temporary)); assert.ok(await stat(join(root, "book.epub")));
});
