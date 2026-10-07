import type { Metadata, Viewport } from "next";
import AppLifecycle from "./AppLifecycle";
import "./globals.css";
import "./reader-layout.css";
import "./reader-chrome.css";
import "./library-layout.css";
import "./library-controls.css";
import "./reader-controls.css";

export const metadata: Metadata = {
  title: "Home Books",
  description: "A searchable private catalogue of ebooks, graphic novels, and scripts.",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon-512.png", sizes: "512x512", type: "image/png" }], apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }] },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Home Books", statusBarStyle: "black-translucent" },
  openGraph: {
    title: "Home Books",
    description: "Every ebook, graphic novel, and script—one clean catalogue.",
    images: [{ url: "/home-books-icon.svg", width: 512, height: 512, alt: "Home Books" }],
  },
};
// vinext's ViewportHead currently omits viewportFit. Own this one tag in React
// rather than correcting the generated HTML; suppress its incomplete default.
export const viewport: Viewport = { width: undefined, initialScale: undefined, themeColor: "#000000" };
const themeBoot = `try{var t=localStorage.getItem('reading-room-theme');if(t==='dark'||t==='light')document.documentElement.dataset.rrTheme=t;}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The tiny theme boot script sets data-rr-theme before React hydrates so the
  // first paint never flashes the wrong colour. That intentional client-only
  // attribute is the one permitted hydration difference at the document root.
  return <html lang="en" suppressHydrationWarning><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><meta name="rr-react-library-chrome" content="1" /><script id="rr-theme-boot" dangerouslySetInnerHTML={{ __html: themeBoot }} /><link rel="preconnect" href="https://covers.openlibrary.org" /><link rel="preconnect" href="https://openlibrary.org" /></head><body><AppLifecycle />{children}</body></html>;
}
