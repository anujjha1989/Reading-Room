import test from "node:test";
import assert from "node:assert/strict";
import { readerDeadline, readerDownloadTimeout } from "../app/readerDeadline.ts";
test("archive download budgets follow size but never become unbounded", () => {
  assert.equal(readerDownloadTimeout("56118588"), 459000);
  assert.equal(readerDownloadTimeout("1024"), 31000);
  for (const value of [null, "", "garbage", "-1", "Infinity", "0"]) assert.equal(readerDownloadTimeout(value), 120000);
  assert.equal(readerDownloadTimeout("999999999999"), 600000);
});
test("large downloads can outlast the old deadline while parsing stays bounded", async t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  let finish;
  const transfer=readerDeadline(new Promise(resolve=>{finish=resolve;}),new AbortController().signal,readerDownloadTimeout("56118588"));
  t.mock.timers.tick(61000);
  finish("downloaded");
  assert.equal(await transfer,"downloaded");
  const parsing=readerDeadline(new Promise(()=>{}),new AbortController().signal);
  const failed=assert.rejects(parsing,{name:"TimeoutError"});
  t.mock.timers.tick(30001);
  await failed;
});
test("reader deadlines preserve valid values and reject malformed books", async () => {
  const controller = new AbortController();
  assert.equal(await readerDeadline(Promise.resolve("valid"), controller.signal), "valid");
  await assert.rejects(readerDeadline(Promise.reject(new Error("Bad archive")), controller.signal), /Bad archive/);
});
test("a stalled reader cannot leave loading open indefinitely", async () => {
  await assert.rejects(readerDeadline(new Promise(() => {}), new AbortController().signal, 10), /too long/);
});
test("closing the reader cancels pending work", async () => {
  const controller = new AbortController();
  const request = readerDeadline(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
});
