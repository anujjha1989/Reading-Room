import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readerDownloadTimeout } from "../../app/readerDeadline.ts";
/** A candidate preview cannot mutate the user's library. Only book/cover GETs
 * reach the Pi; catalogue, settings and saves are intercepted by each test. */
export async function reliabilityPreview() {
  const root = resolve(new URL("../..", import.meta.url).pathname);
  const mime = { ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".html": "text/html" };
  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
      if (path === "/api/library-state") { res.writeHead(200, { "content-type": "application/json" }).end('{"states":[]}'); return; }
      if (path === "/reference-catalog.json") { res.writeHead(200, { "content-type": "application/json" }).end("[]"); return; }
      const file = path === "/" ? resolve(root, "dist/index.html") : path.startsWith("/assets/") ? resolve(root, "dist/client", "." + path) : resolve(root, "public", "." + path);
      if (!file.startsWith(root + "/")) { res.writeHead(403).end(); return; }
      try { const data = await readFile(file); res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" }).end(data); return; } catch {}
      if (path.startsWith("/api/book/") || path === "/api/cover") {
        const upstream = process.env.READING_ROOM_BOOK_ORIGIN || "http://anujrpi.local:4311";
        const controller=new AbortController();
        let timer=setTimeout(()=>controller.abort(),30_000);
        res.on("close",()=>controller.abort());
        try {
          const reply = await fetch(upstream + req.url, { signal: controller.signal });
          clearTimeout(timer);
          timer=setTimeout(()=>controller.abort(),readerDownloadTimeout(reply.headers.get("content-length")));
          if(!reply.body) throw new Error("Missing preview body");
          const reader=reply.body.getReader();
          // Read one chunk before headers so early failures still return 502.
          // Then stream with backpressure, just like the live server, instead
          // of hiding an entire large download behind response headers.
          const first=await reader.read();
          const headers={"content-type":reply.headers.get("content-type")||"application/octet-stream"};
          const length=reply.headers.get("content-length");
          if(length) headers["content-length"]=length;
          res.writeHead(reply.status,headers);
          await pipeline(Readable.from((async function*(){
            if(!first.done) yield first.value;
            while(!first.done){const next=await reader.read();if(next.done)break;yield next.value;}
          })()),res);
        } finally {clearTimeout(timer);controller.abort();}
        return;
      }
      res.writeHead(404).end();
    } catch { if(res.headersSent)res.destroy();else res.writeHead(502).end("Preview data unavailable"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
