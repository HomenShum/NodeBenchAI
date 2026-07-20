import { useMemo, useState } from "react";
import { useThemeSafe } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

type ProductThumbnailProps = {
  title: string;
  summary: string;
  type: string;
  meta?: string;
  imageUrl?: string;
  imageUrls?: string[];
  sourceUrls?: string[];
  sourceLabels?: string[];
  tone?: number;
  className?: string;
  compact?: boolean;
};

const LIGHT_TONES = [
  { accent: "#d97757", wash: "linear-gradient(145deg, #fff7f4 0%, #f8ece8 100%)", glow: "rgba(217, 119, 87, 0.14)" },
  { accent: "#4f46e5", wash: "linear-gradient(145deg, #f4f4ff 0%, #ececff 100%)", glow: "rgba(79, 70, 229, 0.14)" },
  { accent: "#0f766e", wash: "linear-gradient(145deg, #f2fcfa 0%, #e6f5f2 100%)", glow: "rgba(15, 118, 110, 0.14)" },
  { accent: "#7c3aed", wash: "linear-gradient(145deg, #faf5ff 0%, #f3ebff 100%)", glow: "rgba(124, 58, 237, 0.14)" },
  { accent: "#b45309", wash: "linear-gradient(145deg, #fff9ef 0%, #f8efde 100%)", glow: "rgba(180, 83, 9, 0.14)" },
  { accent: "#0369a1", wash: "linear-gradient(145deg, #f1f9ff 0%, #e6f2fb 100%)", glow: "rgba(3, 105, 161, 0.14)" },
] as const;

const DARK_TONES = [
  { accent: "#d97757", wash: "linear-gradient(145deg, #2a1b16 0%, #171311 100%)", glow: "rgba(217, 119, 87, 0.18)" },
  { accent: "#7c8cff", wash: "linear-gradient(145deg, #1b1d2a 0%, #13151d 100%)", glow: "rgba(124, 140, 255, 0.18)" },
  { accent: "#3ba889", wash: "linear-gradient(145deg, #162520 0%, #121816 100%)", glow: "rgba(59, 168, 137, 0.18)" },
  { accent: "#c08bff", wash: "linear-gradient(145deg, #24182c 0%, #17131c 100%)", glow: "rgba(192, 139, 255, 0.18)" },
  { accent: "#f0c75e", wash: "linear-gradient(145deg, #2b2414 0%, #18150f 100%)", glow: "rgba(240, 199, 94, 0.18)" },
  { accent: "#6bb9ff", wash: "linear-gradient(145deg, #152330 0%, #11171d 100%)", glow: "rgba(107, 185, 255, 0.18)" },
] as const;

function getInitials(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function deriveSourceTokens(sourceUrls?: string[], sourceLabels?: string[]) {
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const href of sourceUrls ?? []) {
    try {
      const hostname = new URL(href).hostname.replace(/^www\./, "");
      if (!hostname || seen.has(hostname)) continue;
      seen.add(hostname);
      tokens.push(hostname);
    } catch {
      continue;
    }
  }

  if (tokens.length > 0) return tokens.slice(0, 4);

  for (const label of sourceLabels ?? []) {
    const next = label.trim();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    tokens.push(next);
  }

  return tokens.slice(0, 4);
}

function getTokenBadge(value: string) {
  const core = value
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]/gi, "");
  return core.slice(0, 2).toUpperCase() || value.slice(0, 1).toUpperCase();
}

function getTokenLabel(value: string) {
  return value.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

function getPosterLabel(type: string) {
  switch (type.toLowerCase()) {
    case "company":
      return "Company memory";
    case "person":
      return "Founder brief";
    case "job":
      return "Role fit";
    case "market":
      return "Market watch";
    case "note":
      return "Working note";
    case "prep_brief":
      return "Prep brief";
    default:
      return "Saved report";
  }
}

function getTypeBadgeLabel(type: string) {
  const normalized = type.trim().toLowerCase();
  switch (normalized) {
    case "prep_brief":
      return "Prep brief";
    case "company":
      return "Company";
    case "person":
      return "Person";
    case "job":
      return "Job";
    case "market":
      return "Market";
    case "note":
      return "Note";
    default:
      return type.replace(/[_-]+/g, " ").trim() || "Report";
  }
}

function getFallbackSubline(type: string) {
  switch (type.toLowerCase()) {
    case "company":
      return "Main takeaways, sources, and what changed.";
    case "person":
      return "Background, links, and the right next questions.";
    case "job":
      return "Role read, fit gaps, and interview prep.";
    case "market":
      return "Signals, risks, and the next watch items.";
    case "prep_brief":
      return "Meeting prep with clear follow-through.";
    default:
      return "Saved with sources, notes, and the next step.";
  }
}

export function ProductThumbnail({
  title,
  summary,
  type,
  meta,
  imageUrl,
  imageUrls,
  sourceUrls,
  sourceLabels,
  tone = 0,
  className,
  compact = false,
}: ProductThumbnailProps) {
  const { resolvedMode } = useThemeSafe();
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const palette = useMemo(
    () => (resolvedMode === "dark" ? DARK_TONES : LIGHT_TONES)[tone % LIGHT_TONES.length],
    [resolvedMode, tone],
  );
  const mergedImageUrls = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const candidate of [...(imageUrls ?? []), imageUrl]) {
      const next = candidate?.trim();
      if (!next || seen.has(next)) continue;
      seen.add(next);
      merged.push(next);
    }
    return merged;
  }, [imageUrl, imageUrls]);
  const visibleImageUrls = mergedImageUrls.filter((url) => !failedImages.includes(url));
  const sourceTokens = useMemo(
    () => deriveSourceTokens(sourceUrls, sourceLabels),
    [sourceLabels, sourceUrls],
  );
  const shouldRenderImage = visibleImageUrls.length > 0;
  const topSourceToken = sourceTokens[0];
  const topSourceLabel = topSourceToken ? getTokenLabel(topSourceToken) : null;
  const extraSourceCount = Math.max(0, sourceTokens.length - (topSourceLabel ? 1 : 0));
  const extraImageCount = Math.max(0, mergedImageUrls.length - 1);

  const handleImageError = (url: string) => {
    setFailedImages((current) => (current.includes(url) ? current : [...current, url]));
  };

  if (shouldRenderImage) {
    const primaryImage = visibleImageUrls[0];

    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-[22px] border",
          resolvedMode === "dark"
            ? "border-white/8 bg-[#14181d]"
            : "border-[rgba(15,23,42,0.08)] bg-white",
          className,
        )}
      >
        <img
          src={primaryImage}
          alt={title}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => handleImageError(primaryImage)}
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.04)_0%,rgba(15,23,42,0.14)_48%,rgba(15,23,42,0.56)_100%)] dark:bg-[linear-gradient(180deg,rgba(0,0,0,0.04)_0%,rgba(0,0,0,0.2)_48%,rgba(0,0,0,0.62)_100%)]" />

        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3">
          <div
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
              "bg-white/88 text-slate-800 dark:bg-black/34 dark:text-white/90",
            )}
          >
            {getTypeBadgeLabel(type)}
          </div>
          {meta ? (
            <div
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium",
                "bg-black/28 text-white/86 dark:bg-black/40 dark:text-white/84",
              )}
            >
              {meta}
            </div>
          ) : null}
        </div>

        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
          <div
            className={cn(
              "inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium backdrop-blur-md",
              resolvedMode === "dark"
                ? "border-white/10 bg-black/34 text-white/86"
                : "border-white/60 bg-white/82 text-slate-800",
            )}
          >
            <span
              className={cn(
                "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-lg text-[9px] font-semibold tracking-[0.12em]",
                resolvedMode === "dark"
                  ? "bg-white/10 text-white/86"
                  : "bg-slate-900/6 text-slate-700",
              )}
            >
              {topSourceToken ? getTokenBadge(topSourceToken) : getInitials(title)}
            </span>
            <span className="truncate">
              {topSourceLabel ?? getPosterLabel(type)}
            </span>
          </div>
          {extraImageCount > 0 || extraSourceCount > 0 ? (
            <div
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium",
                "bg-black/28 text-white/86 dark:bg-black/40 dark:text-white/84",
              )}
            >
              +{Math.max(extraImageCount, extraSourceCount)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[22px] border p-4",
        resolvedMode === "dark"
          ? "border-white/8 text-white"
          : "border-[rgba(15,23,42,0.08)] text-slate-900",
        className,
      )}
      style={{ background: palette.wash }}
    >
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full blur-2xl"
        style={{ backgroundColor: palette.glow }}
      />

      <div className={cn("relative flex h-full flex-col justify-between", compact ? "gap-4" : "gap-5")}>
        <div className="flex items-start justify-between gap-3">
          <div
            className={cn(
              "inline-flex max-w-[70%] items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
              resolvedMode === "dark" ? "bg-white/8 text-white/82" : "bg-white/78 text-slate-700",
            )}
          >
            {getTypeBadgeLabel(type)}
          </div>
          {meta ? (
            <div
              className={cn(
                "text-[10px] font-medium uppercase tracking-[0.16em]",
                resolvedMode === "dark" ? "text-white/58" : "text-slate-500",
              )}
            >
              {meta}
            </div>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col justify-end">
          <div
            className={cn(
              compact ? "text-xl" : "text-2xl",
              "max-w-[12rem] font-semibold tracking-tight line-clamp-2",
              resolvedMode === "dark" ? "text-white/92" : "text-slate-900",
            )}
          >
            {title?.trim() ? title : getPosterLabel(type)}
          </div>
          {!compact ? (
            <div
              className={cn(
                "mt-3 max-w-[15rem] text-xs leading-5",
                resolvedMode === "dark" ? "text-white/64" : "text-slate-600",
              )}
            >
              {summary || getFallbackSubline(type)}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div
            className={cn(
              "inline-flex min-w-0 max-w-full items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em]",
              resolvedMode === "dark"
                ? "bg-black/16 text-white/68"
                : "bg-white/82 text-slate-600",
            )}
          >
            <span
              className={cn(
                "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-lg text-[9px] font-semibold tracking-[0.12em]",
                resolvedMode === "dark"
                  ? "bg-white/10 text-white/86"
                  : "bg-slate-900/6 text-slate-700",
              )}
              style={{ boxShadow: `inset 0 0 0 1px ${palette.glow}` }}
            >
              {topSourceToken ? getTokenBadge(topSourceToken) : getInitials(title)}
            </span>
            <span className="truncate">{topSourceLabel ?? "Source-led"}</span>
          </div>
          <div
            className={cn(
              "text-[10px] font-medium uppercase tracking-[0.16em]",
              resolvedMode === "dark" ? "text-white/58" : "text-slate-500",
            )}
          >
            {sourceTokens.length > 0 ? `${sourceTokens.length} source${sourceTokens.length === 1 ? "" : "s"}` : "Ready"}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProductThumbnail;
