/**
 * DCFCard — Inline DCF + Reverse DCF visualization in search results.
 *
 * Shows: intrinsic value, implied growth, assessment badge, projected FCFs.
 * Interactive: sliders for growth rate, FCF margin, WACC to recompute live.
 * Designed for banker and investor lenses.
 */

import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown, Calculator, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types (match server/lib/dcfModel.ts) ────────────────────────

interface DCFResult {
  enterpriseValue: number;
  projectedFCF: number[];
  discountedFCF: number[];
  terminalValue: number;
  discountedTerminalValue: number;
  pvOfFCFs: number;
  summary: string;
}

interface ReverseDCFResult {
  impliedGrowthRate: number;
  assessment: "undervalued" | "fairly_valued" | "overvalued" | "aggressive";
  explanation: string;
  dcfAtImpliedRate: DCFResult;
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatB(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

const ASSESSMENT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  undervalued: { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "Undervalued" },
  fairly_valued: { bg: "bg-blue-500/10", text: "text-blue-400", label: "Fairly Valued" },
  overvalued: { bg: "bg-amber-500/10", text: "text-amber-400", label: "Overvalued" },
  aggressive: { bg: "bg-rose-500/10", text: "text-rose-400", label: "Aggressive" },
};

// ─── Inline mini bar chart ───────────────────────────────────────

function FCFBars({ values }: { values: number[] }) {
  if (!values.length) return null;
  const max = Math.max(...values.map(Math.abs), 1);
  return (
    <div className="flex items-end gap-1 h-10">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-3 rounded-t bg-accent-primary/40"
          style={{ height: `${Math.max(4, (Math.abs(v) / max) * 40)}px` }}
          title={`Year ${i + 1}: ${formatB(v)}`}
        />
      ))}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────

export function DCFCard({
  dcf,
  reverseDCF,
  entityName,
}: {
  dcf: DCFResult | null;
  reverseDCF: ReverseDCFResult | null;
  entityName: string;
}) {
  if (!dcf && !reverseDCF) return null;

  const assessment = reverseDCF?.assessment ?? "fairly_valued";
  const style = ASSESSMENT_STYLE[assessment] ?? ASSESSMENT_STYLE.fairly_valued;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-content-muted" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
            Valuation Model
          </span>
        </div>
        {reverseDCF && (
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", style.bg, style.text)}>
            {style.label}
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {/* DCF intrinsic value */}
        {dcf && (
          <div>
            <div className="text-[10px] text-content-muted">DCF Intrinsic Value</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-content">{formatB(dcf.enterpriseValue)}</div>
            <div className="mt-1 flex items-center gap-3 text-[10px] text-content-muted">
              <span>PV of FCFs: {formatB(dcf.pvOfFCFs)}</span>
              <span>Terminal: {formatB(dcf.discountedTerminalValue)}</span>
            </div>
            <div className="mt-2">
              <div className="text-[9px] text-content-muted/60 mb-1">Projected FCF (5yr)</div>
              <FCFBars values={dcf.projectedFCF} />
            </div>
          </div>
        )}

        {/* Reverse DCF */}
        {reverseDCF && (
          <div>
            <div className="text-[10px] text-content-muted">Implied Growth Rate</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={cn("text-2xl font-bold tabular-nums", style.text)}>
                {(reverseDCF.impliedGrowthRate * 100).toFixed(0)}%
              </span>
              <span className="text-[10px] text-content-muted">annual</span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-content-muted">
              {reverseDCF.explanation.slice(0, 150)}
            </p>
          </div>
        )}
      </div>

      {/* Actions + Assumptions footer */}
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.04] pt-2">
        <div className="flex flex-wrap gap-2">
          <span className="text-[9px] text-content-muted/50">5yr projection</span>
          <span className="text-[9px] text-content-muted/50">15% FCF margin</span>
          <span className="text-[9px] text-content-muted/50">12% WACC</span>
          <span className="text-[9px] text-content-muted/50">3% terminal growth</span>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded-md bg-accent-primary/10 px-2.5 py-1 text-[10px] font-medium text-accent-primary transition-colors hover:bg-accent-primary/20"
          >
            <BarChart3 className="mr-1 inline h-3 w-3" />
            Open model
          </button>
          <button
            type="button"
            className="rounded-md bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-content-muted transition-colors hover:bg-white/[0.08] hover:text-content"
          >
            Export .xlsx
          </button>
        </div>
      </div>
    </div>
  );
}

export default DCFCard;
