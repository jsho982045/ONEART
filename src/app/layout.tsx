import type { Metadata, Viewport } from "next";
// Type with an old-master hand: EB Garamond (Garamond's 16th-century faces) to read, IM Fell (the 1670s
// Fell types, ink spread and all) for titles and small caps, La Belle Aurore for notes in the margin, and for
// lettering on the canvas a copperplate signature, Fell italic and Roman inscriptional capitals.
import "@fontsource-variable/eb-garamond";
import "@fontsource-variable/eb-garamond/wght-italic.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@fontsource/im-fell-english-sc/400.css";
import "@fontsource/la-belle-aurore/400.css";
import "@fontsource/mrs-saint-delafield/400.css";
import "@fontsource-variable/cinzel";
import "./globals.css";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "oneart: one canvas for the whole world",
    template: "%s · oneart",
  },
  description: SITE.description,
  openGraph: {
    title: "oneart: one canvas for the whole world",
    description: SITE.description,
    type: "website",
    siteName: SITE.name,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9e5de" },
    { media: "(prefers-color-scheme: dark)", color: "#e9e5de" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
