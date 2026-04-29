/**
 * ModelPicker — interactive dropdown to select the active LLM model.
 *
 * Replaces the static `nb-model-trigger` span in the chat composer.
 * Click opens a panel listing every model in `MODEL_CAPABILITIES`,
 * grouped by provider (Anthropic / OpenAI / Google / xAI / Open weights).
 * Each row shows: provider dot, model id, capability mini-icons.
 *
 * Selection persists to localStorage `nodebench:active-model` so the
 * choice survives page reloads and other surfaces can read it.
 *
 * Pattern:
 *   - Trigger button shows: provider dot + short model name + caret
 *   - Panel: provider-grouped list, hover preview, click to select
 *   - Selection emits `onChange(modelId)` so the host wires it to the
 *     downstream action (e.g. `sendMessageStreaming({ model })`)
 *
 * A11y:
 *   - role="combobox" + aria-expanded on trigger
 *   - role="listbox" on panel, role="option" + aria-selected per row
 *   - Escape closes; arrow keys navigate; click-outside dismisses
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Check, Code2, FileText, Globe, Image as ImageIcon, Mic, Type, Video, Wrench } from "lucide-react";
import { MODEL_CAPABILITIES, type ModelCapability } from "./ModelCapabilityBadge";

const STORAGE_KEY = "nodebench:active-model";
// Default = highest-scoring free model with a CLEAN sweep (no errors)
// on the leaderboard. Nemotron 3 Super 120B scored 3.11/4 with 5 pass
// + 0 errors across 8 queries, vs Gemma 4 26B-A4B's 3.29 score that
// hit 2/8 errors (unreliable). Reliability > peak score for default.
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

export function getActiveModel(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export function setActiveModel(modelId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, modelId);
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

interface ModelMeta {
  id: string;
  display: string;
  provider: "anthropic" | "openai" | "google" | "xai" | "open";
  providerLabel: string;
  tier: "fast" | "balanced" | "reasoning" | "frontier";
  note?: string;
  /**
   * NodeBench leaderboard benchmark snapshot. Source:
   * scripts/eval/model-leaderboard/runs/2026-04-29T17-42-30/leaderboard.json
   * Eval set: 8 representative queries (research / memory / capture /
   * compare / budget / safety×2 / graph). Judge: z-ai/glm-4.5-air:free.
   * `null` for models that haven't been benchmarked yet (paid models).
   */
  benchmark?: {
    rank: number;
    rankAmongFree: number | null;
    avgScore: number; // 0–4
    passes: number;
    partials: number;
    fails: number;
    errors: number;
    avgLatencyMs: number;
    benchmarkedAt: string;
  } | null;
}

/**
 * Benchmark snapshot from leaderboard run 2026-04-29T17-42-30.
 * Source: scripts/eval/model-leaderboard/runs/2026-04-29T17-42-30/leaderboard.json
 * 8 queries · judge=z-ai/glm-4.5-air:free · 16 free models tested
 */
const BENCHMARKED_AT = "2026-04-29";
const REGISTRY: ModelMeta[] = [
  // ── Free OpenRouter — sorted by reliable score (passes weighted high
  //    relative to errors). Default is the top reliable entry. ─────────
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    display: "Nemotron 3 Super 120B",
    provider: "open",
    providerLabel: "Free (OpenRouter)",
    tier: "frontier",
    note: "free · clean sweep · highest reliable score",
    benchmark: { rank: 2, rankAmongFree: 2, avgScore: 3.11, passes: 5, partials: 3, fails: 0, errors: 0, avgLatencyMs: 14473, benchmarkedAt: BENCHMARKED_AT },
  },
  {
    id: "inclusionai/ling-2.6-1t:free",
    display: "Ling 2.6 (1T)",
    provider: "open",
    providerLabel: "Free (OpenRouter)",
    tier: "frontier",
    note: "free · 1T sparse MoE · clean sweep",
    benchmark: { rank: 3, rankAmongFree: 3, avgScore: 3.06, passes: 3, partials: 5, fails: 0, errors: 0, avgLatencyMs: 9102, benchmarkedAt: BENCHMARKED_AT },
  },
  {
    id: "z-ai/glm-4.5-air:free",
    display: "GLM 4.5 Air",
    provider: "open",
    providerLabel: "Free (OpenRouter)",
    tier: "balanced",
    note: "free · 5 passes · clean sweep",
    benchmark: { rank: 4, rankAmongFree: 4, avgScore: 2.92, passes: 5, partials: 3, fails: 0, errors: 0, avgLatencyMs: 15541, benchmarkedAt: BENCHMARKED_AT },
  },
  {
    id: "tencent/hy3-preview:free",
    display: "Hunyuan 3 Preview",
    provider: "open",
    providerLabel: "Free (OpenRouter)",
    tier: "fast",
    note: "free · fastest clean-sweep model · sub-5s avg",
    benchmark: { rank: 5, rankAmongFree: 5, avgScore: 2.83, passes: 3, partials: 5, fails: 0, errors: 0, avgLatencyMs: 4981, benchmarkedAt: BENCHMARKED_AT },
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    display: "Gemma 4 26B-A4B",
    provider: "open",
    providerLabel: "Free (OpenRouter)",
    tier: "balanced",
    note: "free · highest peak score · 2/8 errors (less reliable)",
    benchmark: { rank: 1, rankAmongFree: 1, avgScore: 3.29, passes: 3, partials: 3, fails: 2, errors: 2, avgLatencyMs: 6090, benchmarkedAt: BENCHMARKED_AT },
  },
  // ── Paid OpenRouter (proven in parity-studio repo) ───────────────────
  {
    id: "moonshotai/kimi-k2.6",
    display: "Kimi K2.6",
    provider: "open",
    providerLabel: "Paid (OpenRouter)",
    tier: "frontier",
    note: "paid · ~$0.002/query · 61% on P0 (vs 49% free baseline)",
    benchmark: null, // P0 result is in nodebench-loop, not leaderboard
  },
  // ── Anthropic / OpenAI / Google / xAI (not benchmarked yet) ──────────
  { id: "claude-opus-4-7",   display: "Claude Opus 4.7",   provider: "anthropic", providerLabel: "Anthropic", tier: "frontier",  note: "paid · 1M ctx · best reasoning" },
  { id: "claude-sonnet-4-6", display: "Claude Sonnet 4.6", provider: "anthropic", providerLabel: "Anthropic", tier: "balanced",  note: "paid · fast + capable" },
  { id: "claude-haiku-4-5",  display: "Claude Haiku 4.5",  provider: "anthropic", providerLabel: "Anthropic", tier: "fast",      note: "paid · fastest Anthropic" },
  { id: "gpt-5",             display: "GPT-5",             provider: "openai",    providerLabel: "OpenAI",    tier: "frontier" },
  { id: "gpt-4.1",           display: "GPT-4.1",           provider: "openai",    providerLabel: "OpenAI",    tier: "balanced" },
  { id: "gpt-4o",            display: "GPT-4o",            provider: "openai",    providerLabel: "OpenAI",    tier: "balanced",  note: "audio in/out" },
  { id: "o3",                display: "o3",                provider: "openai",    providerLabel: "OpenAI",    tier: "reasoning" },
  { id: "gemini-3-pro",      display: "Gemini 3 Pro",      provider: "google",    providerLabel: "Google",    tier: "frontier",  note: "vision + audio + video" },
  { id: "gemini-3-flash",    display: "Gemini 3 Flash",    provider: "google",    providerLabel: "Google",    tier: "fast" },
  { id: "grok-4",            display: "Grok 4",            provider: "xai",       providerLabel: "xAI",       tier: "balanced" },
];

const PROVIDER_DOT: Record<ModelMeta["provider"], string> = {
  anthropic: "#C96442",
  openai:    "#10A37F",
  google:    "#4285F4",
  xai:       "#0F172A",
  open:      "#5E6AD2",
};

const CAP_ICON: Record<ModelCapability, typeof Type> = {
  text:        Type,
  image:       ImageIcon,
  pdf:         FileText,
  audio:       Mic,
  video:       Video,
  web_search:  Globe,
  code_exec:   Code2,
  tools:       Wrench,
};

function findMeta(id: string): ModelMeta {
  // First entry in REGISTRY is the canonical default (free GLM 4.5 Air).
  return REGISTRY.find((m) => m.id === id) ?? REGISTRY[0];
}

interface Props {
  value: string;
  onChange: (modelId: string) => void;
  className?: string;
}

export function ModelPicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const meta = findMeta(value);
  const caps = MODEL_CAPABILITIES[meta.id] ?? ["text"];

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const grouped = REGISTRY.reduce<Record<string, ModelMeta[]>>((acc, m) => {
    if (!acc[m.providerLabel]) acc[m.providerLabel] = [];
    acc[m.providerLabel].push(m);
    return acc;
  }, {});

  return (
    <div ref={containerRef} className={`nb-model-picker ${className ?? ""}`} style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        className="nb-model-trigger"
        role="combobox"
        aria-expanded={open}
        aria-controls="nb-model-picker-list"
        aria-label={`Active model: ${meta.display}. Click to change.`}
        onClick={() => setOpen((v) => !v)}
        title="Click to change model"
      >
        <span className="dot" data-provider={meta.provider} style={{ background: PROVIDER_DOT[meta.provider] }} />
        <span className="nm">{meta.display}</span>
        <ChevronDown size={11} aria-hidden="true" style={{ marginLeft: 2, opacity: 0.6, transform: open ? "rotate(180deg)" : "none", transition: "transform 160ms" }} />
      </button>
      {open && (
        <div
          id="nb-model-picker-list"
          role="listbox"
          aria-label="Choose model"
          className="nb-model-picker-panel"
        >
          {Object.entries(grouped).map(([providerLabel, models]) => (
            <div key={providerLabel} className="nb-model-picker-group">
              <div className="nb-model-picker-group-head">{providerLabel}</div>
              {models.map((m) => {
                const isSelected = m.id === value;
                const mCaps = MODEL_CAPABILITIES[m.id] ?? ["text"];
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className="nb-model-picker-item"
                    data-active={isSelected}
                    onClick={() => {
                      onChange(m.id);
                      setActiveModel(m.id);
                      close();
                      triggerRef.current?.focus();
                    }}
                  >
                    <span
                      className="dot"
                      style={{ background: PROVIDER_DOT[m.provider], width: 7, height: 7, borderRadius: "50%", flexShrink: 0 }}
                      aria-hidden="true"
                    />
                    <span className="nb-model-picker-item-body">
                      <span className="nb-model-picker-item-title">
                        {m.display}
                        {m.tier === "frontier" && <span className="nb-model-picker-tier" data-tone="accent">frontier</span>}
                        {m.tier === "fast" && <span className="nb-model-picker-tier" data-tone="success">fast</span>}
                        {m.tier === "reasoning" && <span className="nb-model-picker-tier">reasoning</span>}
                        {m.benchmark && (
                          <span
                            className="nb-model-picker-bench-rank"
                            data-tone={m.benchmark.errors === 0 ? "clean" : "errors"}
                            title={`Leaderboard rank #${m.benchmark.rank} of 16 free models — benchmarked ${m.benchmark.benchmarkedAt}`}
                          >
                            #{m.benchmark.rank}
                          </span>
                        )}
                      </span>
                      {m.note && <span className="nb-model-picker-item-note">{m.note}</span>}
                      {m.benchmark && (
                        <span
                          className="nb-model-picker-item-bench"
                          aria-label={`NodeBench leaderboard score ${m.benchmark.avgScore.toFixed(2)} of 4, ${m.benchmark.passes} pass / ${m.benchmark.partials} partial / ${m.benchmark.fails} fail / ${m.benchmark.errors} errors, ${Math.round(m.benchmark.avgLatencyMs / 100) / 10}s avg`}
                        >
                          <span className="nb-model-picker-bench-score">
                            {m.benchmark.avgScore.toFixed(2)}/4
                          </span>
                          <span className="nb-model-picker-bench-passes" data-tone="ok">
                            {m.benchmark.passes}p
                          </span>
                          <span className="nb-model-picker-bench-partials" data-tone="warn">
                            {m.benchmark.partials}part
                          </span>
                          <span className="nb-model-picker-bench-fails" data-tone={m.benchmark.fails === 0 ? "ok" : "warn"}>
                            {m.benchmark.fails}f
                          </span>
                          {m.benchmark.errors > 0 && (
                            <span className="nb-model-picker-bench-errors" data-tone="bad">
                              {m.benchmark.errors}err
                            </span>
                          )}
                          <span className="nb-model-picker-bench-latency">
                            · {Math.round(m.benchmark.avgLatencyMs / 100) / 10}s
                          </span>
                        </span>
                      )}
                    </span>
                    <span className="nb-model-picker-item-caps" aria-label={`Capabilities: ${mCaps.join(", ")}`}>
                      {mCaps.slice(0, 5).map((c) => {
                        const Icon = CAP_ICON[c];
                        return <Icon key={c} size={11} aria-hidden="true" />;
                      })}
                    </span>
                    {isSelected && <Check size={12} className="nb-model-picker-item-check" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="nb-model-picker-foot">
            <div>
              <strong>Rank #</strong> = NodeBench leaderboard rank (16 free models, 8 queries).
              Score = mean 0–4 across 12 dimensions.
              <strong> p / part / f / err</strong> = pass / partial / fail / error counts.
            </div>
            <div style={{ marginTop: 4, opacity: 0.7 }}>
              Default: highest-score reliable free model (clean sweep).
              Selection persists in this browser; sent live via <code>runChatAgent</code> → pi-ai → OpenRouter.
              Benchmarked {BENCHMARKED_AT}. See{" "}
              <code>scripts/eval/model-leaderboard/runs/.../leaderboard.md</code>.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
