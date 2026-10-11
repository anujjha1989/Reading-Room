// One outline owns the header, favicon and installable app icons.
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { launchBrowser } from "../tests/browser/cdp-browser.mjs";

const master = await readFile(new URL("../assets/branding/book-icon-master.png",import.meta.url));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="Home Books"><image width="256" height="256" href="data:image/png;base64,${master.toString("base64")}"/></svg>`;
const browser = await launchBrowser();
try {
  const icons = [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]
    .map(([name, size]) => [name, size, new URL(`../public/${name}`, import.meta.url)]);
  // Optional native asset destination; do not publish an unused web URL.
  if (process.argv[2]) {
    if (!isAbsolute(process.argv[2])) throw new Error("Native icon destination must be absolute");
    icons.push(["native icon", 1024, process.argv[2]]);
  }
  for (const [name, size, destination] of icons) {
    await browser.send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    const {frameTree}=await browser.send("Page.getFrameTree");
    await browser.send("Page.setDocumentContent",{frameId:frameTree.frame.id,html:`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{width:100%;height:100%;display:block}</style>${svg}`});
    await browser.evaluate(`(async()=>{const image=new Image();image.src=document.querySelector('svg image').getAttribute('href');await image.decode();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
    const { data } = await browser.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(destination, Buffer.from(data, "base64"));
    console.log(`${name}: ${size} × ${size}`);
  }
} finally { await browser.close(); }
// Embed the web-sized rendition, not a second externally fetched SVG image.
const web = (await readFile(new URL("../public/icon-512.png",import.meta.url))).toString("base64");
for(const name of ["home-books-icon.svg","favicon.svg"]) await writeFile(new URL(`../public/${name}`,import.meta.url),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,${web}"/></svg>\n`);
