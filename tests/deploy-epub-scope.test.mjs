import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
test("focused EPUB release remains a fresh build with required live and recovery gates",async()=>{
  const script=await readFile(new URL("../deploy/deploy.sh",import.meta.url),"utf8");
  assert.match(script,/--focus=epub-loading-contrast\) TEST_SCOPE=epub-loading-contrast/);
  assert.match(script,/unknown deployment scope/);
  assert.match(script,/TEST_SCOPE=full/);
  assert.match(script,/DEPLOY_MODE="full-build-\$TEST_SCOPE"/);
  assert.match(script,/pnpm@10 run build/);
  for(const name of ["reader-deadline","reader-toc","preview-download","rendered-html"]) assert.ok(script.includes(`tests/${name}.test.mjs`));
  assert.match(script,/verify_origin "\$LAN_ORIGIN" required/);
  assert.match(script,/verify_origin "\$PUBLIC_ORIGIN" required/);
  assert.match(script,/release-smoke.mjs/);
  assert.match(script,/ROLLING BACK/);
  assert.match(script,/node deploy\/record-deployment.mjs/);
});
