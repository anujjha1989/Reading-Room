const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!DRIVE_ID.test(id)) return new Response("Invalid book identifier", { status: 400 });

  const upstream = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`, {
    redirect: "follow",
    headers: { Accept: "application/epub+zip, application/octet-stream" },
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("The book could not be retrieved from Drive", { status: upstream.status || 502 });
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    return new Response("Drive returned a download confirmation page", { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": "application/epub+zip",
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { status: 200, headers });
}
