"use client";

import React, { useMemo, useState } from "react";
import { Sliders, DollarSign, Share2 } from "lucide-react";

export const CostCrossoverCalculator: React.FC = () => {
  const [monthlyTokens, setMonthlyTokens] = useState(50); // in millions
  const [cloudCostPer1M, setCloudCostPer1M] = useState(2.0);
  const [localFixedCost, setLocalFixedCost] = useState(20000);
  const [localVariableCost, setLocalVariableCost] = useState(0.6);
  const [presentationMode, setPresentationMode] = useState(false);

  const cloudCost = useMemo(
    () => monthlyTokens * cloudCostPer1M * 1_000_000 / 1_000_000,
    [monthlyTokens, cloudCostPer1M],
  );
  const localCost = useMemo(
    () => localFixedCost + monthlyTokens * localVariableCost,
    [localFixedCost, localVariableCost, monthlyTokens],
  );

  const breakevenTokens = useMemo(() => {
    const delta = cloudCostPer1M - localVariableCost;
    if (delta <= 0) return null;
    return Math.round(localFixedCost / delta);
  }, [cloudCostPer1M, localFixedCost, localVariableCost]);

  const verdict = cloudCost > localCost ? "Local wins" : "Cloud wins";
  const summary = `At ${monthlyTokens}M tokens/month, cloud approx $${cloudCost.toFixed(0)} vs local approx $${localCost.toFixed(0)}.`;

  const chartSeries = useMemo(() => {
    const points: Array<{ tokens: number; cloud: number; local: number }> = [];
    const maxTokens = 200;
    for (let i = 0; i <= 10; i += 1) {
      const tokens = (i / 10) * maxTokens;
      const cloud = tokens * cloudCostPer1M;
      const local = localFixedCost + tokens * localVariableCost;
      points.push({ tokens, cloud, local });
    }
    const maxValue = Math.max(...points.map((p) => Math.max(p.cloud, p.local)), 1);
    return { points, maxValue };
  }, [cloudCostPer1M, localFixedCost, localVariableCost]);

  const buildPath = (key: "cloud" | "local") => {
    const width = 220;
    const height = 90;
    return chartSeries.points
      .map((point, idx) => {
        const x = (idx / (chartSeries.points.length - 1)) * width;
        const y = height - (point[key] / chartSeries.maxValue) * height;
        return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  const handleCopy = () => {
    if (!navigator?.clipboard) return;
    const breakevenText = breakevenTokens !== null ? ` Breakeven ~${breakevenTokens}M tokens.` : "";
    void navigator.clipboard.writeText(`${summary}${breakevenText} ${verdict}.`);
  };

  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-content-secondary" />
          <div>
            <div className="text-xs font-bold text-content-muted">Cost Crossover</div>
            <div className="text-sm font-semibold text-content">Live calculator</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPresentationMode((prev) => !prev)}
          className="text-xs text-content-muted hover:text-content"
        >
          {presentationMode ? "Edit" : "Present"}
        </button>
      </div>

      {!presentationMode && (
        <div className="space-y-3 text-xs text-content-secondary">
        <label className="flex items-center justify-between">
          <span>Monthly tokens (M)</span>
          <input
            type="range"
            min={5}
            max={200}
            value={monthlyTokens}
            onChange={(e) => setMonthlyTokens(Number(e.target.value))}
            className="w-40"
          />
          <span className="font-semibold text-content">{monthlyTokens}M</span>
        </label>

        <label className="flex items-center justify-between">
          <span>Cloud $ per 1M</span>
          <input
            type="range"
            min={0.2}
            max={10}
            step={0.1}
            value={cloudCostPer1M}
            onChange={(e) => setCloudCostPer1M(Number(e.target.value))}
            className="w-40"
          />
          <span className="font-semibold text-content">${cloudCostPer1M.toFixed(1)}</span>
        </label>

        <label className="flex items-center justify-between">
          <span>Local fixed / mo</span>
          <input
            type="range"
            min={5000}
            max={80000}
            step={1000}
            value={localFixedCost}
            onChange={(e) => setLocalFixedCost(Number(e.target.value))}
            className="w-40"
          />
          <span className="font-semibold text-content">${localFixedCost.toLocaleString()}</span>
        </label>

        <label className="flex items-center justify-between">
          <span>Local variable / 1M</span>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={localVariableCost}
            onChange={(e) => setLocalVariableCost(Number(e.target.value))}
            className="w-40"
          />
          <span className="font-semibold text-content">${localVariableCost.toFixed(1)}</span>
        </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs text-content-secondary">
        <div className="rounded-md border border-edge bg-surface-secondary p-3">
          <div className="text-xs text-content-muted flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> Cloud
          </div>
          <div className="text-lg font-semibold text-content">${cloudCost.toFixed(0)}</div>
        </div>
        <div className="rounded-md border border-edge bg-surface-secondary p-3">
          <div className="text-xs text-content-muted flex items-center gap-1">
            <DollarSign className="w-3 h-3" /> Local
          </div>
          <div className="text-lg font-semibold text-content">${localCost.toFixed(0)}</div>
        </div>
      </div>

      <div className="rounded-md border border-edge bg-surface p-3">
        <div className="text-xs text-content-muted mb-2">Cost curve</div>
        <svg width={220} height={90} className="w-full">
          <path d={buildPath("cloud")} stroke="#2563eb" strokeWidth={2} fill="none" />
          <path d={buildPath("local")} stroke="#16a34a" strokeWidth={2} fill="none" />
        </svg>
        <div className="mt-2 flex items-center justify-between text-xs text-content-muted">
          <span>0M</span>
          <span>200M</span>
        </div>
      </div>

      <div className="text-xs font-semibold text-content bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-md px-3 py-2">
        Verdict: {verdict}
        {breakevenTokens !== null && (
          <span className="text-content-secondary font-normal"> - Breakeven at ~{breakevenTokens}M tokens</span>
        )}
      </div>

      {presentationMode && (
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center justify-center gap-2 text-xs font-semibold text-content-secondary border border-edge rounded-md px-3 py-2 hover:bg-surface-hover"
        >
          <Share2 className="w-3 h-3" />
          Copy demo summary
        </button>
      )}
    </div>
  );
};

export default CostCrossoverCalculator;
