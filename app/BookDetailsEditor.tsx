"use client";

import { useEffect, useRef, useState } from "react";

type BookDetails = { id: string; title: string; author?: string };
type Props = {
  book: BookDetails;
  focusDelete: boolean;
  onClose: () => void;
  onSaved: (book: BookDetails) => void;
  onDeleted: (id: string) => void;
};

export default function BookDetailsEditor({ book, focusDelete, onClose, onSaved, onDeleted }: Props) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author || "");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("rr-metafix-open");
    const focus = window.setTimeout(() => (focusDelete ? deleteButton : titleInput).current?.focus(), 40);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(focus);
      document.removeEventListener("keydown", onKey, true);
      document.documentElement.classList.remove("rr-metafix-open");
    };
  }, [focusDelete, onClose]);

  async function submit(action: "save" | "delete") {
    if (busy) return;
    if (action === "delete" && !window.confirm(`Delete "${title || book.id}" from the library?`)) return;
    setBusy(true);
    setStatus(action === "delete" ? "Deleting…" : "Saving…");
    try {
      const response = await fetch(action === "delete" ? "/api/quarantine" : "/api/meta-fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "delete" ? { id: book.id } : { id: book.id, title, author }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `${action} failed (${response.status})`);
      if (action === "delete") onDeleted(book.id);
      else onSaved({ id: book.id, title: result.title, author: result.author });
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save changes");
      setBusy(false);
    }
  }

  return <div id="rr-metafix" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="rr-mf-sheet" role="dialog" aria-modal="true" aria-label="Edit book details">
      <h2>Edit details</h2>
      <label>Title<input ref={titleInput} type="text" autoComplete="off" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Author<input type="text" autoComplete="off" value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
      <p className="rr-mf-note">Saved as a correction, so a rescan will not undo it. Clear a box to go back to the scanned value.</p>
      <div className="rr-mf-row">
        <button type="button" className="rr-mf-cancel" disabled={busy} onClick={onClose}>Cancel</button>
        <button ref={deleteButton} type="button" className="rr-mf-quarantine" disabled={busy} onClick={() => { void submit("delete"); }}>Delete</button>
        <button type="button" className="rr-mf-save" disabled={busy} onClick={() => { void submit("save"); }}>Save</button>
      </div>
      <p className="rr-mf-status" role="status">{status}</p>
    </div>
  </div>;
}
