#!/bin/bash
# Home Books installer for the restored Pi layout (October 2026 onward).
# Runs on the Pi as the normal user; needs no sudo.
#
#   pi-user-install.sh install VERSION    install ~/rr-deploy/stage as release VERSION
#   pi-user-install.sh rollback DIR       point the service back at an existing release DIR
#   pi-user-install.sh live               print the live release directory
#
# Each release is a complete folder under ~/app-restore/releases. A new release
# starts as a copy of the live one, the staged files are laid over it, and the
# service drop-in release.conf is switched to it. Earlier folders are never
# modified, so rollback only switches release.conf back.
set -euo pipefail
umask 022
ROOT=$HOME/app-restore
RELEASES=$ROOT/releases
STAGE=$HOME/rr-deploy/stage
DROP=$HOME/.config/systemd/user/home-books.service.d/release.conf
NODE=/usr/local/bin/node
SERVICE=home-books
SERVER_FILES=(standalone-server.mjs rr-settings.mjs rr-tts.mjs synthesis-queue.mjs piper-pool.mjs wav-cache.mjs request-guard.mjs voice-worker-pool.mjs kokoro.mjs)
PUBLIC_FILES=(favicon.svg home-books-icon.svg icon-192.png icon-512.png apple-touch-icon.png manifest.webmanifest)

die() { echo "pi-user-install: $*" >&2; exit 1; }
live_dir() { systemctl --user show -p WorkingDirectory --value "$SERVICE"; }

write_drop() {
  local dir=$1
  mkdir -p "$(dirname "$DROP")"
  printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=%s %s/standalone-server.mjs\nEnvironment=READING_ROOM_SITE=%s/site\n' \
    "$dir" "$NODE" "$dir" "$dir" > "$DROP.tmp"
  mv "$DROP.tmp" "$DROP"
}

# Restart and wait until the server is healthy and serving the expected version.
restart_and_wait() {
  local version=$1
  systemctl --user daemon-reload
  systemctl --user restart "$SERVICE"
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 3 http://127.0.0.1:4311/api/health 2>/dev/null | grep -q '"ok":true' \
      && curl -fsS --max-time 5 http://127.0.0.1:4311/ 2>/dev/null | grep -q "name=\"rr-app-version\" content=\"$version\""; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

version_of() { grep -o 'name="rr-app-version" content="[0-9]*"' "$1/site/index.html" | head -1 | sed -E 's/.*content="([0-9]+)"/\1/'; }

# The same candidate checks the old root helper made, so a client is never
# installed alongside a server that is missing a module it depends on.
validate_stage() {
  [ -d "$STAGE/assets" ] || die "no staged assets"
  [ -f "$STAGE/index.html" ] || die "no staged index.html"
  for name in standalone-server.mjs rr-settings.mjs rr-tts.mjs; do
    [ -f "$STAGE/$name" ] || die "incomplete server candidate ($name)"
  done
  if grep -q 'synthesis-queue.mjs' "$STAGE/rr-tts.mjs"; then [ -f "$STAGE/synthesis-queue.mjs" ] || die "missing narration scheduler"; fi
  if grep -q 'request-guard.mjs' "$STAGE/standalone-server.mjs"; then [ -f "$STAGE/request-guard.mjs" ] || die "missing mutation guard"; fi
  if grep -q 'piper-pool.mjs' "$STAGE/rr-tts.mjs"; then [ -f "$STAGE/piper-pool.mjs" ] || die "missing local voice pool"; fi
  if grep -q 'wav-cache.mjs' "$STAGE/rr-tts.mjs"; then [ -f "$STAGE/wav-cache.mjs" ] || die "missing audio-cache housekeeping"; fi
  if [ -f "$STAGE/piper-pool.mjs" ] && grep -q 'voice-worker-pool.mjs' "$STAGE/piper-pool.mjs"; then
    [ -f "$STAGE/voice-worker-pool.mjs" ] || die "missing shared voice pool"
  fi
  if grep -q 'kokoro.mjs' "$STAGE/rr-tts.mjs"; then
    [ -f "$STAGE/kokoro.mjs" ] && [ -f "$STAGE/kokoro-worker.py" ] || die "missing Kokoro engine"
    /usr/bin/python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$STAGE/kokoro-worker.py"
  fi
  for name in "${SERVER_FILES[@]}"; do
    [ ! -f "$STAGE/$name" ] || "$NODE" --check "$STAGE/$name" >/dev/null
  done
  [ ! -f "$STAGE/rr-catalog-rebuild.sh" ] || bash -n "$STAGE/rr-catalog-rebuild.sh"
}

install_release() {
  local version=$1 live new partial backup
  [[ "$version" =~ ^[0-9]+$ ]] || die "version must be a number"
  live=$(live_dir)
  [ -f "$live/standalone-server.mjs" ] && [ -d "$live/site/assets" ] || die "cannot identify the live release ($live)"
  new=$RELEASES/home-books-v$version
  [ ! -e "$new" ] || die "$new already exists; refusing to overwrite a release"
  validate_stage

  backup=$ROOT/release-rollback/$(date +%Y%m%d-%H%M%S)-before-v$version
  mkdir -p "$backup"
  [ ! -f "$DROP" ] || cp -p "$DROP" "$backup/release.conf"
  echo "$live" > "$backup/previous-release"

  # Build the candidate beside the live release, then move it into place.
  partial=$RELEASES/.home-books-v$version.partial
  rm -rf "$partial"
  rsync -a --exclude='tmp*' --exclude='._*' "$live/" "$partial/"
  for name in "${SERVER_FILES[@]}" kokoro-worker.py; do
    [ ! -f "$STAGE/$name" ] || install -m 0644 "$STAGE/$name" "$partial/$name"
  done
  # Hashed assets are additive: phones still holding the old page keep working.
  find "$STAGE/assets" -maxdepth 1 -type f \( -name '*.js' -o -name '*.css' \) ! -name '._*' -exec install -m 0644 -t "$partial/site/assets/" {} +
  install -m 0644 "$STAGE/index.html" "$partial/site/index.html"
  [ ! -f "$STAGE/sw.js" ] || install -m 0644 "$STAGE/sw.js" "$partial/site/sw.js"
  [ ! -f "$STAGE/settings.html" ] || install -m 0644 "$STAGE/settings.html" "$partial/site/settings.html"
  for name in "${PUBLIC_FILES[@]}"; do
    [ ! -f "$STAGE/$name" ] || install -m 0644 "$STAGE/$name" "$partial/site/$name"
  done
  # Scanner tools are kept with the release they shipped in. The restored
  # scanner under ~/app-restore/scanner is not replaced automatically.
  mkdir -p "$partial/ops"
  for name in rr-catalog-rebuild.sh rr-cover-extract.py; do
    [ ! -f "$STAGE/$name" ] || install -m 0755 "$STAGE/$name" "$partial/ops/$name"
  done
  find "$partial" -name '._*' -delete
  [ "$(version_of "$partial")" = "$version" ] || die "staged index.html is not version $version"
  mv "$partial" "$new"

  write_drop "$new"
  if restart_and_wait "$version"; then
    ln -sfn "$(basename "$new")" "$RELEASES/current"
    echo "pi-user-install: v$version live from $new (previous: $live; backup: $backup)"
    return 0
  fi
  echo "pi-user-install: v$version did not come up healthy; restoring $live" >&2
  if [ -f "$backup/release.conf" ]; then cp -p "$backup/release.conf" "$DROP"; else write_drop "$live"; fi
  restart_and_wait "$(version_of "$live")" || echo "pi-user-install: WARNING previous release did not confirm healthy" >&2
  exit 1
}

rollback_release() {
  local dir=$1 version
  case "$dir" in "$RELEASES"/home-books-v*) ;; *) die "rollback target must be a release under $RELEASES" ;; esac
  [ -f "$dir/standalone-server.mjs" ] || die "$dir is not a complete release"
  version=$(version_of "$dir")
  write_drop "$dir"
  restart_and_wait "$version" || die "rollback to $dir did not come up healthy"
  ln -sfn "$(basename "$dir")" "$RELEASES/current"
  echo "pi-user-install: rolled back; v$version live from $dir"
}

case "${1:-}" in
  install)  install_release "${2:?version}" ;;
  rollback) rollback_release "${2:?release directory}" ;;
  live)     live_dir ;;
  *) die "usage: pi-user-install.sh install VERSION | rollback DIR | live" ;;
esac
