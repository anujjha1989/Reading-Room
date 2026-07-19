import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Reading Room",
  description: "A searchable private catalogue of ebooks, graphic novels, and scripts.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "The Reading Room",
    description: "Every ebook, graphic novel, and script—one clean catalogue.",
    images: [{ url: "/reading-room-social.png", width: 1536, height: 1024, alt: "The Reading Room" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
