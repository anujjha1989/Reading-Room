#!/bin/bash
# Build The Reading Room and deploy it to the Pi.
#
#   ./deploy/deploy.sh            build, deploy, verify
#   ./deploy/deploy.sh --no-build use whatever is already in dist/
#
# The build has to run here: the Pi's node is 20.x and vinext needs >= 22.13.
# Everything privileged on the Pi happens in one helper, reading-room-deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

PI=anujjha1989@anujrpi.local
SSH=(ssh -i "$HOME/.ssh/id_ed25519_anujrpi_codex" -o BatchMode=yes -o IdentitiesOnly=yes)
BOOK_ART=/mnt/seagate/ReadingRoom/book-art

# Each deploy gets a new version. Asset filenames are content hashed, but the
# override bundle is not, and /assets/book-art is served immutable for a year,
# so a new name is the only way a change reaches a phone that has been there.
VERSION=$(( $(cat overrides/VERSION) + 1 ))

if [ "${1:-}" != "--no-build" ]; then
  echo "==> building (version $VERSION)"

  # The project lives on an SMB mount. pnpm can't hardlink from its store
  # across filesystems, so node_modules/.bin is never populated there.
  # Build in a local temp dir where hardlinks work, then bring dist/ back.
  BUILD_DIR=$(mktemp -d)
  trap 'rm -rf "$BUILD_DIR"' EXIT
  rsync -a --exclude=node_modules --exclude=dist . "$BUILD_DIR/"
  (cd "$BUILD_DIR" && npx --yes pnpm@10 install --prefer-offline && npx pnpm@10 run build)
  rsync -a "$BUILD_DIR/dist/" dist/
fi
# Persist the version after a successful build (or immediately for --no-build).
# render-index.mjs reads this file, while the upload step uses $VERSION; keeping
# the write inside the build branch made --no-build publish HTML for N while
# uploading the override files as N+1.
echo "$VERSION" > overrides/VERSION
node deploy/render-index.mjs

echo "==> staging"
rm -rf dist/stage && mkdir -p dist/stage/assets
cp dist/client/assets/*.js dist/client/assets/*.css dist/stage/assets/
cp overrides/assets/* dist/stage/assets/
cp dist/index.html dist/stage/index.html
cp overrides/sw.js dist/stage/sw.js

echo "==> uploading"
"${SSH[@]}" "$PI" "rm -rf ~/rr-deploy/stage && mkdir -p ~/rr-deploy/stage"
COPYFILE_DISABLE=1 tar czf - -C dist/stage . | "${SSH[@]}" "$PI" "tar xzf - -C ~/rr-deploy/stage"
# macOS tar can still emit AppleDouble sidecars, and ._foo.js matches the
# installer's *.js glob. Belt and braces: never let one reach the site tree.
"${SSH[@]}" "$PI" "find ~/rr-deploy/stage -name '._*' -delete"

# The override bundle lives on the Seagate, which is symlinked into the site as
# /assets/book-art/images and is the one place there we can write unprivileged.
COPYFILE_DISABLE=1 tar czf - -C overrides/book-art fullscreen-bundle.js fullscreen-bundle.css read-aloud.js \
  | "${SSH[@]}" "$PI" "set -e
      tmp=\$(mktemp -d) && tar xzf - -C \$tmp
      mv \$tmp/fullscreen-bundle.js  $BOOK_ART/fullscreen-bundle-v$VERSION.js
      mv \$tmp/fullscreen-bundle.css $BOOK_ART/fullscreen-bundle-v$VERSION.css
      mv \$tmp/read-aloud.js         $BOOK_ART/read-aloud-v$VERSION.js
      rm -rf \$tmp"

echo "==> installing"
"${SSH[@]}" "$PI" "sudo -n /usr/local/sbin/reading-room-deploy"

echo "==> verifying"
sleep 3
library_asset=$(grep -o 'LibraryClient-[A-Za-z0-9_-]*\.js' dist/index.html | head -1)
[ -n "$library_asset" ] || { echo "FAILED: no LibraryClient asset in rendered HTML" >&2; exit 1; }
for asset_path in / \
  /assets/$library_asset \
  /assets/book-art/images/fullscreen-bundle-v$VERSION.js \
  /assets/book-art/images/fullscreen-bundle-v$VERSION.css \
  /assets/book-art/images/read-aloud-v$VERSION.js; do
  headers=$(curl -fsSI "http://anujrpi.local:4311$asset_path") || {
    echo "FAILED: $asset_path could not be fetched" >&2
    exit 1
  }
  content_type=$(printf '%s\n' "$headers" | awk -F': *' 'tolower($1)=="content-type" {print tolower($2)}' | tr -d '\r')
  case "$asset_path" in
    *.js)  expected='javascript' ;;
    *.css) expected='text/css' ;;
    *)     expected='text/html' ;;
  esac
  printf '  %-58s %s\n' "$asset_path" "$content_type"
  case "$content_type" in
    *"$expected"*) ;;
    *) echo "FAILED: $asset_path returned $content_type, expected $expected" >&2; exit 1 ;;
  esac
done
served=$("${SSH[@]}" "$PI" "grep -o 'fullscreen-bundle-v[0-9]*' /opt/reading-room/current/site/index.html | head -1")
expected="fullscreen-bundle-v$VERSION"
[ "$served" = "$expected" ] || {
  echo "FAILED: live HTML references $served, expected $expected" >&2
  exit 1
}
echo "==> live: $served"
