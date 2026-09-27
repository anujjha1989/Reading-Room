import { createElement as h } from "react";

import { BOOK_OUTLINE } from "./bookBrand.js";

export default function HomeBooksMark() {
  return h("svg", { className: "home-books-mark", viewBox: "0 0 32 32", "aria-hidden": "true", fill: "none", stroke: "currentColor", strokeWidth: 1.7 },
    h("path", { d: BOOK_OUTLINE }));
}
