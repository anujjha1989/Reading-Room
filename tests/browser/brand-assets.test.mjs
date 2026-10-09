import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { launchBrowser } from "./cdp-browser.mjs";
import { APP_ICON_TRANSFORM, ICON_WHITE } from "../../app/bookBrand.js";

test("brand icons retain geometry and use neutral near-white, not cream or pure white", { timeout: 60000 }, async (t) => {
  assert.equal(ICON_WHITE, "#fafafa");
  assert.equal(APP_ICON_TRANSFORM, "translate(128 128) scale(1.024) translate(-127.5 -110.75)");
  const browser = await launchBrowser();
  t.after(() => browser.close());
  // This pixel-only check stays on the browser's blank page; no library origin
  // or authenticated session is needed, even when release cookies are provided.
  await browser.waitFor("document.readyState === 'complete'");
  const files = [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]];
  if (process.env.HOME_BOOKS_NATIVE_ICON) files.push([process.env.HOME_BOOKS_NATIVE_ICON, 1024]);
  for (const [file, size] of files) {
    const path = file.startsWith("/") ? file : new URL(`../../public/${file}`, import.meta.url);
    const data = (await readFile(path)).toString("base64");
    const result = await browser.evaluate(`(async () => {
      const image = new Image(); image.src = 'data:image/png;base64,${data}'; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const pixel = (x, y) => [...ctx.getImageData(Math.floor(x * image.width), Math.floor(y * image.height), 1, 1).data];
      return { width: image.width, height: image.height, background: pixel(0, 0),
        page: pixel(0.35, 0.6), house: pixel(0.5, 0.25) };
    })()`);
    assert.equal(result.width, size, file); assert.equal(result.height, size, file);
    assert.deepEqual(result.background, [250, 250, 250, 255], file);
    assert.deepEqual(result.page, [250, 250, 250, 255], file);
    assert.deepEqual(result.house, [245, 9, 22, 255], file);
  }
  for (const file of ["favicon.svg", "home-books-icon.svg"]) {
    const svg = await readFile(new URL(`../../public/${file}`, import.meta.url), "utf8");
    assert.equal((svg.match(/fill="#fafafa"/g) || []).length, 2, file);
    assert.ok(svg.includes(APP_ICON_TRANSFORM), file);
  }
});
