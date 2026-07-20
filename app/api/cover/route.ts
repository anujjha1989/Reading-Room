const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;

function normalized(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function similarity(left: string, right: string) {
  const a = new Set(normalized(left).split(" ").filter((word) => word.length > 1));
  const b = new Set(normalized(right).split(" ").filter((word) => word.length > 1));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = (params.get("title") || "").slice(0, 180).trim();
  const author = (params.get("author") || "").slice(0, 100).trim();
  const id = params.get("id") || "";
  const format = (params.get("format") || "").toUpperCase();

  if (!title) return new Response("Missing title", { status: 400 });

  if (["PDF", "DOC", "DOCX", "RTF", "TXT", "FDX"].includes(format) && DRIVE_ID.test(id)) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w500`,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  }

  try {
    const query = new URLSearchParams({
      title,
      fields: "title,author_name,cover_i",
      limit: "5",
      lang: "en",
    });
    if (author) query.set("author", author);
    const upstream = await fetch(`https://openlibrary.org/search.json?${query}`, {
      headers: { Accept: "application/json", "User-Agent": "TheReadingRoom/1.0" },
    });
    if (upstream.ok) {
      const payload = await upstream.json() as { docs?: Array<{ title?: string; author_name?: string[]; cover_i?: number }> };
      const match = payload.docs?.filter((item) => item.cover_i).sort((a, b) => {
        const score = (item: typeof a) => similarity(title, item.title || "") + (author ? similarity(author, item.author_name?.join(" ") || "") * .35 : 0);
        return score(b) - score(a);
      })[0];
      if (match?.cover_i && similarity(title, match.title || "") >= .62) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: `https://covers.openlibrary.org/b/id/${match.cover_i}-M.jpg`,
            "Cache-Control": "public, max-age=604800, stale-while-revalidate=2592000",
          },
        });
      }
    }
  } catch {
    // A cover is optional; the card's typographic cover remains available.
  }

  return new Response("Cover unavailable", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
}
