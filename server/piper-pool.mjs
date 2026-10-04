import { join } from "node:path";
import { createVoiceWorkerPool } from "./voice-worker-pool.mjs";

/** Piper keeps its existing model-per-voice protocol and pool limits. */
export function createPiperPool({ executable, voiceDir, ...options }) {
  return createVoiceWorkerPool({
    ...options,
    commandForVoice: voice => ({ executable, args: ["--model", join(voiceDir, `${voice}.onnx`), "--json-input", "--quiet"] }),
  });
}
