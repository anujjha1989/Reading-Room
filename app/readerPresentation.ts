/** Presentation only: no pagination, anchors, narration or scrolling changes. */
export function prepareBookPresentation(doc: Document, flow: "pages" | "scroll") {
  doc.documentElement.dataset.rrReadingFlow = flow;
  // Some publishers explicitly stretch a single cover image inside an SVG.
  // Correct only these image wrappers, never diagrams or illustrated layouts.
  for (const svg of doc.querySelectorAll('svg[viewBox][preserveAspectRatio="none"]')) {
    if (svg.children.length === 1 && svg.firstElementChild?.localName === "image") {
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }
  }
  if (!doc.getElementById("rr-book-presentation")) {
    const style = doc.createElement("style");
    style.id = "rr-book-presentation";
    style.textContent = `@media (min-width: 1000px) {
      html[data-rr-reading-flow="scroll"] body {
        padding-inline: max(16px, var(--rr-reader-margin, 4%), calc((100vw - 800px) / 2)) !important;
      }
    }`;
    doc.head.appendChild(style);
  }
}
