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
