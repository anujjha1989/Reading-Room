import { opendir, lstat, unlink, utimes } from "node:fs/promises";
import { join } from "node:path";

/** Derived audio only, never voices/books. A bounded candidate list keeps
 * housekeeping memory fixed even after years of listening. Active/recent
 * clips stay pinned; evicted content-addressed WAVs are safely regenerated. */
export function createWavCache(root, { maxBytes = 2 * 1024 ** 3, minimumAgeMs = 300_000, intervalMs = 600_000 } = {}) {
  const pins = new Map(), touched = new Map(), deleting = new Map();
  let running = null, written = 0, closed = false;
  async function sweep() {
    const oldest = []; let bytes = 0, removed = 0;
    try {
      for await (const voice of await opendir(root)) {
        if (!voice.isDirectory() || !/^[A-Za-z0-9_-]{1,64}$/.test(voice.name)) continue;
        for await (const file of await opendir(join(root, voice.name))) {
          if (!file.isFile() || !/^[0-9a-f]{40}\.wav$/.test(file.name)) continue;
          const path = join(root, voice.name, file.name), info = await lstat(path).catch(() => null);
          if (!info?.isFile()) continue;
          bytes += info.size;
          if (!pins.has(path) && Date.now() - info.mtimeMs >= minimumAgeMs) oldest.push({ path, bytes: info.size, modified: info.mtimeMs });
          if (oldest.length > 4224) { oldest.sort((a, b) => a.modified - b.modified); oldest.length = 4096; }
        }
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    oldest.sort((a, b) => a.modified - b.modified);
    if (bytes > maxBytes) for (const clip of oldest) {
      if (bytes <= maxBytes * .9 || closed) break;
      // Re-check after asynchronous inventory: a listener may have opened or
      // touched the clip since it became an eviction candidate.
      if (pins.has(clip.path)) continue;
      const latest = await lstat(clip.path).catch(() => null);
      if (!latest?.isFile() || Date.now() - latest.mtimeMs < minimumAgeMs || pins.has(clip.path)) continue;
      let finished;
      deleting.set(clip.path, new Promise(resolve => { finished = resolve; }));
      try { await unlink(clip.path); bytes -= clip.bytes; removed++; } catch {}
      finally { deleting.delete(clip.path); finished(); }
    }
    written = 0; return { bytes, removed };
  }
  const prune = () => {
    if (closed) return Promise.resolve({ bytes: 0, removed: 0 });
    if (!running) running = sweep().finally(() => { running = null; });
    return running;
  };
  const timer = setInterval(() => { void prune().catch(() => {}); }, intervalMs); timer.unref();
  return {
    prune,
    wrote(bytes) { written += bytes; if (written >= 64 * 1024 ** 2) void prune().catch(() => {}); },
    async pin(path) {
      // A request arriving during eviction waits, then observes a cache miss.
      // It must never assume a soon-to-be-unlinked WAV is ready to stream.
      while (deleting.has(path)) await deleting.get(path);
      pins.set(path, (pins.get(path) ?? 0) + 1);
      const now = Date.now();
      if (now - (touched.get(path) ?? 0) > 60_000) {
        touched.delete(path); touched.set(path, now);
        if (touched.size > 512) touched.delete(touched.keys().next().value);
        void utimes(path, new Date(now), new Date(now)).catch(() => {});
      }
      let released = false;
      return () => { if (released) return; released = true; const count = (pins.get(path) ?? 1) - 1; if (count) pins.set(path, count); else pins.delete(path); };
    },
    async close() { closed = true; clearInterval(timer); await running; },
  };
}
