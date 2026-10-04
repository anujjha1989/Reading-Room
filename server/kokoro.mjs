import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVoiceWorkerPool } from "./voice-worker-pool.mjs";

export const KOKORO_DIR = process.env.READING_ROOM_KOKORO || "/opt/reading-room/kokoro";
const american = ["af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa"];
const british = ["bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"];
export const kokoroVoices = [...american, ...british].map(voice => ({
  id: `kokoro-${voice}`,
  label: `Kokoro · ${voice.slice(3).replace(/^./, c => c.toUpperCase())} · ${voice[0] === "b" ? "British" : "American"} English`,
}));

export async function installedKokoroVoices(directory = KOKORO_DIR) {
  try {
    await Promise.all(["READY", "venv/bin/python3", "models/models.json", "models/kokoro-int8.onnx", "models/voices-v1.0.bin"].map(name => access(join(directory, name))));
    return kokoroVoices;
  } catch { return []; }
}

export function createKokoroPool({ directory = KOKORO_DIR, ...options } = {}) {
  return createVoiceWorkerPool({
    ...options,
    commandForVoice: () => ({ executable: join(directory, "venv/bin/python3"), args: ["-u", fileURLToPath(new URL("./kokoro-worker.py", import.meta.url)), directory] }),
    modelKey: () => "kokoro-pi-v1.2.0",
    jobInput: (voice, text, out) => ({ voice: voice.replace(/^kokoro-/, ""), text, output_file: out }),
  });
}
