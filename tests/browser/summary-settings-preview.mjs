// Candidate-only preview: no real library, keys, AI calls, or persisted user data.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

export async function summaryPreview({ port = 0, host = "127.0.0.1", catalogRows } = {}) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const snapshot = { active: { id: "A", title: "First test book", author: "Home Books", writer: "This iPhone", status: "Writing…" }, waiting: [
    { id: "B", title: "Second test book", author: "Home Books", writer: "This iPhone", status: "Queued · 1" },
    { id: "C", title: "Third test book", author: "Home Books", writer: "This iPhone", status: "Queued · 2" },
  ], writer: "iphone", claudeAvailable: true };
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://localhost").pathname;
      let json;
      if (path === "/api/app/summaries") {
        if (request.method === "POST") {
          let data = ""; for await (const part of request) data += part;
          const change = JSON.parse(data);
          if (change.action === "remove") snapshot.waiting = snapshot.waiting.filter(item => !change.ids.includes(item.id));
          if (change.action === "clearWaiting") snapshot.waiting = [];
          if (change.action === "stop" && change.id === snapshot.active?.id) snapshot.active = null;
          if (change.action === "writer") snapshot.writer = change.writer;
        }
        json = snapshot;
      } else if (path === "/api/settings/state") json = { sources: [], dropFolder: "", status: { state: "idle" }, gaps: { total: 0, withCover: 0, noCover: 0, noAuthor: 0, poorTitle: 0 }, catalogueModified: null };
      else if (path === "/catalog.json") json = catalogRows || [
        { id: "test-novel-one", title: "A Long Test Novel Title That Wraps Across Lines", author: "Test Author", category: "Fiction", format: "EPUB", source: "Local", url: "/api/book/test-novel-one", modified: "2026-10-01" },
        { id: "test-novel-two", title: "Second Test Novel", author: "Other Author", category: "Fiction", format: "EPUB", source: "Local", url: "/api/book/test-novel-two", modified: "2026-10-02" },
      ];
      else if (path === "/reference-catalog.json") json = [];
      else if (path.startsWith("/api/")) json = {};
      if (json !== undefined) { response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(json)); return; }
      const file = path === "/" ? resolve(root, "dist/index.html") : path.startsWith("/assets/") ? resolve(root, "dist/client", "." + path) : resolve(root, "public", "." + path);
      if (!file.startsWith(root)) { response.writeHead(403); response.end(); return; }
      const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[extname(file)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": type }); response.end(await readFile(file));
    } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(port, host, resolve));
  return { server, snapshot, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const preview = await summaryPreview({ port: 48112, host: "0.0.0.0" });
  console.log(`Summary Settings candidate preview: ${preview.url}`);
}
