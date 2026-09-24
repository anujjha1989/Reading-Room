import type { Metadata } from "next";
import LibraryClient from "./LibraryClient";

export const metadata: Metadata = {
      title: "Home Books",
  description: "A searchable private catalogue of ebooks, graphic novels, and scripts.",
};

export default function Home() {
  return <LibraryClient />;
}
