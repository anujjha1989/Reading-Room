import assert from "node:assert/strict";
import test from "node:test";
import { launchBrowser } from "./cdp-browser.mjs";

test("reader glass controls have centered vector icons", { timeout: 60000 }, async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  await browser.goto(process.env.READING_ROOM_BASE_URL || "http://anujrpi.local:4311");
  await browser.waitFor(`document.querySelectorAll('.book').length > 0`, { attempts: 120 });
  await browser.evaluate(`(async () => {
    const target = [...document.querySelectorAll('.shelf-book, .book .cover')]
      .find((button) => /William Trevor/i.test(button.getAttribute('title') || button.getAttribute('aria-label') || button.textContent));
    if (!target) throw new Error('Test title unavailable');
    target.click();
    for (let n = 0; n < 80 && !document.querySelector('.reader-shell'); n += 1) {
      const edition = document.querySelector('.rr-edition-list button');
      const read = [...document.querySelectorAll('.modal button')]
        .find((button) => button.textContent.trim() === 'Read here');
      if (edition) edition.click();
      else if (read) read.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })()`);
  await browser.waitFor(`!!document.querySelector('.reader-shell .epub-stage')`, { attempts: 80 });
  await browser.waitFor(`!document.querySelector('.reader-message')`, { attempts: 120 });
  const controls = await browser.evaluate(`(() => {
    const measure = (selector) => {
      const button = document.querySelector(selector);
      const icon = button?.querySelector('svg');
      if (!button || !icon) return null;
      const a = button.getBoundingClientRect(), b = icon.getBoundingClientRect();
      const style = getComputedStyle(button);
      return { size: [a.width, a.height], icon: [b.width, b.height],
        offset: [(b.left + b.width / 2) - (a.left + a.width / 2),
          (b.top + b.height / 2) - (a.top + a.height / 2)],
        surface: style.backgroundImage, blur: style.backdropFilter };
    };
    return { close: measure('.rr-close-btn'), menu: measure('.rr-react-sheet-trigger') };
  })()`);
  await browser.screenshot("reader-glass-light.png");
  for (const [name, control] of Object.entries(controls)) {
    assert.ok(control, `${name} is present`);
    assert.deepEqual(control.size, [46, 46]);
    assert.deepEqual(control.icon, [23, 23]);
    assert.ok(control.offset.every((value) => Math.abs(value) < 0.6), `${name} icon is centered: ${control.offset}`);
    assert.match(control.surface, /linear-gradient/);
    assert.match(control.blur, /blur\(26px\)/);
  }
  await browser.evaluate(`document.querySelector('.rr-react-sheet-trigger').click()`);
  await browser.waitFor(`document.querySelector('.rr-react-sheet-trigger')?.getAttribute('aria-expanded') === 'true'`);
  await browser.evaluate(`(() => {
    const sheet = document.querySelector('section[role="dialog"][data-book-theme]');
    const text = [...sheet.querySelectorAll('button')].find((button) =>
      [...button.querySelectorAll('span')].some((span) => span.textContent.trim() === 'Text'));
    text?.click();
  })()`);
  await browser.waitFor(`!!document.querySelector('section[role="dialog"][data-book-theme] button[title="Dark"]')`);
  await browser.evaluate(`document.querySelector('section[role="dialog"][data-book-theme] button[title="Dark"]').click()`);
  await browser.waitFor(`document.documentElement.classList.contains('rr-reader-dark')`);
  await browser.evaluate(`document.querySelector('.rr-react-sheet-trigger').click()`);
  await browser.waitFor(`document.querySelector('.rr-react-sheet-trigger')?.getAttribute('aria-expanded') === 'false'`);
  const darkControls = await browser.evaluate(`(() =>
    ['.rr-close-btn', '.rr-react-sheet-trigger'].map((selector) => {
      const button = document.querySelector(selector), icon = button.querySelector('svg');
      const a = button.getBoundingClientRect(), b = icon.getBoundingClientRect();
      return { blur: getComputedStyle(button).backdropFilter,
        surface: getComputedStyle(button).backgroundImage,
        offset: [(b.left + b.width / 2) - (a.left + a.width / 2),
          (b.top + b.height / 2) - (a.top + a.height / 2)] };
    }))()`);
  for (const control of darkControls) {
    assert.match(control.blur, /blur\(26px\)/);
    assert.match(control.surface, /linear-gradient/);
    assert.ok(control.offset.every((value) => Math.abs(value) < 0.6));
  }
  await browser.screenshot("reader-glass-dark.png");
});
