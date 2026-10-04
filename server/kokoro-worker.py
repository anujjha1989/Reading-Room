"""Persistent, CPU-bounded Kokoro worker. Stdout is exclusively WAV acknowledgements."""
import json
import os
import sys
from contextlib import redirect_stdout

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

with redirect_stdout(sys.stderr):
    import numpy as np
    import soundfile as sf
    from kokoro_pi import Kokoro


def main():
    directory = sys.argv[1]
    with redirect_stdout(sys.stderr):
        model = Kokoro(models=os.path.join(directory, "models"), variant="int8", threads=2, warm=False)
    for line in sys.stdin:
        job = json.loads(line)
        voice = job["voice"]
        if voice not in model.get_voices() or voice[:1] not in ("a", "b"):
            raise ValueError("Unknown English Kokoro voice")
        with redirect_stdout(sys.stderr):
            samples, rate = model.create(job["text"], voice=voice, lang="en-gb" if voice.startswith("b") else "en-us")
        if len(samples) == 0 or not np.isfinite(samples).all():
            raise ValueError("Voice produced invalid audio")
        sf.write(job["output_file"], samples, rate, format="WAV", subtype="PCM_16")
        print(job["output_file"], flush=True)


if __name__ == "__main__":
    main()
