import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { once } from "node:events";
import { createKokoroPool, installedKokoroVoices, kokoroVoices } from "../server/kokoro.mjs";

test("Kokoro catalogue is additive, English-only and hidden until installation completes", async t => {
  const directory = await mkdtemp(join(tmpdir(), "kokoro-catalogue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await installedKokoroVoices(directory), []);
  for (const name of ["venv/bin/python3", "models/models.json", "models/kokoro-int8.onnx", "models/voices-v1.0.bin"]) {
    await mkdir(join(directory, name, ".."), { recursive: true }); await writeFile(join(directory, name), "test");
  }
  assert.deepEqual(await installedKokoroVoices(directory), []);
  await writeFile(join(directory, "READY"), "verified");
  assert.deepEqual(await installedKokoroVoices(directory), kokoroVoices);
  assert.equal(new Set(kokoroVoices.map(v => v.id)).size, 28);
  assert.ok(kokoroVoices.every(v => /^kokoro-[ab][fm]_/.test(v.id) && v.label.includes("Kokoro")));
});

test("Kokoro voice changes reuse the model and send the chosen voice on every job", async t => {
  let starts = 0; const jobs = [];
  const fixture = fileURLToPath(new URL("./fixtures/piper-process.mjs", import.meta.url));
  const pool = createKokoroPool({ directory: "/kokoro", size: 1,
    spawnProcess: (executable, args, options) => {
      assert.equal(executable, "/kokoro/venv/bin/python3");
      assert.ok(args[1].endsWith("kokoro-worker.py")); starts++;
      const child = spawn(process.execPath, [fixture], options);
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (data, ...rest) => { jobs.push(JSON.parse(data)); return write(data, ...rest); };
      return child;
    },
  });
  t.after(() => pool.close());
  await pool.synthesize("kokoro-af_heart", "First", "/first.wav");
  await pool.synthesize("kokoro-bm_george", "Second", "/second.wav");
  assert.equal(starts, 1);
  assert.deepEqual(jobs.map(job => job.voice), ["af_heart", "bm_george"]);
});

test("shared TTS route preserves Piper, routes Kokoro, deduplicates and serves cached ranges", async t => {
  const directory = await mkdtemp(join(tmpdir(), "kokoro-api-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  process.env.READING_ROOM_TTS = directory;
  const { createTtsRoute } = await import(`../server/rr-tts.mjs?test=${Date.now()}`);
  const calls = [];
  const pool = engine => ({ synthesize: async (voice, text, out) => {
    calls.push({ engine, voice, text }); await new Promise(r => setTimeout(r, 30));
    await writeFile(out, Buffer.from("RIFF-test-WAVE-audio"));
  } });
  const voices = [{ id: "en_GB-alba-medium", label: "Alba" }, ...kokoroVoices];
  const route = createTtsRoute({ piperPool: pool("piper"), kokoroPool: pool("kokoro"), catalogue: async () => voices });
  const server = createServer((req, res) => { void route(req, res, new URL(req.url, "http://localhost")); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => server.close()); const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual((await (await fetch(base + "/api/tts/voices")).json()).voices, voices);
  const kokoroUrl = base + "/api/tts?v=kokoro-af_heart&t=Hello";
  const responses = await Promise.all([fetch(kokoroUrl, { headers: { "x-home-books-prefetch": "1" } }), fetch(kokoroUrl)]);
  for (const response of responses) { assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "audio/wav"); await response.arrayBuffer(); }
  assert.equal(calls.length, 1); assert.equal(calls[0].engine, "kokoro");
  const range = await fetch(kokoroUrl, { headers: { range: "bytes=0-3" } });
  assert.equal(range.status, 206); assert.equal(await range.text(), "RIFF"); assert.equal(calls.length, 1);
  await (await fetch(base + "/api/tts?v=en_GB-alba-medium&t=Hello")).arrayBuffer();
  assert.equal(calls[1].engine, "piper");
  const invalid = await fetch(base + "/api/tts?v=../../bad&t=Different"); await invalid.arrayBuffer();
  assert.equal(calls[2].voice, "en_GB-alba-medium");
});

test("narration is delivered as MP3 on request, falls back to WAV, and reports voice speed as text", async t => {
  const directory = await mkdtemp(join(tmpdir(), "tts-mp3-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  process.env.READING_ROOM_TTS = directory;
  const { createTtsRoute, voiceSpeed } = await import(`../server/rr-tts.mjs?mp3=${Date.now()}`);
  let synthesized = 0, encoded = 0, broken = false;
  const pool = { synthesize: async (voice, text, out) => { synthesized++; await writeFile(out, Buffer.from("RIFF-test-WAVE-audio")); } };
  const encode = async (wav, mp3) => { encoded++; if (broken) throw new Error("no encoder"); await writeFile(mp3, Buffer.from("ID3-test-mp3")); };
  const route = createTtsRoute({ piperPool: pool, kokoroPool: pool, catalogue: async () => [{ id: "en_US-ryan-high", label: "Ryan" }], encode });
  const server = createServer((req, res) => { void route(req, res, new URL(req.url, "http://localhost")); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => server.close()); const base = `http://127.0.0.1:${server.address().port}`;
  const first = await fetch(base + "/api/tts?v=en_US-ryan-high&t=Hello&f=mp3");
  assert.equal(first.headers.get("content-type"), "audio/mpeg"); assert.equal(await first.text(), "ID3-test-mp3");
  const again = await fetch(base + "/api/tts?v=en_US-ryan-high&t=Hello&f=mp3"); await again.arrayBuffer();
  assert.equal(synthesized, 1); assert.equal(encoded, 1, "the MP3 is made once and reused");
  const plain = await fetch(base + "/api/tts?v=en_US-ryan-high&t=Hello");
  assert.equal(plain.headers.get("content-type"), "audio/wav", "callers that do not ask still get WAV");
  await plain.arrayBuffer();
  broken = true;
  const fallback = await fetch(base + "/api/tts?v=en_US-ryan-high&t=Other&f=mp3");
  assert.equal(fallback.status, 200); assert.equal(fallback.headers.get("content-type"), "audio/wav");
  await fallback.arrayBuffer();
  // The iPhone app decodes the voice list as string fields only.
  assert.equal(voiceSpeed("en_US-ryan-high"), "slow"); assert.equal(voiceSpeed("en_US-hfc_female-medium"), "fast");
  assert.equal(voiceSpeed("kokoro-af_heart"), "steady");
});
