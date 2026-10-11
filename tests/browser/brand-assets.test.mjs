import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { launchBrowser } from "./cdp-browser.mjs";

test("brand icons use supplied green/gold open-book artwork at every release size", { timeout: 60000 }, async (t) => {
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
    assert.equal(result.background[3],255,file);
    assert.ok(result.background[1]>result.background[0]&&result.background[1]>result.background[2],`${file}: green background`);
    assert.ok(result.page[0]>200&&result.page[1]>190&&result.page[2]>160,`${file}: light book pages`);
  }
  for (const file of ["favicon.svg", "home-books-icon.svg"]) {
    const svg = await readFile(new URL(`../../public/${file}`, import.meta.url), "utf8");
    assert.ok(svg.includes('href="data:image/png;base64,'),file);
    const embedded=svg.match(/base64,([^" ]+)/)[1];
    assert.equal(embedded,(await readFile(new URL("../../public/icon-512.png",import.meta.url))).toString("base64"),file);
  }
});
