#!/bin/bash
# Build Home Books and deploy it to the Pi.
#
#   ./deploy/deploy.sh            build, deploy, verify
# Every release is rebuilt from the current source; dependencies stay cached.
#
# The build has to run here: the Pi's node is 20.x and vinext needs >= 22.13.
# Everything privileged on the Pi happens in one helper, reading-room-deploy.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--no-build" ]; then
  echo "FAILED: reusing a build without verified source identity is not supported. Run a full deploy." >&2
  exit 1
fi

PI=anujjha1989@anujrpi.local
SSH=(ssh -i "$HOME/.ssh/id_ed25519_anujrpi_codex" -o BatchMode=yes -o IdentitiesOnly=yes)
DEPLOY_HISTORY_DIR=${READING_ROOM_DEPLOY_HISTORY:-/Volumes/Seagate/ReadingRoom/deployment-history}
PUBLIC_ORIGIN=${READING_ROOM_PUBLIC_ORIGIN:-https://anujrpi.tail549492.ts.net}
if [ -z "${READING_ROOM_CURL_COOKIE_FILE:-}" ] || [ ! -f "$READING_ROOM_CURL_COOKIE_FILE" ] || [ -z "${READING_ROOM_COOKIE_FILE:-}" ] || [ ! -f "$READING_ROOM_COOKIE_FILE" ]; then
  echo "FAILED: an authenticated public release check needs private curl and browser session files." >&2
  exit 1
fi
# Catch unavailable authentication/network/browser prerequisites before install.
curl -fsS --max-time 15 --cookie "$READING_ROOM_CURL_COOKIE_FILE" "$PUBLIC_ORIGIN/catalog.json" -o /dev/null
mkdir -p "$DEPLOY_HISTORY_DIR"
HISTORY_PROBE=$(mktemp "$DEPLOY_HISTORY_DIR/.release-check.XXXXXX")
rm "$HISTORY_PROBE"

# Capture source identity before the deployment counter changes. VERSION is a
# tracked deployment counter and is routinely dirty after a successful deploy;
# ignore that one file when deciding whether a tag can honestly describe the
# source that is about to be installed.
SOURCE_VERSION=$(cat overrides/VERSION)
# A failed pre-install run may already have advanced the source counter. Rollback
# must verify the version captured from the live release, not that counter.
PREVIOUS_VERSION=$(curl -fsS --max-time 15 http://anujrpi.local:4311/ | sed -n 's/.*name="rr-app-version" content="\([0-9]*\)".*/\1/p' | head -1)
[[ "$PREVIOUS_VERSION" =~ ^[0-9]+$ ]] || { echo "FAILED: cannot identify the live rollback version" >&2; exit 1; }
DEPLOY_COMMIT=$(git rev-parse HEAD)
DEPLOY_BRANCH=$(git branch --show-current)
SOURCE_CHANGES=$(git status --porcelain --untracked-files=normal | sed '/ overrides\/VERSION$/d')
if [ -z "$SOURCE_CHANGES" ]; then SOURCE_CLEAN=true; else SOURCE_CLEAN=false; fi
if [ "$SOURCE_CLEAN" != true ]; then
  echo "FAILED: commit the complete reviewed candidate before deployment." >&2
  exit 1
fi
DEPLOY_MODE=full-build

# Each deploy gets a new version. Asset filenames are content hashed, but the
# override bundle is not, and /assets/book-art is served immutable for a year,
# so a new name is the only way a change reaches a phone that has been there.
VERSION=$(( (SOURCE_VERSION > PREVIOUS_VERSION ? SOURCE_VERSION : PREVIOUS_VERSION) + 1 ))

# Refuse to publish a client that expects new server behaviour through an old
# helper that silently ignores the staged server modules. This preflight turns
# the split-brain v135 failure into an explicit error before build/install.
if ! "${SSH[@]}" "$PI" "grep -q 'SERVER_FILES=' /usr/local/sbin/reading-room-deploy"; then
  echo "FAILED: the Pi deployment helper cannot install server modules." >&2
  echo "        Install deploy/reading-room-deploy on the Pi first." >&2
  exit 1
fi
if ! "${SSH[@]}" "$PI" "grep -q 'PUBLIC_FILES=' /usr/local/sbin/reading-room-deploy"; then
  echo "FAILED: the Pi deployment helper cannot install public branding assets." >&2
  echo "        Install deploy/reading-room-deploy on the Pi first." >&2
  exit 1
fi
if ! "${SSH[@]}" "$PI" "grep -q 'SERVER_FILES=.*piper-pool.mjs.*wav-cache.mjs.*request-guard.mjs' /usr/local/sbin/reading-room-deploy"; then
  echo "FAILED: install the current helper before releasing the narration scheduler." >&2
  exit 1
fi
if ! "${SSH[@]}" "$PI" "grep -q 'SERVER_FILES=.*voice-worker-pool.mjs.*kokoro.mjs' /usr/local/sbin/reading-room-deploy"; then
  echo "FAILED: install the current helper before releasing additional voice engines." >&2
  exit 1
fi

# Build and stage on the Mac SSD. The repo lives on an SMB mount, where many
if ! "${SSH[@]}" "$PI" "grep -q 'STAGE/rr-catalog-rebuild.sh' /usr/local/sbin/reading-room-deploy"; then
  echo "FAILED: install the current deployment helper before releasing scanner changes." >&2
  exit 1
fi

# Build and stage on the Mac SSD. The repo lives on an SMB mount, where many
# small generated-file writes dominate release time. Only source is synced;
# node_modules and dist stay local between releases.
BUILD_DIR="${HOME}/Library/Caches/home-books-build"
mkdir -p "$BUILD_DIR"
rsync -a --delete --exclude=node_modules --exclude=dist --exclude=.git \
  --exclude='._*' --exclude='.DS_Store' . "$BUILD_DIR/"

if [ "${1:-}" != "--no-build" ]; then
  echo "==> building (version $VERSION)"
  (cd "$BUILD_DIR" && npx --yes pnpm@10 install --prefer-offline --frozen-lockfile \
    && ./node_modules/.bin/tsc --noEmit \
    && npx --yes pnpm@10 run build \
    && node --experimental-loader ./tests/cloudflare-loader.mjs --test tests/*.test.mjs)
else
  [ -f "$BUILD_DIR/dist/server/__vite_rsc_assets_manifest.js" ] || {
    echo "FAILED: no cached build for --no-build; run a full deploy first" >&2
    exit 1
  }
fi
# Persist the version after a successful build (or immediately for --no-build).
# render-index.mjs reads this file, while the upload step uses $VERSION; keeping
# the write inside the build branch made --no-build publish HTML for N while
# uploading the override files as N+1.
echo "$VERSION" > overrides/VERSION
echo "$VERSION" > "$BUILD_DIR/overrides/VERSION"
(cd "$BUILD_DIR" && node deploy/render-index.mjs)

# The build runs from an rsync of this tree into a temp dir, over SMB. Confirm
# the bundle it produced actually contains the app source, rather than trusting
# that the copy was current: a stale rsync produces a clean build of old code,
# which is indistinguishable from success until the app misbehaves.
if [ "${1:-}" != "--no-build" ]; then
  library_bundle=$(grep -o 'LibraryClient-[A-Za-z0-9_-]*\.js' "$BUILD_DIR/dist/index.html" | head -1)
  [ -n "$library_bundle" ] || { echo "FAILED: no LibraryClient in rendered HTML" >&2; exit 1; }
  # A string that only exists in the current app source. Update it when the
  # feature it names is removed.
  if ! grep -q 'reading-room-reader-theme-set' "$BUILD_DIR/dist/client/assets/$library_bundle"; then
    echo "FAILED: built bundle does not contain current app source." >&2
    echo "        The build likely ran against a stale rsync of the tree." >&2
    exit 1
  fi
  echo "==> build contains current source"
fi

# Static checks the syntax parser cannot do: a function defined and never
# called is valid JavaScript and silently does nothing, which is how a fix
# shipped four times without taking effect.
(cd "$BUILD_DIR" &&
  node deploy/check-overrides.mjs &&
  node deploy/check-motion.mjs &&
  node deploy/check-contrast.mjs &&
  node deploy/check-reading-sheet.mjs &&
  node deploy/check-sheet-parity.mjs &&
  node deploy/check-popover-motion.mjs &&
  node deploy/check-read-aloud-follow.mjs &&
  node deploy/check-read-aloud-integration.mjs &&
  node deploy/check-library-chrome.mjs &&
  node deploy/check-reader-consolidation.mjs &&
  node deploy/check-reference-room.mjs &&
  node deploy/check-haptics.mjs)
(cd "$BUILD_DIR" && node --test --test-concurrency=1 tests/browser/reliability.test.mjs tests/browser/mobi-narration.test.mjs tests/browser/shelf-card-layout.test.mjs tests/browser/continuous-scroll.test.mjs tests/browser/reader-controls.test.mjs tests/browser/book-pages.test.mjs tests/browser/narration-position.test.mjs)

echo "==> staging"
rm -rf "$BUILD_DIR/dist/stage" && mkdir -p "$BUILD_DIR/dist/stage/assets"
cp "$BUILD_DIR"/dist/client/assets/*.js "$BUILD_DIR"/dist/client/assets/*.css "$BUILD_DIR/dist/stage/assets/"
cp "$BUILD_DIR/dist/index.html" "$BUILD_DIR/dist/stage/index.html"
cp overrides/sw.js "$BUILD_DIR/dist/stage/sw.js"
PUBLIC_FILES=(favicon.svg home-books-icon.svg icon-192.png icon-512.png apple-touch-icon.png manifest.webmanifest)
for name in "${PUBLIC_FILES[@]}"; do
  cp "public/$name" "$BUILD_DIR/dist/stage/$name"
done
cp server/standalone-server.mjs server/rr-settings.mjs server/rr-tts.mjs server/synthesis-queue.mjs server/piper-pool.mjs server/wav-cache.mjs server/request-guard.mjs "$BUILD_DIR/dist/stage/"
cp server/voice-worker-pool.mjs server/kokoro.mjs server/kokoro-worker.py "$BUILD_DIR/dist/stage/"
cp ops/pi/lib/rr-catalog-rebuild.sh "$BUILD_DIR/dist/stage/"
cp ops/pi/tools/rr-cover-extract.py "$BUILD_DIR/dist/stage/"

echo "==> uploading"
"${SSH[@]}" "$PI" "rm -rf ~/rr-deploy/stage && mkdir -p ~/rr-deploy/stage"
COPYFILE_DISABLE=1 tar czf - -C "$BUILD_DIR/dist/stage" . | "${SSH[@]}" "$PI" "tar xzf - -C ~/rr-deploy/stage"
# macOS tar can still emit AppleDouble sidecars, and ._foo.js matches the
# installer's *.js glob. Belt and braces: never let one reach the site tree.
"${SSH[@]}" "$PI" "find ~/rr-deploy/stage -name '._*' -delete"

echo "==> capturing rollback"
# Preserve the complete current release without dereferencing linked library
# artwork. Also create the flat installer input used for automatic rollback.
#
# Backups live beside the existing before-v64/before-v65 ones, outside the repo:
# they are deployment history, not source, and a repo-relative path would split
# that history across two directories.
ROLLBACK=/Volumes/Seagate/ReadingRoom/deployment-backups/$(date +%Y%m%d-%H%M%S)-before-v$VERSION
mkdir -p "$ROLLBACK"
"${SSH[@]}" "$PI" "tar czf - -C /opt/reading-room/current ." > "$ROLLBACK/complete-release.tar.gz"
gzip -t "$ROLLBACK/complete-release.tar.gz"
"${SSH[@]}" "$PI" "tar czf - -C /opt/reading-room/current \
  standalone-server.mjs rr-settings.mjs rr-tts.mjs \
  \$([ -f /opt/reading-room/current/synthesis-queue.mjs ] && echo synthesis-queue.mjs) \$([ -f /opt/reading-room/current/piper-pool.mjs ] && echo piper-pool.mjs) \$([ -f /opt/reading-room/current/wav-cache.mjs ] && echo wav-cache.mjs) \$([ -f /opt/reading-room/current/request-guard.mjs ] && echo request-guard.mjs) \
  \$(for name in voice-worker-pool.mjs kokoro.mjs kokoro-worker.py; do [ -f /opt/reading-room/current/\$name ] && echo \$name; done) -C site index.html \
  \$([ -f /opt/reading-room/current/site/sw.js ] && echo sw.js) \
  \$([ -f /opt/reading-room/current/site/settings.html ] && echo settings.html) \
  \$(for name in favicon.svg home-books-icon.svg icon-192.png icon-512.png apple-touch-icon.png manifest.webmanifest; do \
      [ -f /opt/reading-room/current/site/\$name ] && echo \$name; \
    done) -C /usr/local/lib/reading-room rr-catalog-rebuild.sh -C /opt/reading-room/tools rr-cover-extract.py" \
  > "$ROLLBACK/site-html.tar.gz"
# cat, not cp: cp on this SMB mount leaves an ._ AppleDouble sidecar behind.
cat deploy/reading-room-deploy > "$ROLLBACK/reading-room-deploy"
echo "    $ROLLBACK"

rollback() {
  echo "==> ROLLING BACK to the previous release" >&2
  # Restore through the same staging channel the installer already reads, so no
  # new privileged path is introduced. Assets are left alone: they are additive
  # and the old hashed files were never removed.
  "${SSH[@]}" "$PI" "rm -rf ~/rr-deploy/stage && mkdir -p ~/rr-deploy/stage/assets"
  "${SSH[@]}" "$PI" "tar xzf - -C ~/rr-deploy/stage" < "$ROLLBACK/site-html.tar.gz"
  "${SSH[@]}" "$PI" "sudo -n /usr/local/sbin/reading-room-deploy" >&2
  echo "$PREVIOUS_VERSION" > overrides/VERSION
  echo "$PREVIOUS_VERSION" > "$BUILD_DIR/overrides/VERSION"
  curl -fsS --max-time 15 "http://anujrpi.local:4311/api/health" | grep -q '"ok":true'
  for origin in "http://anujrpi.local:4311" "$PUBLIC_ORIGIN"; do
    (cd "$BUILD_DIR" && READING_ROOM_BASE_URL="$origin" READING_ROOM_EXPECT_VERSION="$PREVIOUS_VERSION" node deploy/release-smoke.mjs)
  done
  echo "==> rollback verified on both origins; candidate hashed assets remain unreferenced" >&2
}

# Everything past this point can change the live server, so a failure must
# restore the previous release files rather than only abort.
fail() {
  trap - ERR
  echo "FAILED: $1" >&2
  if [ -n "${CREATED_TAG:-}" ]; then git tag -d "$CREATED_TAG" >&2; fi
  rollback
  exit 1
}
trap 'fail "unexpected post-install release failure at line $LINENO"' ERR

echo "==> installing"
if ! "${SSH[@]}" "$PI" "sudo -n /usr/local/sbin/reading-room-deploy"; then
  fail "installer failed"
fi

# Prove the restarted process received the server sources from this checkout.
# Asset/version checks alone cannot catch a stale rr-tts.mjs or settings route.
# Compare every staged browser asset, including lazy reader/worker chunks.
for asset in "$BUILD_DIR"/dist/stage/assets/*; do
  name=$(basename "$asset")
  case "$name" in *[!A-Za-z0-9_.-]*) fail "unexpected candidate asset name" ;; esac
  local_hash=$(shasum -a 256 "$asset" | awk '{print $1}')
  remote_hash=$("${SSH[@]}" "$PI" "sha256sum /opt/reading-room/current/site/assets/$name | cut -d' ' -f1")
  [ "$local_hash" = "$remote_hash" ] || fail "$name did not reach the complete live candidate"
done
for document in index.html sw.js; do
  local_hash=$(shasum -a 256 "$BUILD_DIR/dist/stage/$document" | awk '{print $1}')
  remote_hash=$("${SSH[@]}" "$PI" "sha256sum /opt/reading-room/current/site/$document | cut -d' ' -f1")
  [ "$local_hash" = "$remote_hash" ] || fail "$document did not reach the live candidate"
done
for server_file in standalone-server.mjs rr-settings.mjs rr-tts.mjs synthesis-queue.mjs piper-pool.mjs wav-cache.mjs request-guard.mjs voice-worker-pool.mjs kokoro.mjs kokoro-worker.py; do
  local_hash=$(shasum -a 256 "server/$server_file" | awk '{print $1}')
  remote_hash=$("${SSH[@]}" "$PI" "sha256sum /opt/reading-room/current/$server_file | cut -d' ' -f1")
  [ "$local_hash" = "$remote_hash" ] || fail "$server_file did not reach the live release"
done

local_hash=$(shasum -a 256 ops/pi/lib/rr-catalog-rebuild.sh | awk '{print $1}')
remote_hash=$("${SSH[@]}" "$PI" "sha256sum /usr/local/lib/reading-room/rr-catalog-rebuild.sh | cut -d' ' -f1")
[ "$local_hash" = "$remote_hash" ] || fail "catalogue scanner did not reach the live release"

echo "==> verifying"
sleep 3
library_asset=$(grep -o 'LibraryClient-[A-Za-z0-9_-]*\.js' "$BUILD_DIR/dist/index.html" | head -1)
[ -n "$library_asset" ] || fail "no LibraryClient asset in rendered HTML"

# Check both origins. The LAN one is the shortest path to the server and is
# authoritative: if it passes, the deploy is correct on disk and over HTTP.
#
# The public origin is a required user route. An unavailable check is not proof
# of a successful release and must restore the previous candidate.
# --max-time keeps a dead endpoint from hanging the deploy for 75s.
verify_origin() {
  local origin=$1
  echo "  $origin"

  local problem=""
  check() {
    if [ -n "$problem" ]; then return 0; fi
    problem=$1
  }

  for asset_path in / \
    /assets/$library_asset \
    /favicon.svg /home-books-icon.svg /icon-192.png /icon-512.png \
    /apple-touch-icon.png /manifest.webmanifest; do
    headers=$(curl -fsSI --max-time 15 --cookie "$READING_ROOM_CURL_COOKIE_FILE" "$origin$asset_path") || {
      check "$origin$asset_path could not be fetched"
      break
    }
    content_type=$(printf '%s\n' "$headers" | awk -F': *' 'tolower($1)=="content-type" {print tolower($2)}' | tr -d '\r')
    case "$asset_path" in
      *.js)  expected='javascript' ;;
      *.css) expected='text/css' ;;
      *.svg) expected='image/svg+xml' ;;
      *.png) expected='image/png' ;;
      *.webmanifest) expected='application/manifest+json' ;;
      *)     expected='text/html' ;;
    esac
    printf '    %-56s %s\n' "$asset_path" "$content_type"
    case "$content_type" in
      *"$expected"*) ;;
      *) check "$origin$asset_path returned $content_type, expected $expected"; break ;;
    esac
    case "$asset_path" in
      /favicon.svg|/home-books-icon.svg|/icon-192.png|/icon-512.png|/apple-touch-icon.png|/manifest.webmanifest)
        local expected_hash actual_hash
        expected_hash=$(shasum -a 256 "public/${asset_path#/}" | awk '{print $1}')
        actual_hash=$(curl -fsS --max-time 15 --cookie "$READING_ROOM_CURL_COOKIE_FILE" "$origin$asset_path" | shasum -a 256 | awk '{print $1}') || {
          check "$origin$asset_path could not be downloaded for hash verification"
          break
        }
        [ "$actual_hash" = "$expected_hash" ] || {
          check "$origin$asset_path does not match the source asset"
          break
        }
        ;;
    esac
  done

  if [ -z "$problem" ]; then
    # A stale standalone file can still be present on the Pi for rollback.
    # The active server must route old Settings bookmarks into the React app.
    local settings_location
    settings_location=$(curl -fsSI --max-time 15 --cookie "$READING_ROOM_CURL_COOKIE_FILE" "$origin/settings.html" \
      | awk -F': *' 'tolower($1)=="location" {print $2}' | tr -d '\r') || true
    if [ "$settings_location" = "/" ]; then
      printf '    %-56s %s\n' "legacy Settings bookmark" "redirects to /"
    else
      check "$origin/settings.html redirects to '${settings_location:-nothing}', expected /"
    fi
  fi

  if [ -z "$problem" ]; then
    # The index the browser gets must identify this exact deployed version.
    local referenced
    referenced=$(curl -fsS --max-time 15 --cookie "$READING_ROOM_CURL_COOKIE_FILE" "$origin/" | grep -o 'name="rr-app-version" content="[0-9]*"' | head -1) || true
    if [ "$referenced" = "name=\"rr-app-version\" content=\"$VERSION\"" ]; then
      printf '    %-56s %s\n' "index.html references" "$referenced"
    else
      check "$origin serves HTML referencing ${referenced:-nothing}, expected version $VERSION"
    fi
  fi

  if [ -z "$problem" ]; then
    VERIFY_RESULT=passed
    return 0
  fi
  fail "$problem"
}

# The installer restarts the server after replacing the web client. Prove it
# came back before checking anything it serves.
health=$(curl -fsS --max-time 15 "http://anujrpi.local:4311/api/health" || true)
case "$health" in
  *'"ok":true'*) echo "  server healthy" ;;
  *) fail "server did not come back healthy after install" ;;
esac

verify_origin "http://anujrpi.local:4311" required
LAN_RESULT=$VERIFY_RESULT
verify_origin "$PUBLIC_ORIGIN" required
for origin in "http://anujrpi.local:4311" "$PUBLIC_ORIGIN"; do
  (cd "$BUILD_DIR" && READING_ROOM_BASE_URL="$origin" node deploy/check-local-voices.mjs) \
    || fail "local narration engines failed on $origin"
done
TAILSCALE_RESULT=$VERIFY_RESULT
for origin in "http://anujrpi.local:4311" "$PUBLIC_ORIGIN"; do
  (cd "$BUILD_DIR" && READING_ROOM_BASE_URL="$origin" READING_ROOM_EXPECT_VERSION="$VERSION" node deploy/release-smoke.mjs) \
    || fail "required rendered-route check failed at $origin"
done

served=$("${SSH[@]}" "$PI" "grep -o 'name=\"rr-app-version\" content=\"[0-9]*\"' /opt/reading-room/current/site/index.html | head -1")
[ "$served" = "name=\"rr-app-version\" content=\"$VERSION\"" ] \
  || fail "live HTML references $served, expected version $VERSION"

if [ "$TAILSCALE_RESULT" = "passed" ]; then
  echo "==> live on LAN and Tailscale: $served"
else
  echo "==> live on LAN; Tailscale origin not confirmed from this Mac: $served"
fi

echo "==> recording deployment"
DEPLOY_TAG=""
CREATED_TAG=""
if [ "$SOURCE_CLEAN" = true ]; then
  DEPLOY_TAG="deploy-v$VERSION"
  if git rev-parse -q --verify "refs/tags/$DEPLOY_TAG" >/dev/null; then
    tagged_commit=$(git rev-list -n 1 "$DEPLOY_TAG")
    if [ "$tagged_commit" != "$DEPLOY_COMMIT" ]; then
      fail "$DEPLOY_TAG already points to a different source candidate"
    fi
  elif ! git tag -a "$DEPLOY_TAG" "$DEPLOY_COMMIT" \
    -m "Home Books deployment v$VERSION"; then
    fail "could not create the required source release tag"
  else
    CREATED_TAG="$DEPLOY_TAG"
  fi
else
  echo "    source had uncommitted changes; manifest recorded, Git tag skipped" >&2
fi

if ! node deploy/record-deployment.mjs \
  --version "$VERSION" \
  --previous-version "$PREVIOUS_VERSION" \
  --mode "$DEPLOY_MODE" \
  --commit "$DEPLOY_COMMIT" \
  --branch "${DEPLOY_BRANCH:-detached}" \
  --tag "$DEPLOY_TAG" \
  --source-clean "$SOURCE_CLEAN" \
  --dist-dir "$BUILD_DIR/dist" \
  --library-asset "$library_asset" \
  --lan-result "$LAN_RESULT" \
  --tailscale-result "$TAILSCALE_RESULT" \
  --rollback "$ROLLBACK" \
  --output-dir "$DEPLOY_HISTORY_DIR"; then
  fail "required release provenance could not be written"
fi
trap - ERR
