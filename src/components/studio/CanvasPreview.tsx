"use client";

import { useEffect, useRef, useState } from "react";
import { getBackend } from "@/lib/backend";
import type { CanvasInfo } from "@/lib/backend/types";
import { StudioEngine } from "@/lib/studio/engine";

/** The live canvas, framed on the wall, for the landing page. Read-only, updates in real time. */
export function CanvasPreview({ onInfo }: { onInfo?: (c: CanvasInfo, painting: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<CanvasInfo | null>(null);
  const cb = useRef(onInfo);
  cb.current = onInfo;

  useEffect(() => {
    let alive = true;
    getBackend()
      .getCanvas()
      .then((c) => alive && setInfo(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!info || !host.current) return;
    let painting = 1;
    const noop = () => {};
    const engine = new StudioEngine(
      host.current,
      getBackend(),
      info,
      {
        status: (s) => {
          if (s.painting !== painting) {
            painting = s.painting;
            cb.current?.(info, painting);
          }
        },
        pick: noop,
        blocked: noop,
        toast: noop,
        placeText: noop,
        colorPicked: noop,
        view: noop,
        sizeStep: noop,
        toolKey: noop,
      },
      { preview: true },
    );
    const desktop = window.matchMedia("(min-width: 1024px)").matches;
    engine.setInsets(desktop ? 0 : 40, desktop ? 0 : 300);
    engine.fit();
    engine.start(null);
    cb.current?.(info, 1);
    return () => engine.destroy();
  }, [info]);

  return <div ref={host} className="absolute inset-0" aria-hidden />;
}
