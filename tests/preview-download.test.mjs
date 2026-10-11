import test from "node:test";
import assert from "node:assert/strict";
import { reliabilityPreview } from "./browser/reliability-preview.mjs";
test("a preview upstream body failure produces one controlled 502", async t => {
  const original = globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch = async()=>({status:200,headers:new Headers({"content-type":"application/epub+zip"}),body:new ReadableStream({start(controller){controller.error(new Error("Upstream body timed out"));}})});
  const preview=await reliabilityPreview(); t.after(()=>preview.close());
  const reply=await original(preview.url+"/api/book/test-download");
  assert.equal(reply.status,502);
  assert.equal(await reply.text(),"Preview data unavailable");
});
test("preview forwards size and streams before the complete archive arrives",async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  let finish;
  globalThis.fetch=async()=>({status:200,headers:new Headers({"content-type":"application/epub+zip","content-length":"6"}),body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode("abc"));finish=()=>{c.enqueue(new TextEncoder().encode("def"));c.close();};}})});
  const preview=await reliabilityPreview();t.after(()=>preview.close());
  const reply=await original(preview.url+"/api/book/test-stream");
  assert.equal(reply.headers.get("content-length"),"6");
  const reader=reply.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value),"abc");
  finish();
  assert.equal(new TextDecoder().decode((await reader.read()).value),"def");
  assert.equal((await reader.read()).done,true);
});
