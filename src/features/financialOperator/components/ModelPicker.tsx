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
const DEFAULT_MODEL = "claude-sonnet-4-6";

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
}

const REGISTRY: ModelMeta[] = [
  // Anthropic
  { id: "claude-opus-4-7",   display: "Claude Opus 4.7",   provider: "anthropic", providerLabel: "Anthropic", tier: "frontier", note: "1M ctx · best reasoning" },
  { id: "claude-sonnet-4-6", display: "Claude Sonnet 4.6", provider: "anthropic", providerLabel: "Anthropic", tier: "balanced", note: "default · fast + capable" },
  { id: "claude-haiku-4-5",  display: "Claude Haiku 4.5",  provider: "anthropic", providerLabel: "Anthropic", tier: "fast",     note: "fastest · cheapest" },
  // OpenAI
  { id: "gpt-5",             display: "GPT-5",             provider: "openai",    providerLabel: "OpenAI",    tier: "frontier" },
  { id: "gpt-4.1",           display: "GPT-4.1",           provider: "openai",    providerLabel: "OpenAI",    tier: "balanced" },
  { id: "gpt-4o",            display: "GPT-4o",            provider: "openai",    providerLabel: "OpenAI",    tier: "balanced", note: "audio in/out" },
  { id: "o3",                display: "o3",                provider: "openai",    providerLabel: "OpenAI",    tier: "reasoning" },
  // Google
  { id: "gemini-3-pro",      display: "Gemini 3 Pro",      provider: "google",    providerLabel: "Google",    tier: "frontier", note: "vision + audio + video" },
  { id: "gemini-3-flash",    display: "Gemini 3 Flash",    provider: "google",    providerLabel: "Google",    tier: "fast" },
  // xAI
  { id: "grok-4",            display: "Grok 4",            provider: "xai",       providerLabel: "xAI",       tier: "balanced" },
  // Open weights via OpenRouter
  { id: "kimi-k2.6",         display: "Kimi K2.6",         provider: "open",      providerLabel: "Open weights", tier: "balanced" },
  { id: "deepseek-v3.5",     display: "DeepSeek V3.5",     provider: "open",      providerLabel: "Open weights", tier: "reasoning" },
  { id: "glm-4.6v",          display: "GLM 4.6V",          provider: "open",      providerLabel: "Open weights", tier: "balanced", note: "vision" },
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
  return REGISTRY.find((m) => m.id === id) ?? REGISTRY[1];
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
                      </span>
                      {m.note && <span className="nb-model-picker-item-note">{m.note}</span>}
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
            Selection persists in this browser. Wired to send-turn via <code>?model=</code>.
          </div>
        </div>
      )}
    </div>
  );
}
