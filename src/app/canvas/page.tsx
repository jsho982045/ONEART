import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Studio } from "@/components/studio/Studio";

export const metadata: Metadata = {
  title: "The canvas",
  description: "Paint on one canvas with the whole world, live.",
};

// The studio handles pinch-zoom itself; the page must never zoom or bounce underneath it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#e9e5de",
};

export default function CanvasPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#ddd7cd]" />}>
      <Studio />
    </Suspense>
  );
}
