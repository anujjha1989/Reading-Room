import { desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { readingState } from "../../../db/schema";

export const dynamic = "force-dynamic";

type StateInput = {
  bookId?: string;
  fileId?: string;
  favorite?: boolean;
  lastOpened?: number | null;
  progressLabel?: string;
  position?: string;
  status?: "unread" | "reading" | "finished";
};

function cleanText(value: unknown, limit: number) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ states: [] }, { status: 200 });
  const states = await getDb().select().from(readingState)
    .where(eq(readingState.userEmail, user.email))
    .orderBy(desc(readingState.updatedAt));
  return Response.json({ states });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ saved: false }, { status: 200 });

  let input: StateInput;
  try {
    input = await request.json() as StateInput;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const bookId = cleanText(input.bookId, 160);
  if (!bookId) return Response.json({ error: "Missing book" }, { status: 400 });
  const status = ["unread", "reading", "finished"].includes(input.status || "") ? input.status! : "unread";
  const value = {
    userEmail: user.email,
    bookId,
    fileId: cleanText(input.fileId, 160) || null,
    favorite: Boolean(input.favorite),
    lastOpened: typeof input.lastOpened === "number" ? Math.max(0, Math.floor(input.lastOpened)) : null,
    progressLabel: cleanText(input.progressLabel, 120) || null,
    position: cleanText(input.position, 1000) || null,
    status,
    updatedAt: Date.now(),
  };

  await getDb().insert(readingState).values(value).onConflictDoUpdate({
    target: [readingState.userEmail, readingState.bookId],
    set: {
      fileId: value.fileId,
      favorite: value.favorite,
      lastOpened: value.lastOpened,
      progressLabel: value.progressLabel,
      position: value.position,
      status: value.status,
      updatedAt: value.updatedAt,
    },
  });
  return Response.json({ saved: true });
}
