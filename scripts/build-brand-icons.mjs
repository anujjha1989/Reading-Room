// One outline owns the header, favicon and installable app icons.
import { writeFile } from "node:fs/promises";
import { BOOK_OUTLINE } from "../app/bookBrand.js";
import { launchBrowser } from "../tests/browser/cdp-browser.mjs";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Home Books"><rect width="512" height="512" fill="#202123"/><g transform="translate(96 96) scale(10)" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${BOOK_OUTLINE}"/></g></svg>`;
for (const name of ["home-books-icon.svg", "favicon.svg"]) {
  await writeFile(new URL(`../public/${name}`, import.meta.url), svg + "\n");
}
const browser = await launchBrowser();
try {
  for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await browser.goto(`data:text/html,${encodeURIComponent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{width:100%;height:100%;display:block}</style>${svg}`)}`);
    const { data } = await browser.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(new URL(`../public/${name}`, import.meta.url), Buffer.from(data, "base64"));
    console.log(`${name}: ${size} × ${size}`);
  }
} finally { await browser.close(); }
