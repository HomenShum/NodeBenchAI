/**
 * ModelCapabilityBadge — surfaces what the active model can do.
 *
 * Pattern borrowed from open-source projects that route through unified
 * LLM providers (OpenRouter, pi-ai, LibreChat, OpenWebUI):
 *   - OpenRouter exposes `architecture.input_modalities` / `output_modalities`
 *     on every model — text, image, audio, video, file
 *   - LibreChat shows per-model capability chips next to the model picker
 *   - pi-ai's `getModel().inputModalities` is the same shape
 *
 * NodeBench surfaces them as a compact icon-only row of pills; each
 * pill is a `.nb-badge` (kit canonical chrome) with a Lucide icon at
 * 14px (kit rule for pill-sized icons) and a native title tooltip.
 *
 * Unsupported capabilities render at 35% opacity with a strikethrough
 * decoration so the user sees what's missing without it competing
 * visually with what works.
 *
 * Why this matters for the operator console: the agent might be told to
 * extract values from a PDF, but the active model may not natively
 * accept PDFs. Surfacing the capability up front prevents silent
 * fallbacks ("agent transcribed the PDF as text and lost the layout").
 */

import {
  Code2,
  FileText,
  Globe,
  Image as ImageIcon,
  Mic,
  Type,
  Video,
  Wrench,
} from "lucide-react";

export type ModelCapability =
  | "text"
  | "image"
  | "pdf"
  | "audio"
  | "video"
  | "web_search"
  | "code_exec"
  | "tools";

interface CapabilityMeta {
  icon: typeof Type;
  shortLabel: string;
  description: string;
}

const META: Record<ModelCapability, CapabilityMeta> = {
  text:        { icon: Type,      shortLabel: "Text",       description: "Reads and writes text natively." },
  image:       { icon: ImageIcon, shortLabel: "Image",      description: "Accepts image inputs (vision-language model)." },
  pdf:         { icon: FileText,  shortLabel: "PDF / files", description: "Accepts PDF documents directly without external parsing." },
  audio:       { icon: Mic,       shortLabel: "Audio",      description: "Transcribes or reasons over audio input." },
  video:       { icon: Video,     shortLabel: "Video",      description: "Reads video frames as input." },
  web_search:  { icon: Globe,     shortLabel: "Web search", description: "Native web grounding / citations." },
  code_exec:   { icon: Code2,     shortLabel: "Code",       description: "Executes code in a sandbox." },
  tools:       { icon: Wrench,    shortLabel: "Tools",      description: "Function / tool calling with structured output." },
};

const ALL_CAPABILITIES: ModelCapability[] = [
  "text",
  "image",
  "pdf",
  "audio",
  "video",
  "web_search",
  "code_exec",
  "tools",
];

/**
 * Static capability registry for the models NodeBench routes through.
 *
 * Source of truth long-term should be a Convex action that hits
 * OpenRouter's `/v1/models` and caches the modality matrix daily —
 * same pattern LibreChat uses. For now this registry is hand-curated
 * against the model-card pages, which is fine for the demo and gives
 * the MCP / CLI a clean export point.
 *
 * IMPORTANT: when a model isn't in this registry, the badge falls back
 * to `["text"]` and labels the row as "unknown" — better to be honest
 * than to claim capabilities the model can't deliver (HONEST_SCORES).
 */
export const MODEL_CAPABILITIES: Record<string, ModelCapability[]> = {
  // Anthropic
  "claude-opus-4-7":   ["text", "image", "pdf", "tools"],
  "claude-sonnet-4-6": ["text", "image", "pdf", "tools"],
  "claude-haiku-4-5":  ["text", "image", "pdf", "tools"],
  // OpenAI
  "gpt-5":             ["text", "image", "tools"],
  "gpt-4.1":           ["text", "image", "tools"],
  "gpt-4o":            ["text", "image", "audio", "tools"],
  "o1":                ["text", "tools"],
  "o3":                ["text", "tools"],
  // Google
  "gemini-3-pro":      ["text", "image", "pdf", "audio", "video", "tools"],
  "gemini-3-flash":    ["text", "image", "pdf", "audio", "video", "tools"],
  "gemini-2.5-flash":  ["text", "image", "pdf", "audio", "video", "tools"],
  // xAI
  "grok-4":            ["text", "image", "tools"],
  // Open weights via OpenRouter
  "kimi-k2.6":         ["text", "tools"],
  "deepseek-v3.5":     ["text", "tools"],
  "glm-4.6v":          ["text", "image", "tools"],
};

export function getCapabilitiesForModel(model: string | undefined | null): {
  capabilities: ModelCapability[];
  isKnown: boolean;
} {
  if (!model) return { capabilities: ["text"], isKnown: false };
  const normalized = model.toLowerCase();
  for (const [key, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (normalized.includes(key.toLowerCase())) {
      return { capabilities: caps, isKnown: true };
    }
  }
  return { capabilities: ["text"], isKnown: false };
}

interface Props {
  model: string;
  /** Override the capability set explicitly (e.g. for OpenRouter responses). */
  capabilities?: ModelCapability[];
  /** Show the disabled/unsupported capabilities too, dimmed. Default true. */
  showUnsupported?: boolean;
  className?: string;
}

export function ModelCapabilityBadge({
  model,
  capabilities,
  showUnsupported = true,
  className,
}: Props) {
  const resolved = capabilities ?? getCapabilitiesForModel(model).capabilities;
  const isKnown = capabilities !== undefined || getCapabilitiesForModel(model).isKnown;
  const supported = new Set<ModelCapability>(resolved);
  const visible = showUnsupported ? ALL_CAPABILITIES : resolved;

  return (
    <div
      role="group"
      aria-label={`Capabilities of model ${model}${isKnown ? "" : " (unknown — defaults assumed)"}`}
      className={`inline-flex items-center gap-1.5 ${className ?? ""}`}
    >
      <span className="type-label !tracking-[0.18em]" aria-hidden="true">
        Model
      </span>
      <span
        className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-[3px] text-[11px] font-semibold text-[var(--text-secondary)]"
        title={isKnown ? `Active model: ${model}` : `Unknown model "${model}" — capabilities default to text-only`}
      >
        {model}
        {!isKnown && (
          <span className="ml-1 text-[var(--text-tertiary)]">(unverified)</span>
        )}
      </span>
      <div className="flex items-center gap-1" role="list">
        {visible.map((cap) => {
          const meta = META[cap];
          const Icon = meta.icon;
          const isSupported = supported.has(cap);
          return (
            <span
              key={cap}
              role="listitem"
              title={`${meta.shortLabel} — ${isSupported ? meta.description : "Not supported by this model"}`}
              aria-label={`${meta.shortLabel}: ${isSupported ? "supported" : "not supported"}`}
              className={[
                "inline-flex h-6 w-6 items-center justify-center rounded-full border",
                isSupported
                  ? "border-[color:color-mix(in_oklab,var(--accent-primary)_24%,transparent)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
                  : "border-[var(--border-color)] bg-transparent text-[var(--text-tertiary)] opacity-50 line-through",
              ].join(" ")}
            >
              <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
            </span>
          );
        })}
      </div>
    </div>
  );
}
