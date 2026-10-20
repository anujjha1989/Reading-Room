#!/bin/bash
# One explicitly authorised recovery, not a general --no-build path.
# Anuj approved reusing the full-tested v231 candidate on 20 October 2026,
# after installation stopped solely on the quoted-version parser bug.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=231
PREVIOUS_VERSION=230
TEST_SCOPE=full
DEPLOY_MODE=authorised-reuse-full-tested-candidate-installer-fix
DEPLOY_COMMIT=$(git rev-parse 9365d75)
DEPLOY_BRANCH=pi-user-release-tooling
SOURCE_CLEAN=true
BUILD_DIR="$HOME/Library/Caches/home-books-build"
PI=anujjha1989@anujrpi.local
SSH=(ssh -i "$HOME/.ssh/id_ed25519_anujrpi_codex" -o BatchMode=yes -o IdentitiesOnly=yes -o HostKeyAlias=anujrpi.local)
PI_INSTALLER='~/rr-deploy/pi-user-install.sh'
LIVE_DIR=/home/anujjha1989/app-restore/releases/home-books-v230
NEW_DIR=/home/anujjha1989/app-restore/releases/home-books-v231
LAN_ORIGIN=http://anujrpi.local:4311
PUBLIC_ORIGIN=https://anujrpi.tail549492.ts.net
DEPLOY_HISTORY_DIR="$HOME/.home-books/deployment-history"
PI_HISTORY_DIR=/mnt/seagate/ReadingRoom/deployment-history
: "${READING_ROOM_COOKIE_FILE:?Private browser session required}"
: "${READING_ROOM_CURL_COOKIE_FILE:?Private curl session required}"
# Refuse a changed app, dependency, server or build input; only the installer,
# documentation and installer regression test changed since the tested source.
git diff --quiet "$DEPLOY_COMMIT" -- app public server worker patches pnpm-lock.yaml pnpm-workspace.yaml package.json vite.config.ts tsconfig.json postcss.config.mjs ops overrides/sw.js
[ "$(shasum -a 256 "$BUILD_DIR/dist/stage/index.html" | awk '{print $1}')" = 4c2cd349e68ac6b137f622c43224c5e4518035a4003d42a3b23bfa470b9f8ca9 ]
node --input-type=module - "$BUILD_DIR" "$DEPLOY_COMMIT" <<'JS'
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [root,commit]=process.argv.slice(2);
const rows=execFileSync('git',['ls-tree','-r',commit],{encoding:'utf8'}).trim().split('\n');
let count=0;
for(const row of rows){const [,hash,file]=row.match(/^\d+ blob ([a-f0-9]+)\t(.+)$/)||[];if(!file||!(/^(app|public|server|worker|patches|ops)\//.test(file)||/^(pnpm-lock.yaml|pnpm-workspace.yaml|package.json|vite.config.ts|tsconfig.json|postcss.config.mjs)$/.test(file)))continue;
 const data=readFileSync(root+'/'+file),actual=createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');if(actual!==hash)throw Error('Candidate source mismatch: '+file);count++;}
console.log(`Verified ${count} cached source/build inputs against tested source ${commit}`);
JS
node --test tests/pi-user-installer.test.mjs
[ "$("${SSH[@]}" "$PI" 'systemctl --user show -p WorkingDirectory --value home-books')" = "$LIVE_DIR" ]
"${SSH[@]}" "$PI" "cat > $PI_INSTALLER && chmod 0755 $PI_INSTALLER" < deploy/pi-user-install.sh
printf '231\n' > overrides/VERSION
# Continue the canonical installer, rollback, full candidate/live hash, MIME,
# voices, rendered LAN/public checks and provenance recording without copying
# or weakening those gates into another implementation.
canonical_tail=$(sed -n '/^echo "==> rollback point"/,$p' deploy/deploy.sh)
[[ "$canonical_tail" == 'echo "==> rollback point"'* ]]
eval "$canonical_tail"
