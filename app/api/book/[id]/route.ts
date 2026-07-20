const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;

const MIME_TYPES: Record<string, string> = {
  EPUB: "application/epub+zip",
  MOBI: "application/x-mobipocket-ebook",
  AZW: "application/vnd.amazon.ebook",
  AZW3: "application/vnd.amazon.ebook",
  KF8: "application/vnd.amazon.ebook",
  PDF: "application/pdf",
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!DRIVE_ID.test(id)) return new Response("Invalid book identifier", { status: 400 });
  const format = new URL(request.url).searchParams.get("format")?.toUpperCase() || "EPUB";
  const mimeType = MIME_TYPES[format] || "application/octet-stream";

  const upstream = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`, {
    redirect: "follow",
    headers: { Accept: `${mimeType}, application/octet-stream` },
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("The book could not be retrieved from Drive", { status: upstream.status || 502 });
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    return new Response("Drive returned a download confirmation page", { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": mimeType,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { status: 200, headers });
}
