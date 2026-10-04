import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const origin = process.env.READING_ROOM_BASE_URL || "http://anujrpi.local:4311";
const headers = {};
if (process.env.READING_ROOM_COOKIE_FILE) {
  const cookie = JSON.parse(await readFile(process.env.READING_ROOM_COOKIE_FILE, "utf8"));
  headers.Cookie = `${cookie.name}=${cookie.value}`;
}
const get = path => fetch(origin + path, { headers, signal: AbortSignal.timeout(25_000) });
const response = await get("/api/tts/voices");
assert.equal(response.status, 200);
const { voices } = await response.json();
assert.equal(voices.filter(v => v.id.startsWith("kokoro-")).length, 28);
const piper = voices.find(v => v.id.startsWith("en_")); assert.ok(piper, "existing Piper voices remain");
for (const voice of [piper.id, "kokoro-af_heart", "kokoro-bf_emma", "kokoro-bm_george"]) {
  const path = `/api/tts?v=${voice}&t=${encodeURIComponent("Welcome to Home Books.")}`;
  const started = Date.now(); const audio = await get(path);
  assert.equal(audio.status, 200, `synthesis ${voice}`);
  assert.equal(audio.headers.get("content-type"), "audio/wav");
  const wav = Buffer.from(await audio.arrayBuffer());
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.ok(wav.length > 1000, "nonempty narration");
  const range = await fetch(origin + path, { headers: { ...headers, Range: "bytes=0-3" }, signal: AbortSignal.timeout(5000) });
  assert.equal(range.status, 206); assert.equal(await range.text(), "RIFF");
  console.log(`${origin}: ${voice} playable WAV and cached ranges passed (${Date.now()-started}ms)`);
}
