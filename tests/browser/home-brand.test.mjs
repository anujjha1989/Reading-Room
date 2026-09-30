import assert from "node:assert/strict";
import test from "node:test";
import { launchBrowser } from "./cdp-browser.mjs";

test("home BOOKS wordmark stays compact and contrasting in both themes", { timeout: 60000 }, async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const exceptions = [];
  browser.on("Runtime.exceptionThrown", ({ exceptionDetails }) => exceptions.push(exceptionDetails.text));
  await browser.goto(process.env.READING_ROOM_BASE_URL || "http://anujrpi.local:4311");
  await browser.waitFor(`!!document.querySelector('.rr-library-dock')`);
  await browser.waitFor(`!!document.querySelector('.home-books-mark')`);
  await browser.waitFor(`document.documentElement.scrollHeight > innerHeight + 500`);
  for (const theme of ["light", "dark"]) {
    const result = await browser.evaluate(`(async () => {
      document.documentElement.dataset.rrTheme = '${theme}';
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const title = document.querySelector('.hero h1');
      const icon = title.querySelector('svg');
      const style = getComputedStyle(icon);
      return { text: title.textContent, size: parseFloat(getComputedStyle(title).fontSize),
        color: getComputedStyle(title).color, paper: getComputedStyle(document.body).backgroundColor, width: icon.getBoundingClientRect().width,
        right: title.getBoundingClientRect().right, viewport: innerWidth };
    })()`);
    assert.equal(result.text, "BOOKS");
    assert.ok(result.size >= 24 && result.size <= 28);
    assert.equal(result.width, 40);
    assert.notEqual(result.color, result.paper);
    assert.ok(result.right <= result.viewport);
    await browser.evaluate(`window.scrollTo(0, 500)`);
    await browser.waitFor(`document.documentElement.classList.contains('rr-header-scrolled')`);
    const frosted = await browser.evaluate(`(() => {
      const header = document.querySelector('main > .hero');
      const gear = document.querySelector('#rr-settings-link');
      return { background: getComputedStyle(header).backgroundColor,
        blur: getComputedStyle(header).backdropFilter,
        buttonBlur: getComputedStyle(gear).backdropFilter,
        buttonColor: getComputedStyle(gear).color };
    })()`);
    assert.match(frosted.background, /(?:rgba|color\()/);
    assert.match(frosted.blur, /blur\(22px\)/);
    assert.match(frosted.buttonBlur, /blur\(18px\)/);
    assert.notEqual(frosted.buttonColor, frosted.background);
    await browser.screenshot(`home-brand-scrolled-${theme}.png`);
    await browser.evaluate(`window.scrollTo(0, 0)`);
    await browser.waitFor(`!document.documentElement.classList.contains('rr-header-scrolled')`);
    await browser.screenshot(`home-brand-${theme}.png`);
  }
  assert.deepEqual(exceptions, [], "initial hydration must not throw");
  await browser.evaluate(`document.querySelector('#rr-settings-link').click()`);
  await browser.waitFor(`!![...document.querySelectorAll('#rr-settings-overlay strong')].find(e => e.textContent === 'About')`);
  assert.equal(await browser.evaluate(`!!document.querySelector('#rr-settings-overlay [role="alert"]')`), false);
});
