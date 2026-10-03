"use client";

import { useEffect, useState } from "react";
import { hasNativeSummary, readSummary } from "./nativeBridge";

/** Source-owned native action; also prevents the older wrapper injecting a duplicate. */
export default function BookSummaryAction({ book }: { book: Parameters<typeof readSummary>[0] }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => setAvailable(hasNativeSummary()), []);
  return <div className="availability rr-summary" hidden={!available}>
    <p>Not in the mood for the whole book?</p>
    <div className="file-row"><span><b>Summary</b><small>A detailed summary, written by your selected summary provider</small></span>
      <div><button type="button" onClick={() => readSummary(book)}>Read summary</button></div>
    </div>
  </div>;
}
