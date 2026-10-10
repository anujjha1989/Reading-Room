import test from "node:test";
import assert from "node:assert/strict";
import { reliabilityPreview } from "./browser/reliability-preview.mjs";
test("a preview upstream body failure produces one controlled 502", async t => {
  const original = globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch = async()=>({status:200,headers:new Headers({"content-type":"application/epub+zip"}),arrayBuffer:async()=>{throw new Error("Upstream body timed out");}});
  const preview=await reliabilityPreview(); t.after(()=>preview.close());
  const reply=await original(preview.url+"/api/book/test-download");
  assert.equal(reply.status,502);
  assert.equal(await reply.text(),"Preview data unavailable");
});
