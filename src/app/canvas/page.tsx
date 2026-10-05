import type { Metadata } from "next";
import { Suspense } from "react";
import { CanvasApp } from "@/components/canvas/CanvasApp";

export const metadata: Metadata = {
  title: "Canvas",
  description: "The shared canvas. Everyone gets one mark.",
};

export default function CanvasPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-wall" />}>
      <CanvasApp />
    </Suspense>
  );
}
