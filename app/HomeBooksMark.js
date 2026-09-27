import { createElement as h } from "react";

import { HOUSE_PATH, BOOK_PAGES } from "./bookBrand.js";

export default function HomeBooksMark() {
  return h("svg", { className: "home-books-mark", viewBox: "0 0 256 256", "aria-hidden": "true" },
    h("path", { d: HOUSE_PATH, fill: "#f50916" }),
    h("path", { d: BOOK_PAGES, fill: "#ffffff" }));
}
