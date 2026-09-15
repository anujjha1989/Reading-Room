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
  echo "$VERSION" > overrides/VERSION
  npx --yes pnpm@10 run build > /dev/null
fi
node deploy/render-index.mjs

echo "==> staging"
rm -rf dist/stage && mkdir -p dist/stage/assets
cp dist/client/assets/*.js dist/client/assets/*.css dist/stage/assets/
cp overrides/assets/* dist/stage/assets/
cp dist/index.html dist/stage/index.html
cp overrides/sw.js dist/stage/sw.js

echo "==> uploading"
"${SSH[@]}" "$PI" "rm -rf ~/rr-deploy/stage && mkdir -p ~/rr-deploy/stage"
tar czf - -C dist/stage . | "${SSH[@]}" "$PI" "tar xzf - -C ~/rr-deploy/stage"

# The override bundle lives on the Seagate, which is symlinked into the site as
# /assets/book-art/images and is the one place there we can write unprivileged.
tar czf - -C overrides/book-art fullscreen-bundle.js fullscreen-bundle.css read-aloud.js \
  | "${SSH[@]}" "$PI" "set -e
      tmp=\$(mktemp -d) && tar xzf - -C \$tmp
      mv \$tmp/fullscreen-bundle.js  $BOOK_ART/fullscreen-bundle-v$VERSION.js
      mv \$tmp/fullscreen-bundle.css $BOOK_ART/fullscreen-bundle-v$VERSION.css
      mv \$tmp/read-aloud.js         $BOOK_ART/read-aloud-v$VERSION.js
      rmdir \$tmp"

echo "==> installing"
"${SSH[@]}" "$PI" "sudo -n /usr/local/sbin/reading-room-deploy"

echo "==> verifying"
sleep 3
for path in / /assets/$(basename dist/client/assets/LibraryClient-*.js) \
            /assets/book-art/images/fullscreen-bundle-v$VERSION.js; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://anujrpi.local:4311$path")
  printf '  %-58s %s\n' "$path" "$code"
  [ "$code" = "200" ] || { echo "FAILED: $path returned $code" >&2; exit 1; }
done
served=$("${SSH[@]}" "$PI" "grep -o 'fullscreen-bundle-v[0-9]*' /opt/reading-room/current/site/index.html | head -1")
echo "==> live: $served"
