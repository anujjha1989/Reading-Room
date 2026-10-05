// Reading Room — narration.
//
// Replaces window.speechSynthesis, which had two problems beyond voice
// quality: on iOS it stops the moment Safari goes to the background or the
// phone locks, so you cannot put the phone in your pocket and listen; and the
// voices are whatever the device ships.
//
// Piper runs locally on the Pi — measured at 5.1x real time for the medium
// voices and 1.34x for lessac-high — so a sentence is ready well before the
// previous one finishes. Output is served as a plain audio file, which means
// the client can use an <audio> element and MediaSession: background
// playback, lock-screen controls, and AirPods transport buttons.
//
// Synthesis is cached on disk, keyed by voice + text, so re-reading a passage
// (or going back a sentence) costs nothing.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createSynthesisQueue } from "./synthesis-queue.mjs";
import { createPiperPool } from "./piper-pool.mjs";
import { createWavCache } from "./wav-cache.mjs";
import { createKokoroPool, installedKokoroVoices } from "./kokoro.mjs";

const PIPER = process.env.READING_ROOM_PIPER || "/opt/piper/piper";
const TTS_DIR = process.env.READING_ROOM_TTS || "/mnt/seagate/ReadingRoom/tts";
const VOICE_DIR = join(TTS_DIR, "voices");
const CACHE_DIR = join(TTS_DIR, "cache");

const FFMPEG = process.env.READING_ROOM_FFMPEG || "/usr/bin/ffmpeg";
const MAX_TEXT = 1200;          // a sentence or two; the client chunks already
const MAX_CONCURRENT = 2;       // leave the Pi some room for serving books

const synthesis = createSynthesisQueue({ concurrency: MAX_CONCURRENT, maxPending: 32 });
// Piper's "high" models already use every core: measured on this Pi 5, two at
// once produced no more audio per second (1.06x real time against 1.16x for
// one) and made each clip take 25 s instead of 11 s. One at a time gets the
// next sentence to the listener in half the time.
const slowSynthesis = createSynthesisQueue({ concurrency: 1, maxPending: 32 });
const queueFor = voice => voice.startsWith("kokoro-") ? kokoroSynthesis : /-high$/.test(voice) ? slowSynthesis : synthesis;

// How fast each voice is on this Pi, as audio seconds per second of work
// (so 1.0 only just keeps up with listening at 1x). Seeded from measurements,
// then kept current from real synthesis. Reported to the reader as a word,
// never a number: the iPhone app decodes the voice list as string fields only.
const pace = new Map();
const seededPace = voice => voice.startsWith("kokoro-") ? 1.6 : /-high$/.test(voice) ? 1.1 : 5;
const sampleRate = voice => voice.startsWith("kokoro-") ? 24000 : 22050;
function notePace(voice, wavBytes, milliseconds) {
  if (!(milliseconds > 200) || !(wavBytes > 44)) return;
  const sample = (wavBytes - 44) / (sampleRate(voice) * 2) / (milliseconds / 1000);
  if (!Number.isFinite(sample) || sample <= 0) return;
  pace.set(voice, (pace.get(voice) ?? seededPace(voice)) * 0.8 + sample * 0.2);
}
export const voiceSpeed = voice => {
  const value = pace.get(voice) ?? seededPace(voice);
  return value >= 3 ? "fast" : value >= 1.4 ? "steady" : "slow";
};

// Narration travels as MP3 when the reader asks for it (f=mp3): about a
// seventh of the WAV, which matters on the public connection. The WAV stays
// the source of truth; a failed or missing encoder just serves the WAV.
function encodeMp3(wav, mp3) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", "-f", "mp3", mp3], { stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)); });
  });
}
const encoding = new Map();
const piper = createPiperPool({ executable: PIPER, voiceDir: VOICE_DIR, size: MAX_CONCURRENT });
// Kokoro's larger model is shared across voices; one process avoids CPU and
// memory contention. It keeps the same priority/deduplication scheduler.
const kokoroSynthesis = createSynthesisQueue({ concurrency: 1, maxPending: 32 });
const kokoro = createKokoroPool({ size: 1 });
const cache = createWavCache(CACHE_DIR);

const json = (response, code, body) => {
  const payload = JSON.stringify(body);
  response.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  }).end(payload);
};

// Voice ids are filenames; never let one escape the voice directory.
const SAFE_VOICE = /^[A-Za-z0-9_-]{1,64}$/;

async function voices() {
  try {
    const names = await readdir(VOICE_DIR);
    return names.filter((n) => n.endsWith(".onnx"))
      .map((n) => n.slice(0, -5))
      .filter((n) => SAFE_VOICE.test(n))
      .sort();
  } catch { return []; }
}

const label = (id) => {
  // en_GB-alba-medium -> "Alba · British English · medium"
  const m = /^([a-z]{2})_([A-Z]{2})-([^-]+)-(.+)$/.exec(id);
  if (!m) return id;
  const langs = { GB: "British English", US: "American English", AU: "Australian English" };
  const name = m[3].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `${name} · ${langs[m[2]] || m[1] + "-" + m[2]} · ${m[4]}`;
};

async function voiceCatalogue() {
  return [...(await voices()).map(id => ({ id, label: label(id) })), ...await installedKokoroVoices()]
    .map(voice => ({ ...voice, speed: voiceSpeed(voice.id) }));
}

export function createTtsRoute({ piperPool = piper, kokoroPool = kokoro, catalogue = voiceCatalogue, encode = encodeMp3 } = {}) {
return async function ttsRoute(request, response, url) {
  if (url.pathname === "/api/tts/voices" && request.method === "GET") {
    json(response, 200, { voices: await catalogue() });
    return true;
  }

  if (url.pathname !== "/api/tts" || request.method !== "GET") return false;

  const text = (url.searchParams.get("t") || "").trim();
  let voice = url.searchParams.get("v") || "";
  if (!text) { json(response, 400, { error: "no text" }); return true; }
  if (text.length > MAX_TEXT) { json(response, 413, { error: "text too long" }); return true; }

  const list = (await catalogue()).map(item => item.id);
  if (!list.length) { json(response, 503, { error: "no voices installed" }); return true; }
  if (!SAFE_VOICE.test(voice) || !list.includes(voice)) voice = list[0];

  const key = createHash("sha1").update(`${voice}\0${text}`).digest("hex");
  const dir = join(CACHE_DIR, voice);
  const wav = join(dir, `${key}.wav`);
  const wantsMp3 = url.searchParams.get("f") === "mp3";
  let file = wav, type = "audio/wav";

  // Make (once) and switch to the MP3 beside a WAV that already exists.
  const useMp3 = async () => {
    if (!wantsMp3) return;
    const mp3 = join(dir, `${key}.mp3`);
    try { await stat(mp3); } catch {
      let job = encoding.get(mp3);
      if (!job) {
        const tmp = join(dir, `.${key}.${process.pid}.${Date.now()}.mp3`);
        job = encode(wav, tmp).then(() => rename(tmp, mp3)).then(async () => { cache.wrote((await stat(mp3)).size); })
          .catch(async error => { try { await unlink(tmp); } catch {} throw error; })
          .finally(() => encoding.delete(mp3));
        encoding.set(mp3, job);
      }
      try { await job; } catch { return; }       // no encoder: the WAV still plays
    }
    file = mp3; type = "audio/mpeg";
  };

  const send = async () => {
    await stat(wav);
    await useMp3();
    const release = await cache.pin(file);
    let handedOff = false;
    try {
    const info = await stat(file);
    const stream = options => {
      const reader = createReadStream(file, options);
      handedOff = true;
      reader.once("close", release);
      reader.once("error", error => response.destroy(error));
      response.once("close", () => reader.destroy());
      reader.pipe(response);
    };
    // Content-addressed by voice + text, so it can never go stale.
    const base = {
      "content-type": type,
      "cache-control": "public, max-age=31536000, immutable",
      "accept-ranges": "bytes",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || "");
    if (range) {
      let start = range[1] === "" ? null : Number(range[1]);
      let end = range[2] === "" ? null : Number(range[2]);
      if (start === null) {                    // suffix form: bytes=-N
        start = Math.max(0, info.size - (end || 0));
        end = info.size - 1;
      }
      if (end === null || end >= info.size) end = info.size - 1;
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
        response.writeHead(206, {
          ...base,
          "content-length": end - start + 1,
          "content-range": `bytes ${start}-${end}/${info.size}`,
        });
        stream({ start, end });
        return;
      }
      response.writeHead(416, { ...base, "content-range": `bytes */${info.size}` }).end();
      return;
    }
    response.writeHead(200, { ...base, "content-length": info.size });
    stream();
    } finally { if (!handedOff) release(); }
  };

  try { await send(); return true; } catch { /* not cached yet */ }

  // Playback commonly asks for a clip while its prefetch request is still
  // synthesising it. Previously that second request joined the back of the
  // global queue, then generated the same WAV again. With six clips warming,
  // the audio element could sit silent for ten seconds before every sentence.
  // Share the first synthesis promise instead: playback waits only for the
  // work already in progress and never loses priority to later prefetches.
  let lease;
  try {
    lease = queueFor(voice).acquire(key, async () => {
        // The file may have appeared while this job waited for a Piper slot.
        try { await stat(wav); return; } catch {}
        await mkdir(dir, { recursive: true });
        const tmp = join(dir, `.${key}.${process.pid}.${Date.now()}.wav`);
        try {
          const started = Date.now();
          await (voice.startsWith("kokoro-") ? kokoroPool : piperPool).synthesize(voice, text, tmp);
          await rename(tmp, wav);
          const bytes = (await stat(wav)).size;
          notePace(voice, bytes, Date.now() - started);
          cache.wrote(bytes);
        } catch (err) {
          try { await unlink(tmp); } catch {}
          throw err;
        }
    }, request.headers["x-home-books-prefetch"] !== "1");
  } catch {
    response.setHeader("retry-after", "1");
    json(response, 503, { error: "Voice queue is busy. Try again shortly." });
    return true;
  }
  response.once("close", lease.release);
  try {
    await lease.promise;
    if (!response.destroyed) await send();
  } catch {
    if (!response.destroyed && !response.headersSent) json(response, 500, { error: "synthesis failed" });
  } finally {
    response.removeListener("close", lease.release);
    lease.release();
  }
  return true;
};
}

export const ttsRoute = createTtsRoute();
