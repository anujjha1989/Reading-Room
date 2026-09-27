// One outline owns the header, favicon and installable app icons.
import { writeFile } from "node:fs/promises";
import { HOUSE_PATH, BOOK_PAGES } from "../app/bookBrand.js";
import { launchBrowser } from "../tests/browser/cdp-browser.mjs";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="Home Books"><rect width="256" height="256" fill="#080808"/><path d="${HOUSE_PATH}" fill="#f50916"/><path d="${BOOK_PAGES}" fill="#ffffff"/></svg>`;
for (const name of ["home-books-icon.svg", "favicon.svg"]) {
  await writeFile(new URL(`../public/${name}`, import.meta.url), svg + "\n");
}
const browser = await launchBrowser();
try {
  for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-1024.png", 1024], ["apple-touch-icon.png", 180]]) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await browser.goto(`data:text/html,${encodeURIComponent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{width:100%;height:100%;display:block}</style>${svg}`)}`);
    const { data } = await browser.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(new URL(`../public/${name}`, import.meta.url), Buffer.from(data, "base64"));
    console.log(`${name}: ${size} × ${size}`);
  }
} finally { await browser.close(); }
