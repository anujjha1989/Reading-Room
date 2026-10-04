#!/bin/bash
# One-time local voice runtime. No new service, public port or hosted API.
# Run as root on the Pi. Optional argument: validated model build directory.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run this installer with sudo." >&2; exit 1; }
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TARGET=/opt/reading-room/kokoro
[ ! -f "$TARGET/READY" ] || { echo "Kokoro is already installed; no files overwritten."; exit 0; }
install -d -m 0755 "$TARGET" "$TARGET/models"
python3 -m venv "$TARGET/venv"
PIP_CONFIG_FILE=/dev/null "$TARGET/venv/bin/python3" -m pip install --isolated --keyring-provider disabled --disable-pip-version-check --index-url https://pypi.org/simple --timeout 20 --retries 2 -r "$SCRIPT_DIR/kokoro-requirements.txt"
if [ -n "${1:-}" ]; then
  [ -f "$1/models.json" ] || { echo "No validated model manifest." >&2; exit 1; }
  for name in models.json kokoro-v1.0.fp16.onnx kokoro-fused.onnx kokoro-int8.onnx voices-v1.0.bin libkokoro_pi_ops.so; do
    install -m 0644 "$1/$name" "$TARGET/models/$name"
  done
else
  OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=2 "$TARGET/venv/bin/kokoro-pi" build --models "$TARGET/models" --threads 2
fi
# Engine verifies the derived files against the manifest and checks synthesis.
OPENBLAS_NUM_THREADS=1 "$TARGET/venv/bin/python3" -c 'from kokoro_pi import Kokoro; k=Kokoro(models="/opt/reading-room/kokoro/models",variant="int8",threads=2); a,r=k.create("Home Books is ready.",voice="af_heart"); assert len(a)>r/4; assert len(k.get_voices())>=28'
chown -R root:root "$TARGET"
chmod -R a+rX "$TARGET"
touch "$TARGET/READY"
chmod 0644 "$TARGET/READY"
echo "Kokoro installed and verified. Existing voices are unchanged."
