"use client";

import { useMemo, useState } from "react";
import { generateSplat } from "@/lib/splat";

function mix(seed: number) {
  // Cheap deterministic spread so "page N" gives unrelated seeds.
  return (Math.imul(seed + 1, 2654435761) >>> 0) % 4294967296;
}

export function SplatLab() {
  const [page, setPage] = useState(0);
  const [overlap, setOverlap] = useState(false);

  const seeds = useMemo(() => Array.from({ length: 48 }, (_, i) => mix(page * 48 + i)), [page]);
  const splats = useMemo(() => seeds.map((s) => generateSplat(s)), [seeds]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Splat lab</h1>
      <p className="mt-1 text-graphite">Development only. 48 seeds per page, each drawn at the same scale.</p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button className="btn btn-small" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
          Previous
        </button>
        <button className="btn btn-small" onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
        <button className="btn btn-small" onClick={() => setOverlap((o) => !o)}>
          {overlap ? "Show gallery" : "Show overlap test"}
        </button>
        <span className="self-center text-sm text-graphite">Page {page + 1}</span>
      </div>

      {overlap ? (
        <svg viewBox="-300 -300 600 600" className="mt-6 w-full rounded-[4px] border border-rule bg-wall" role="img" aria-label="Overlapping splats">
          {splats.slice(0, 24).map((s, i) => {
            const angle = i * 2.399963; // golden angle spiral
            const r = 18 * Math.sqrt(i + 1) * 3;
            const cx = Math.cos(angle) * r;
            const cy = Math.sin(angle) * r;
            return (
              <path
                key={s.seed}
                d={s.path}
                fill={s.color}
                transform={`translate(${cx} ${cy}) rotate(${(s.rotation * 180) / Math.PI}) scale(${s.size * 0.5})`}
              />
            );
          })}
        </svg>
      ) : (
        <ul className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {splats.map((s) => (
            <li key={s.seed} className="rounded-[4px] border border-rule bg-wall p-2">
              <svg viewBox="-3 -3 6 6" className="aspect-square w-full" role="img" aria-label={`Splat ${s.seed}`}>
                <path d={s.path} fill={s.color} transform={`rotate(${(s.rotation * 180) / Math.PI})`} />
              </svg>
              <p className="mt-1 truncate text-xs text-graphite">
                {s.seed} · r{Math.round(s.size)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
