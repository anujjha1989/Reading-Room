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
DEPLOY_HISTORY_DIR=${READING_ROOM_DEPLOY_HISTORY:-/Volumes/Seagate/ReadingRoom/deployment-history}

# Capture source identity before the deployment counter changes. VERSION is a
# tracked deployment counter and is routinely dirty after a successful deploy;
# ignore that one file when deciding whether a tag can honestly describe the
# source that is about to be installed.
PREVIOUS_VERSION=$(cat overrides/VERSION)
DEPLOY_COMMIT=$(git rev-parse HEAD)
DEPLOY_BRANCH=$(git branch --show-current)
SOURCE_CHANGES=$(git status --porcelain --untracked-files=normal | sed '/ overrides\/VERSION$/d')
if [ -z "$SOURCE_CHANGES" ]; then SOURCE_CLEAN=true; else SOURCE_CLEAN=false; fi
if [ "${1:-}" = "--no-build" ]; then DEPLOY_MODE=no-build; else DEPLOY_MODE=full-build; fi

# Each deploy gets a new version. Asset filenames are content hashed, but the
# override bundle is not, and /assets/book-art is served immutable for a year,
# so a new name is the only way a change reaches a phone that has been there.
VERSION=$(( PREVIOUS_VERSION + 1 ))

# Refuse to publish a client that expects new server behaviour through an old
# helper that silently ignores the staged server modules. This preflight turns
# the split-brain v135 failure into an explicit error before build/install.
if ! "${SSH[@]}" "$PI" "grep -q 'SERVER_FILES=' /usr/local/sbin/reading-room-deploy"; then
  echo "FAILED: the Pi deployment helper cannot install server modules." >&2
  echo "        Install deploy/reading-room-deploy on the Pi first." >&2
  exit 1
fi

if [ "${1:-}" != "--no-build" ]; then
  echo "==> building (version $VERSION)"

  # The project lives on an SMB mount. pnpm can't hardlink from its store
  # across filesystems, so node_modules/.bin is never populated there.
  # Build in a local temp dir where hardlinks work, then bring dist/ back.
  BUILD_DIR=$(mktemp -d)
  trap 'rm -rf "$BUILD_DIR"' EXIT
  rsync -a --exclude=node_modules --exclude=dist --exclude='._*' --exclude='.DS_Store' . "$BUILD_DIR/"
  # --yes on both: without it the second npx stops to ask "Ok to proceed?" when
  # it has to fetch pnpm, which makes an otherwise unattended deploy wait for a
  # keypress. The first call already had it; the second was missed.
  (cd "$BUILD_DIR" && npx --yes pnpm@10 install --prefer-offline && npx --yes pnpm@10 run build)
  # Replace the local artifact tree instead of merging it. Merging leaves
  # every historical content-hashed asset in dist/, making each staging upload
  # slower and larger even though the Pi intentionally keeps its old assets.
  rsync -a --delete "$BUILD_DIR/dist/" dist/
fi
# Persist the version after a successful build (or immediately for --no-build).
# render-index.mjs reads this file, while the upload step uses $VERSION; keeping
# the write inside the build branch made --no-build publish HTML for N while
# uploading the override files as N+1.
echo "$VERSION" > overrides/VERSION
node deploy/render-index.mjs

# The build runs from an rsync of this tree into a temp dir, over SMB. Confirm
# the bundle it produced actually contains the app source, rather than trusting
# that the copy was current: a stale rsync produces a clean build of old code,
# which is indistinguishable from success until the app misbehaves.
if [ "${1:-}" != "--no-build" ]; then
  library_bundle=$(grep -o 'LibraryClient-[A-Za-z0-9_-]*\.js' dist/index.html | head -1)
  [ -n "$library_bundle" ] || { echo "FAILED: no LibraryClient in rendered HTML" >&2; exit 1; }
  # A string that only exists in the current app source. Update it when the
  # feature it names is removed.
  if ! grep -q 'reading-room-reader-theme-set' "dist/client/assets/$library_bundle"; then
    echo "FAILED: built bundle does not contain current app source." >&2
    echo "        The build likely ran against a stale rsync of the tree." >&2
    exit 1
  fi
  echo "==> build contains current source"
fi

# Static checks the syntax parser cannot do: a function defined and never
# called is valid JavaScript and silently does nothing, which is how a fix
# shipped four times without taking effect.
node deploy/check-overrides.mjs
node deploy/check-motion.mjs
node deploy/check-contrast.mjs
node deploy/check-reading-sheet.mjs
node deploy/check-sheet-parity.mjs
node deploy/check-popover-motion.mjs
node deploy/check-read-aloud-follow.mjs
node deploy/check-read-aloud-integration.mjs
node deploy/check-panel-return.mjs
node deploy/check-library-chrome.mjs
node deploy/check-reader-consolidation.mjs

echo "==> staging"
rm -rf dist/stage && mkdir -p dist/stage/assets
cp dist/client/assets/*.js dist/client/assets/*.css dist/stage/assets/
cp dist/index.html dist/stage/index.html
cp overrides/sw.js dist/stage/sw.js
cp server/standalone-server.mjs server/rr-settings.mjs server/rr-tts.mjs dist/stage/

echo "==> uploading"
"${SSH[@]}" "$PI" "rm -rf ~/rr-deploy/stage && mkdir -p ~/rr-deploy/stage"
COPYFILE_DISABLE=1 tar czf - -C dist/stage . | "${SSH[@]}" "$PI" "tar xzf - -C ~/rr-deploy/stage"
# macOS tar can still emit AppleDouble sidecars, and ._foo.js matches the
# installer's *.js glob. Belt and braces: never let one reach the site tree.
"${SSH[@]}" "$PI" "find ~/rr-deploy/stage -name '._*' -delete"

echo "==> capturing rollback"
# reading-room-deploy is additive for assets (filenames are content hashed), so
# the only files a deploy destroys are the HTML/JS documents and three server
# modules it overwrites. Capture them BEFORE the install: afterwards the
# previous ones are gone.
#
# Backups live beside the existing before-v64/before-v65 ones, outside the repo:
# they are deployment history, not source, and a repo-relative path would split
# that history across two directories.
ROLLBACK=/Volumes/Seagate/ReadingRoom/deployment-backups/$(date +%Y%m%d-%H%M%S)-before-v$VERSION
mkdir -p "$ROLLBACK"
"${SSH[@]}" "$PI" "tar czf - -C /opt/reading-room/current \
  standalone-server.mjs rr-settings.mjs rr-tts.mjs -C site index.html \
  \$([ -f /opt/reading-room/current/site/sw.js ] && echo sw.js) \
  \$([ -f /opt/reading-room/current/site/settings.html ] && echo settings.html)" \
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
  echo "==> rolled back; overrides for v$VERSION remain on disk but are unreferenced" >&2
}

# Everything past this point can change the live server, so a failure must
# restore the previous release files rather than only abort.
fail() { echo "FAILED: $1" >&2; rollback; exit 1; }

echo "==> installing"
if ! "${SSH[@]}" "$PI" "sudo -n /usr/local/sbin/reading-room-deploy"; then
  fail "installer failed"
fi

# Prove the restarted process received the server sources from this checkout.
# Asset/version checks alone cannot catch a stale rr-tts.mjs or settings route.
for server_file in standalone-server.mjs rr-settings.mjs rr-tts.mjs; do
  local_hash=$(shasum -a 256 "server/$server_file" | awk '{print $1}')
  remote_hash=$("${SSH[@]}" "$PI" "sha256sum /opt/reading-room/current/$server_file | cut -d' ' -f1")
  [ "$local_hash" = "$remote_hash" ] || fail "$server_file did not reach the live release"
done

echo "==> verifying"
sleep 3
library_asset=$(grep -o 'LibraryClient-[A-Za-z0-9_-]*\.js' dist/index.html | head -1)
[ -n "$library_asset" ] || fail "no LibraryClient asset in rendered HTML"

# Check both origins. The LAN one is the shortest path to the server and is
# authoritative: if it passes, the deploy is correct on disk and over HTTP.
#
# The public Tailscale origin is how the phone reaches it, so it is worth
# checking - v68 passed on LAN while the phone was served v67. But it is
# ADVISORY: a failure there can mean this Mac is off the tailnet, or Tailscale
# is down, neither of which is a problem with what we just installed. Rolling
# back a good deploy because a laptop lost its VPN is worse than not checking.
# --max-time keeps a dead endpoint from hanging the deploy for 75s.
verify_origin() {
  local origin=$1 required=$2
  local soft=0
  [ "$required" = "required" ] || soft=1
  echo "  $origin${soft:+ (advisory)}"

  local problem=""
  check() {
    if [ -n "$problem" ]; then return 0; fi
    problem=$1
  }

  for asset_path in / \
    /assets/$library_asset; do
    headers=$(curl -fsSI --max-time 15 "$origin$asset_path") || {
      check "$origin$asset_path could not be fetched"
      break
    }
    content_type=$(printf '%s\n' "$headers" | awk -F': *' 'tolower($1)=="content-type" {print tolower($2)}' | tr -d '\r')
    case "$asset_path" in
      *.js)  expected='javascript' ;;
      *.css) expected='text/css' ;;
      *)     expected='text/html' ;;
    esac
    printf '    %-56s %s\n' "$asset_path" "$content_type"
    case "$content_type" in
      *"$expected"*) ;;
      *) check "$origin$asset_path returned $content_type, expected $expected"; break ;;
    esac
  done

  if [ -z "$problem" ]; then
    # A stale standalone file can still be present on the Pi for rollback.
    # The active server must route old Settings bookmarks into the React app.
    local settings_location
    settings_location=$(curl -fsSI --max-time 15 "$origin/settings.html" \
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
    referenced=$(curl -fsS --max-time 15 "$origin/" | grep -o 'name="rr-app-version" content="[0-9]*"' | head -1) || true
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
  if [ "$soft" = 1 ]; then
    echo "    WARNING: $problem" >&2
    echo "    The LAN checks passed, so the install is good; this origin was not confirmed." >&2
    echo "    Check the tailnet with: tailscale status" >&2
    VERIFY_RESULT=warning
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
verify_origin "https://anujrpi.tail549492.ts.net" advisory
TAILSCALE_RESULT=$VERIFY_RESULT

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
if [ "$SOURCE_CLEAN" = true ]; then
  DEPLOY_TAG="deploy-v$VERSION"
  if git rev-parse -q --verify "refs/tags/$DEPLOY_TAG" >/dev/null; then
    tagged_commit=$(git rev-list -n 1 "$DEPLOY_TAG")
    if [ "$tagged_commit" != "$DEPLOY_COMMIT" ]; then
      echo "    WARNING: $DEPLOY_TAG already points to $tagged_commit; tag not changed" >&2
      DEPLOY_TAG=""
    fi
  elif ! git tag -a "$DEPLOY_TAG" "$DEPLOY_COMMIT" \
    -m "Reading Room deployment v$VERSION"; then
    echo "    WARNING: could not create $DEPLOY_TAG" >&2
    DEPLOY_TAG=""
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
  --library-asset "$library_asset" \
  --lan-result "$LAN_RESULT" \
  --tailscale-result "$TAILSCALE_RESULT" \
  --rollback "$ROLLBACK" \
  --output-dir "$DEPLOY_HISTORY_DIR"; then
  # Documentation must never roll back an otherwise verified, working app.
  echo "    WARNING: deployment succeeded, but its history record could not be written" >&2
fi
