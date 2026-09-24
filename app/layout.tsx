import type { Metadata } from "next";
import "./globals.css";
import "./reader-layout.css";
import "./reader-chrome.css";
import "./library-layout.css";

export const metadata: Metadata = {
  title: "Home Books",
  description: "A searchable private catalogue of ebooks, graphic novels, and scripts.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Home Books",
    description: "Every ebook, graphic novel, and script—one clean catalogue.",
    images: [{ url: "/home-books-icon.svg", width: 512, height: 512, alt: "Home Books" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The tiny theme boot script sets data-rr-theme before React hydrates so the
  // first paint never flashes the wrong colour. That intentional client-only
  // attribute is the one permitted hydration difference at the document root.
  return <html lang="en" suppressHydrationWarning><head><meta name="rr-react-library-chrome" content="1" /><link rel="preconnect" href="https://covers.openlibrary.org" /><link rel="preconnect" href="https://openlibrary.org" /></head><body>{children}</body></html>;
}
