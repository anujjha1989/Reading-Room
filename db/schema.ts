import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const readingState = sqliteTable("reading_state", {
  userEmail: text("user_email").notNull(),
  bookId: text("book_id").notNull(),
  fileId: text("file_id"),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  lastOpened: integer("last_opened"),
  progressLabel: text("progress_label"),
  position: text("position"),
  status: text("status").notNull().default("unread"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userEmail, table.bookId] })]);
