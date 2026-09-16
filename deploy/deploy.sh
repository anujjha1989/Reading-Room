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
cp dist/settings.html dist/stage/settings.html

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

echo "==> capturing rollback"
# reading-room-deploy is additive for assets (filenames are content hashed), so
# the only files a deploy destroys are the three HTML/JS documents it overwrites.
# Capture them BEFORE the install: afterwards the previous ones are gone.
ROLLBACK=deployment-backups/$(date +%Y%m%d-%H%M%S)-before-v$VERSION
mkdir -p "$ROLLBACK"
"${SSH[@]}" "$PI" "cd /opt/reading-room/current/site && tar czf - index.html \
  \$([ -f sw.js ] && echo sw.js) \$([ -f settings.html ] && echo settings.html)" \
  > "$ROLLBACK/site-html.tar.gz"
cp deploy/reading-room-deploy "$ROLLBACK/reading-room-deploy"
echo "    $ROLLBACK"

rollback() {
  echo "==> ROLLING BACK to the previous release" >&2
  # Restore through the same staging channel the installer already reads, so no
  # new privileged path is introduced. Assets are left alone: they are additive
  # and the old hashed files were never removed.
  "${SSH[@]}" "$PI" "rm -rf ~/rr-deploy/stage && mkdir -p ~/rr-deploy/stage/assets"
  "${SSH[@]}" "$PI" "tar xzf - -C ~/rr-deploy/stage" < "$ROLLBACK/site-html.tar.gz"
  "${SSH[@]}" "$PI" "sudo -n /usr/local/sbin/reading-room-deploy" >&2
  echo "==> rolled back; overrides for v$VERSION remain on disk but are unreferenced" >&2
}

echo "==> installing"
"${SSH[@]}" "$PI" "sudo -n /usr/local/sbin/reading-room-deploy"

# Everything past this point has already changed the live site, so a failure
# must restore the previous documents rather than only abort.
fail() { echo "FAILED: $1" >&2; rollback; exit 1; }

echo "==> verifying"
sleep 3
library_asset=$(grep -o 'LibraryClient-[A-Za-z0-9_-]*\.js' dist/index.html | head -1)
[ -n "$library_asset" ] || fail "no LibraryClient asset in rendered HTML"
for asset_path in / \
  /settings.html \
  /assets/$library_asset \
  /assets/book-art/images/fullscreen-bundle-v$VERSION.js \
  /assets/book-art/images/fullscreen-bundle-v$VERSION.css \
  /assets/book-art/images/read-aloud-v$VERSION.js; do
  headers=$(curl -fsSI "http://anujrpi.local:4311$asset_path") \
    || fail "$asset_path could not be fetched"
  content_type=$(printf '%s\n' "$headers" | awk -F': *' 'tolower($1)=="content-type" {print tolower($2)}' | tr -d '\r')
  case "$asset_path" in
    *.js)  expected='javascript' ;;
    *.css) expected='text/css' ;;
    *)     expected='text/html' ;;
  esac
  printf '  %-58s %s\n' "$asset_path" "$content_type"
  case "$content_type" in
    *"$expected"*) ;;
    *) fail "$asset_path returned $content_type, expected $expected" ;;
  esac
done
served=$("${SSH[@]}" "$PI" "grep -o 'fullscreen-bundle-v[0-9]*' /opt/reading-room/current/site/index.html | head -1")
[ "$served" = "fullscreen-bundle-v$VERSION" ] \
  || fail "live HTML references $served, expected fullscreen-bundle-v$VERSION"

# The version the user actually sees, fetched over HTTP rather than read off
# disk: this is the check that proves the About row reached the device.
settings_version=$(curl -fsS "http://anujrpi.local:4311/settings.html" \
  | sed -n "s/.*title:'Version', value:'\([0-9][0-9]*\)'.*/\1/p" | head -1)
[ "$settings_version" = "$VERSION" ] \
  || fail "settings.html reports version '${settings_version:-none}', expected $VERSION"
printf '  %-58s %s\n' "settings.html About version" "$settings_version"

echo "==> live: $served, settings reports v$settings_version"
