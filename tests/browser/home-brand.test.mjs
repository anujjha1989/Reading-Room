import assert from "node:assert/strict";
import test from "node:test";
import { launchBrowser } from "./cdp-browser.mjs";

test("home wordmark stays compact and outlined in both themes", { timeout: 60000 }, async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const exceptions = [];
  browser.on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
  await browser.goto(process.env.READING_ROOM_BASE_URL || "http://anujrpi.local:4311");
  await browser.waitFor(`!!document.querySelector('.rr-library-dock')`);
  await browser.waitFor(`!!document.querySelector('.home-books-mark')`);
  for (const theme of ["light", "dark"]) {
    const result = await browser.evaluate(`(async () => {
      document.documentElement.dataset.rrTheme = '${theme}';
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const title = document.querySelector('.hero h1');
      const icon = title.querySelector('svg');
      const style = getComputedStyle(icon);
      return { text: title.textContent, size: parseFloat(getComputedStyle(title).fontSize),
        fill: style.fill, stroke: style.stroke, width: icon.getBoundingClientRect().width,
        right: title.getBoundingClientRect().right, viewport: innerWidth };
    })()`);
    assert.equal(result.text, "Home Books");
    assert.ok(result.size >= 24 && result.size <= 28);
    assert.equal(result.fill, "none");
    assert.equal(result.width, 32);
    assert.notEqual(result.stroke, "none");
    assert.ok(result.right <= result.viewport);
    await browser.screenshot(`home-brand-${theme}.png`);
  }
  assert.deepEqual(exceptions, [], "initial hydration must not throw");
  await browser.evaluate(`document.querySelector('#rr-settings-link').click()`);
  await browser.waitFor(`!![...document.querySelectorAll('#rr-settings-overlay strong')].find(e => e.textContent === 'About')`);
  assert.equal(await browser.evaluate(`!!document.querySelector('#rr-settings-overlay [role="alert"]')`), false);
});
