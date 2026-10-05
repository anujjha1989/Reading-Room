import assert from "node:assert/strict";
import test from "node:test";
import { launchBrowser } from "./cdp-browser.mjs";

const BASE_URL = process.env.READING_ROOM_BASE_URL || "http://anujrpi.local:4311";

test("narration startup cuts only at natural phrase boundaries", { timeout: 30_000 }, async () => {
  const browser = await launchBrowser();
  try {
    await browser.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__RR_TTS_TEST_ONLY__ = true",
    });
    await browser.goto(`${BASE_URL}/?narration-chunks=${Date.now()}`);
    await browser.waitFor("!!window.__RR_TTS_TEST_API__", { attempts: 120 });
    const result = await browser.evaluate(`(() => {
      const split = window.__RR_TTS_TEST_API__.startupSplitOffset;
      return {
        uninterrupted: split('A long first sentence that continues beyond the first eighty characters without a natural pause or a full stop near the beginning.', 80),
        phrase: split('This is a complete opening phrase; then the same sentence continues with more words and detail.', 80),
        short: split('Chapter One', 80),
      };
    })()`);
    assert.equal(result.uninterrupted, -1);
    assert.equal(result.phrase, "This is a complete opening phrase; ".length);
    assert.equal(result.short, -1);
  } finally {
    await browser.close();
  }
});

test("hard-wrapped book source never breaks narration inside a sentence", { timeout: 30_000 }, async () => {
  const browser = await launchBrowser();
  try {
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__RR_TTS_TEST_ONLY__ = true" });
    await browser.goto(`${BASE_URL}/?narration-wrap=${Date.now()}`);
    await browser.waitFor("!!window.__RR_TTS_TEST_API__", { attempts: 120 });
    const result = await browser.evaluate(`(() => {
      const chunks = window.__RR_TTS_TEST_API__.speechChunks;
      const wrapped = "Deserted by him and nearly" + String.fromCharCode(10) + "everybody else, she discovers in herself a sense of" + String.fromCharCode(10) + "humor. Fortune presents her a second chance in the form of an impoverished" + String.fromCharCode(10) + "doctor who has elected to work among the" + String.fromCharCode(10) + "needy. Healed by him, she chooses judiciously this time, and is rewarded" + String.fromCharCode(10) + "by reconciliation with her family.";
      const long = "The play, for which she had designed the posters, programs and tickets, constructed the sales booth out of a folding screen tipped on its side, and lined the collection box in red paper, was written by her in a two-day tempest of composition, causing her to miss a breakfast and a lunch.";
      return { wrapped: chunks(wrapped, "en", 220).map(c => c.text), kept: chunks(wrapped, "en", 220, true).length, long: chunks(long, "en", 220).map(c => c.text), offsets: chunks(wrapped, "en", 220).every(c => c.end - c.at === c.text.length) };
    })()`);
    for (const text of result.wrapped) {
      assert.doesNotMatch(text, /\n/, "newlines from the file are spoken as spaces");
      assert.match(text, /[.!?]\s*$/, `clip ends at a sentence end: ${text}`);
    }
    assert.ok(result.kept > result.wrapped.length, "blocks that display their line breaks keep them");
    assert.ok(result.long.length > 1);
    for (const text of result.long.slice(0, -1)) assert.match(text, /[,;:]\s*$/, `a long sentence is cut at a pause: ${text}`);
    assert.equal(result.offsets, true, "highlight offsets are unchanged");
  } finally {
    await browser.close();
  }
});
