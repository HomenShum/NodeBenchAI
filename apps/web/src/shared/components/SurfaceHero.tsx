/**
 * SurfaceHero — Shared hero section for product surfaces.
 * Eliminates 4 copies of the identical 120-char class string.
 */

import { memo, type ReactNode } from "react";

// Product Language Locked — see docs/product/PRODUCT_LANGUAGE_LOCKED.md
// SurfaceHero — Shared hero section for product surfaces.
// Eliminates 4 copies of the identical 120-char class string.

interface SurfaceHeroProps {
  label: string;   // e.g. "NodeBench" — never "AI" or "LLM"
  title: string;   // One clean benefit statement
  subtitle: string; // One sentence, no jargon
  children?: ReactNode;
}

export const SurfaceHero = memo(function SurfaceHero({ label, title, subtitle, children }: SurfaceHeroProps) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)] md:p-6">
      <div className="max-w-3xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">{label}</div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-content md:text-4xl">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-content-muted">{subtitle}</p>
      </div>
      {children}
    </section>
  );
});
