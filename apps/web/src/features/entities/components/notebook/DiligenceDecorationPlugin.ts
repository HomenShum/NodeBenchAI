import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EvidenceTier } from "@/features/entities/components/EvidenceChip";

/**
 * Agent palette — persistent color + label per block-type. v3/v4 prototype
 * pattern: users learn "purple is News, teal is Funding" over time. Keep
 * the map here (not imported) so this module stays free of React / app
 * imports and can be bundled into the editor chunk cleanly.
 */
type PaletteEntry = { label: string; color: string; glyph: string | null };
const PALETTE_BY_BLOCK_TYPE: Record<string, PaletteEntry> = {
  projection:    { label: "Reference",   color: "#94a3b8", glyph: "⌘" },
  founder:       { label: "Founder",     color: "#d97757", glyph: "F" },
  product:       { label: "Product",     color: "#529cca", glyph: "P" },
  funding:       { label: "Funding",     color: "#4dab9a", glyph: "$" },
  news:          { label: "News",        color: "#9065b0", glyph: "N" },
  hiring:        { label: "Hiring",      color: "#e8a33d", glyph: "H" },
  patent:        { label: "Patents",     color: "#6b7fd7", glyph: "⚙" },
  publicOpinion: { label: "Sentiment",   color: "#d1568f", glyph: "◎" },
  competitor:    { label: "Competitors", color: "#d9730d", glyph: "C" },
  regulatory:    { label: "Regulatory",  color: "#9ca3af", glyph: "§" },
  financial:     { label: "Financials",  color: "#10b981", glyph: "%" },
};

export const diligenceDecorationPluginKey = new PluginKey<DecorationSet>(
  "nodebench.diligenceDecorations",
);

/**
 * Transitional note:
 * `projection` is a bridge type for the existing report-derived notebook
 * snapshot while the generic diligence block pipeline is being wired end to
 * end. The steady-state types remain the diligence block families below.
 */
export type DiligenceBlockType =
  | "projection"
  | "founder"
  | "product"
  | "funding"
  | "news"
  | "hiring"
  | "patent"
  | "publicOpinion"
  | "competitor"
  | "regulatory"
  | "financial";

/** 4-state status chip (v2 prototype). `label` is the human-readable line. */
export type StatusLineState = "done" | "progress" | "info" | "wait";
export type StatusLine = {
  state: StatusLineState;
  label: string;
  /** Optional code-chip for typed shared data (e.g. `raw_data`, `Cluster 1`). */
  codeChip?: string;
};

/** Approval-gate states (v2 prototype human-in-the-loop pattern). */
export type ApprovalStatus = "pending" | "granted" | "denied";

/** Dependency wait: "Waiting for {dataKey} from {agentId}". */
export type WaitingOn = {
  agentId: string;
  dataKey: string;
};

export type DiligenceDecorationData = {
  blockType: DiligenceBlockType;
  overallTier: EvidenceTier;
  headerText: string;
  bodyProse?: string;
  scratchpadRunId: string;
  version: number;
  updatedAt: number;
  sourceSectionId?: string;
  sourceRefIds?: string[];
  sourceCount?: number;
  sourceLabel?: string;
  sourceTokens?: string[];
  /** v2 status lines — each renders as a colored chip with optional code chip. */
  statusLines?: StatusLine[];
  /** v2 dependency-wait state — renders a callout above the body. */
  waitingOn?: WaitingOn;
  /** v2 human approval gate — pending renders [Approve] [Deny]; granted/denied renders a quiet confirmation. */
  approvalStatus?: ApprovalStatus;
  payload?: unknown;
};

export type AnchorStrategy =
  | { kind: "top" }
  | { kind: "bottom" }
  | { kind: "after-heading"; text: string }
  | { kind: "before-heading"; text: string };

export type DecorationRenderer = {
  render: (data: DiligenceDecorationData) => HTMLElement;
};

export type DecorationRendererRegistry = Partial<
  Record<DiligenceBlockType, DecorationRenderer>
>;

/**
 * Canonical callback shape for every decoration action (accept,
 * dismiss, refresh, ask). Centralized here so NotebookBlockEditor,
 * NotebookDiligenceOverlayHost, and EntityNotebookLive's BlockRow
 * type don't duplicate the signature six times.
 */
export type DecorationActionCallback = (
  scratchpadRunId: string,
  blockType: DiligenceDecorationData["blockType"],
) => void;

export type DiligenceDecorationPluginConfig = {
  getDecorations: () => readonly DiligenceDecorationData[];
  anchors: AnchorStrategy[];
  renderers?: DecorationRendererRegistry;
  onAcceptDecoration?: DecorationActionCallback;
  onDismissDecoration?: DecorationActionCallback;
  onRefreshDecoration?: DecorationActionCallback;
  /**
   * Opens the side-panel agent drawer with this decoration as context.
   * The seam between inline AI (decorations) and chat AI (drawer).
   *
   * When provided, the plugin auto-injects an "Ask NodeBench" button
   * into the action bar of every decoration (no per-renderer change
   * required). When omitted, the button is suppressed — not disabled —
   * so we never show dead UI.
   */
  onAskAboutDecoration?: DecorationActionCallback;
};

function tierToneClass(tier: EvidenceTier): string {
  switch (tier) {
    case "verified":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-300";
    case "corroborated":
      return "border-sky-400/30 bg-sky-500/10 text-sky-300";
    case "single-source":
      return "border-amber-400/30 bg-amber-500/10 text-amber-300";
    case "unverified":
      return "border-slate-400/20 bg-slate-500/10 text-slate-300";
  }
}

function tierLabel(tier: EvidenceTier): string {
  switch (tier) {
    case "verified":
      return "Verified";
    case "corroborated":
      return "Corroborated";
    case "single-source":
      return "Single source";
    case "unverified":
      return "Unverified";
  }
}

function formatRelative(updatedAt: number): string {
  const ageMs = Math.max(0, Date.now() - updatedAt);
  if (ageMs < 60_000) return "just now";
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function resolveAnchorPosition(
  doc: ProseMirrorNode,
  anchors: readonly AnchorStrategy[],
): number {
  const safeTop = 1;
  const safeBottom = Math.max(doc.content.size, 1);
  const findHeading = (
    headingText: string,
    matchKind: "after" | "before",
  ): number | null => {
    const target = normalizeText(headingText);
    let resolved: number | null = null;
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      const text = normalizeText(node.textContent ?? "");
      if (!text || text !== target) return true;
      resolved = matchKind === "after" ? pos + node.nodeSize : pos;
      return false;
    });
    return resolved;
  };

  for (const anchor of anchors) {
    if (anchor.kind === "top") return safeTop;
    if (anchor.kind === "bottom") return safeBottom;
    if (anchor.kind === "after-heading") {
      const found = findHeading(anchor.text, "after");
      if (found != null) return found;
    }
    if (anchor.kind === "before-heading") {
      const found = findHeading(anchor.text, "before");
      if (found != null) return found;
    }
  }

  return safeTop;
}

function attachAction(
  button: HTMLButtonElement,
  callback: (() => void) | undefined,
): void {
  if (!callback) {
    button.disabled = true;
    button.classList.add("opacity-50", "cursor-not-allowed");
    return;
  }
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    callback();
  });
}

function attachRendererActions(
  root: HTMLElement,
  data: DiligenceDecorationData,
  config: DiligenceDecorationPluginConfig,
): void {
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-action="accept"]'))) {
    attachAction(button, () =>
      config.onAcceptDecoration?.(data.scratchpadRunId, data.blockType),
    );
  }

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-action="refresh"]'))) {
    attachAction(button, () =>
      config.onRefreshDecoration?.(data.scratchpadRunId, data.blockType),
    );
  }

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-action="dismiss"]'))) {
    attachAction(button, () =>
      config.onDismissDecoration?.(data.scratchpadRunId, data.blockType),
    );
  }

  /*
   * Central injection of the "Ask NodeBench" button — one line of config
   * wires every renderer, no per-renderer edits. We locate the action bar
   * by the first existing action button (accept / refresh / dismiss),
   * then prepend our button so it reads left-to-right as the first
   * option — "Ask > Accept > Refresh > Dismiss" — because "learn more"
   * is almost always the safest action when a user isn't sure yet.
   *
   * Suppressed (not disabled) when onAskAboutDecoration is absent, so
   * tests running with partial configs don't see dead UI.
   */
  if (config.onAskAboutDecoration) {
    const anchorButton = root.querySelector<HTMLButtonElement>(
      '[data-action="accept"], [data-action="refresh"], [data-action="dismiss"]',
    );
    const actionBar = anchorButton?.parentElement;
    if (actionBar) {
      const askButton = document.createElement("button");
      askButton.type = "button";
      askButton.setAttribute("data-action", "ask");
      askButton.setAttribute("data-block", data.blockType);
      askButton.setAttribute("data-run-id", data.scratchpadRunId);
      askButton.className =
        "inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-content-muted hover:border-[color:var(--accent-primary)]/40 hover:text-content transition";
      askButton.textContent = "Ask NodeBench";
      actionBar.insertBefore(askButton, actionBar.firstChild);
      attachAction(askButton, () =>
        config.onAskAboutDecoration?.(data.scratchpadRunId, data.blockType),
      );
    }
  }
}

/**
 * First-appearance reveal tracking.
 *
 * When a decoration's `scratchpadRunId + blockType` has never been
 * rendered in this session, we add a `nb-decoration-reveal` class
 * to its root element. A CSS `@keyframes nb-decoration-reveal` rule
 * (see src/index.css) animates the decoration in with a subtle fade
 * + slight upward translate, and respects `prefers-reduced-motion`.
 *
 * Subsequent renders (user scrolls away and back) skip the class so
 * the decoration just appears without drawing new attention. Module-
 * level set is safe: bounded by distinct runs per session (tens to
 * low hundreds). Never cleared; GC happens on page unload.
 */
const seenDecorationRunIds = new Set<string>();

export function renderDiligenceDecorationElement(
  data: DiligenceDecorationData,
  config: DiligenceDecorationPluginConfig,
): HTMLElement {
  const renderer = config.renderers?.[data.blockType];
  const node = renderer
    ? renderer.render(data)
    : renderDefaultDecoration(data, config);
  if (renderer) {
    attachRendererActions(node, data, config);
  }
  // First-appearance reveal — stagger slightly so sibling arrivals
  // don't animate in on the exact same frame.
  const revealKey = `${data.scratchpadRunId}::${data.blockType}`;
  if (!seenDecorationRunIds.has(revealKey)) {
    seenDecorationRunIds.add(revealKey);
    node.classList.add("nb-decoration-reveal");
    const revealIndex = Math.min(seenDecorationRunIds.size - 1, 8);
    (node as HTMLElement).style.animationDelay = `${revealIndex * 40}ms`;
  }
  return node;
}

function renderDefaultDecoration(
  data: DiligenceDecorationData,
  config: DiligenceDecorationPluginConfig,
): HTMLElement {
  // Per-agent palette (v3/v4 pattern): the left accent adopts the block-type's
  // role color so the user learns "purple is News, teal is Funding" over time.
  const palette = PALETTE_BY_BLOCK_TYPE[data.blockType] ?? {
    color: "var(--accent-primary)",
    label: data.blockType,
    glyph: null as string | null,
  };

  // Inline agent suggestion — rendered like a natural notebook block, not a
  // card. Left-accent hints "this is agent-authored, not yet accepted".
  // Actions appear on hover (Notion/Linear pattern).
  const root = document.createElement("span");
  root.className =
    "notebook-diligence-decoration group my-2 block border-l-2 pl-3 text-left";
  // Inline style so the palette color wins over the default accent; can't
  // parametrize a Tailwind class at runtime.
  root.style.borderLeftColor = `${palette.color}80`; // 50% alpha
  root.setAttribute("contenteditable", "false");
  root.dataset.blockType = data.blockType;
  root.dataset.runId = data.scratchpadRunId;
  root.dataset.version = String(data.version);

  // Section header: reads like an H3 in the document. Small colored agent
  // chip tells the user which agent authored this section (v3/v4 pattern).
  const titleRow = document.createElement("span");
  titleRow.className = "mb-1 flex items-baseline gap-2";

  const title = document.createElement("span");
  title.className = "text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100";
  title.textContent = data.headerText;
  titleRow.appendChild(title);

  const agentTag = document.createElement("span");
  agentTag.className = "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium";
  // Color-mix gives us a readable tinted background from any hex source.
  agentTag.style.backgroundColor = `color-mix(in oklab, ${palette.color} 18%, transparent)`;
  agentTag.style.color = palette.color;
  if (palette.glyph) {
    const glyph = document.createElement("span");
    glyph.textContent = palette.glyph;
    glyph.style.fontWeight = "700";
    agentTag.appendChild(glyph);
  }
  const agentLabel = document.createElement("span");
  agentLabel.textContent = palette.label;
  agentTag.appendChild(agentLabel);
  titleRow.appendChild(agentTag);

  // Tier chip only when meaningful (not the default "unverified").
  if (data.overallTier !== "unverified") {
    const tier = document.createElement("span");
    tier.className = `ml-auto inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${tierToneClass(data.overallTier)}`;
    const tierDot = document.createElement("span");
    tierDot.className = "h-1.5 w-1.5 rounded-full bg-current";
    tier.appendChild(tierDot);
    tier.appendChild(document.createTextNode(tierLabel(data.overallTier)));
    titleRow.appendChild(tier);
  }
  root.appendChild(titleRow);

  // Waiting-on dependency callout (v2 prototype pattern) — renders ABOVE
  // the body so the user sees the block is blocked before the prose.
  if (data.waitingOn) {
    const waitCallout = document.createElement("span");
    waitCallout.className =
      "notebook-stream-ink mt-1 mb-2 flex items-center gap-2 rounded border-l-2 border-amber-400/50 bg-amber-500/[0.06] px-2 py-1 text-[12px] text-amber-700 dark:text-amber-300";
    waitCallout.innerHTML =
      `<span>⏳</span><span>Waiting for <code class="font-mono text-[11px] rounded bg-amber-500/15 px-1 py-0.5">${data.waitingOn.dataKey}</code> from ${data.waitingOn.agentId}…</span>`;
    root.appendChild(waitCallout);
  }

  // Status lines (v2 prototype — 4 semantic states: done/progress/info/wait).
  // Each renders as a single-line chip with icon + label + optional code chip.
  if (data.statusLines && data.statusLines.length > 0) {
    for (const line of data.statusLines) {
      const row = document.createElement("span");
      const toneClass =
        line.state === "done"
          ? "text-emerald-600 dark:text-emerald-400"
          : line.state === "progress"
            ? "text-amber-600 dark:text-amber-400"
            : line.state === "info"
              ? "text-sky-600 dark:text-sky-400"
              : "text-gray-500 dark:text-gray-400";
      const icon =
        line.state === "done" ? "✓" : line.state === "progress" ? "⏳" : line.state === "info" ? "↳" : "◯";
      row.className = `notebook-stream-ink flex items-center gap-1.5 text-[12px] py-0.5 ${toneClass}`;
      const codeChipHtml = line.codeChip
        ? `<code class="font-mono text-[11px] rounded bg-current/[0.1] px-1 py-0.5 opacity-80">${line.codeChip}</code>`
        : "";
      row.innerHTML = `<span>${icon}</span><span>${line.label}${codeChipHtml ? " " + codeChipHtml : ""}</span>`;
      root.appendChild(row);
    }
  }

  // Body: plain agent-ink prose, matching the notebook's reading rhythm.
  // Each paragraph fades in with a staggered delay (v3 pattern). The last
  // paragraph additionally gets a blinking caret when the decoration is
  // recent (<5s) — the "live writing" feel from v4 without per-char
  // wrapping. Caret is a pure CSS pseudo-element so no extra DOM.
  const paragraphs = (data.bodyProse ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const isStreamingRecent = Date.now() - data.updatedAt < 5_000;
  paragraphs.forEach((paragraph, idx) => {
    const p = document.createElement("span");
    const isLast = idx === paragraphs.length - 1;
    p.className =
      "notebook-stream-ink block text-[16px] leading-[1.75] text-gray-600 dark:text-gray-300" +
      (isLast && isStreamingRecent ? " notebook-stream-active" : "");
    // Staggered per-paragraph fade (v3 prototype: index * 50ms).
    p.style.animationDelay = `${idx * 40}ms`;
    // Gap 2: Char-by-char typewriter for the LAST paragraph during active
    // stream (v4 prototype's 20ms/char feel). Older paragraphs get the
    // block fade only (cheap). Paragraph can be thousands of chars; cap
    // the wrapped count at 120 so animation never runs longer than ~1.2s.
    if (isLast && isStreamingRecent && paragraph.length <= 400) {
      const head = paragraph.slice(0, Math.max(0, paragraph.length - 120));
      const tail = paragraph.slice(head.length);
      if (head) p.appendChild(document.createTextNode(head));
      for (let i = 0; i < tail.length; i++) {
        const ch = document.createElement("span");
        ch.className = "notebook-stream-char";
        ch.style.animationDelay = `${i * 12}ms`;
        ch.textContent = tail[i];
        p.appendChild(ch);
      }
    } else {
      p.textContent = paragraph;
    }
    root.appendChild(p);
  });

  // Approval gate (v2 prototype) — renders between body and meta so the
  // user sees it before the action bar. Pending shows buttons; others
  // show a quiet confirmation row.
  if (data.approvalStatus) {
    const gate = document.createElement("span");
    gate.className =
      "notebook-stream-ink mt-2 flex items-center gap-2 rounded border-l-2 px-2 py-1.5 text-[12px] " +
      (data.approvalStatus === "pending"
        ? "border-[var(--accent-primary)]/50 bg-[var(--accent-primary)]/[0.06] text-gray-700 dark:text-gray-200"
        : data.approvalStatus === "granted"
          ? "border-emerald-500/40 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-300"
          : "border-rose-500/40 bg-rose-500/[0.05] text-rose-600 dark:text-rose-300");
    if (data.approvalStatus === "pending") {
      gate.innerHTML = `<span>🔒</span><span class="flex-1">Human approval required before proceeding.</span>`;
      const approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className =
        "rounded-md bg-[var(--accent-primary)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/25 transition-colors";
      approveBtn.textContent = "Approve";
      approveBtn.setAttribute("data-action", "approve");
      approveBtn.setAttribute("data-run-id", data.scratchpadRunId);
      approveBtn.setAttribute("data-block", data.blockType);
      gate.appendChild(approveBtn);
      const denyBtn = document.createElement("button");
      denyBtn.type = "button";
      denyBtn.className =
        "rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-gray-500 hover:bg-white/[0.08] transition-colors";
      denyBtn.textContent = "Deny";
      denyBtn.setAttribute("data-action", "deny");
      denyBtn.setAttribute("data-run-id", data.scratchpadRunId);
      denyBtn.setAttribute("data-block", data.blockType);
      gate.appendChild(denyBtn);
    } else {
      const icon = data.approvalStatus === "granted" ? "✓" : "✕";
      const label = data.approvalStatus === "granted" ? "Approved" : "Denied";
      gate.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    }
    root.appendChild(gate);
  }

  // Meta row: source count + inline action strip. Hidden opacity, reveals
  // on hover (keeps reading surface calm).
  const meta = document.createElement("span");
  meta.className =
    "mt-1 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100";

  if (data.sourceCount != null && data.sourceCount > 0) {
    const count = document.createElement("span");
    count.textContent = `${data.sourceCount} source${data.sourceCount === 1 ? "" : "s"}`;
    meta.appendChild(count);
    const sep = document.createElement("span");
    sep.className = "text-gray-300 dark:text-gray-600";
    sep.textContent = "·";
    meta.appendChild(sep);
  }

  // Render source-token chips ([s1], [s2], ...) so a reader can see
  // which report sources backed the suggestion at a glance. Restored
  // here after an earlier refactor dropped them; test coverage in
  // NotebookDiligenceOverlayHost.test.tsx asserts on these literals.
  if (data.sourceTokens && data.sourceTokens.length > 0) {
    for (const token of data.sourceTokens) {
      const chip = document.createElement("span");
      chip.className =
        "rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-primary)] bg-[var(--accent-primary)]/10";
      chip.textContent = token;
      meta.appendChild(chip);
    }
    const chipSep = document.createElement("span");
    chipSep.className = "text-gray-300 dark:text-gray-600";
    chipSep.textContent = "·";
    meta.appendChild(chipSep);
  }

  const updated = document.createElement("span");
  updated.textContent = `updated ${formatRelative(data.updatedAt)}`;
  meta.appendChild(updated);

  const hasActions =
    Boolean(config.onAcceptDecoration) ||
    Boolean(config.onRefreshDecoration) ||
    Boolean(config.onDismissDecoration);
  if (hasActions) {
    const actionSep = document.createElement("span");
    actionSep.className = "ml-1 text-gray-300 dark:text-gray-600";
    actionSep.textContent = "·";
    meta.appendChild(actionSep);

    if (config.onAcceptDecoration) {
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className =
        "rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-primary)] transition-colors hover:bg-[var(--accent-primary)]/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/40";
      accept.textContent = "Accept";
      attachAction(accept, () =>
        config.onAcceptDecoration?.(data.scratchpadRunId, data.blockType),
      );
      meta.appendChild(accept);
    }

    if (config.onRefreshDecoration) {
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className =
        "rounded px-1.5 py-0.5 text-[11px] text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.05]";
      refresh.textContent = "Refresh";
      attachAction(refresh, () =>
        config.onRefreshDecoration?.(data.scratchpadRunId, data.blockType),
      );
      meta.appendChild(refresh);
    }

    if (config.onDismissDecoration) {
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className =
        "rounded px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]";
      dismiss.textContent = "Dismiss";
      attachAction(dismiss, () =>
        config.onDismissDecoration?.(data.scratchpadRunId, data.blockType),
      );
      meta.appendChild(dismiss);
    }
  }

  root.appendChild(meta);
  return root;
}

function buildSignature(decorations: readonly DiligenceDecorationData[]): string {
  return JSON.stringify(
    decorations.map((item) => ({
      scratchpadRunId: item.scratchpadRunId,
      version: item.version,
      blockType: item.blockType,
      updatedAt: item.updatedAt,
      headerText: item.headerText,
      bodyProse: item.bodyProse,
    })),
  );
}

/**
 * Maps diligence block-types to the H2/H3 heading text where their content
 * naturally belongs. When the notebook contains that heading, the decoration
 * is anchored AFTER it (inline flow, Notion pattern). When it doesn't,
 * decorations fall back to the top of the document.
 *
 * This eliminates the "wall of cards at top" problem: agent content now
 * appears where the user would expect it in the document.
 */
const BLOCK_TYPE_ANCHOR_HEADING: Record<string, string> = {
  founder: "Founders",
  product: "Product",
  funding: "Funding",
  news: "News",
  hiring: "Hiring",
  patent: "Patents",
  publicOpinion: "Public opinion",
  competitor: "Competitors",
  regulatory: "Regulatory",
  financial: "Financial",
};

function buildDecorationSet(
  doc: ProseMirrorNode,
  config: DiligenceDecorationPluginConfig,
): DecorationSet {
  const decorations = config.getDecorations();
  if (decorations.length === 0) {
    return DecorationSet.empty;
  }

  const registry = config.renderers ?? {};
  const widgets: Decoration[] = [];

  // Position cache per blockType — doc is walked once per unique block
  // type instead of once per decoration (O(U) vs O(D)).
  const positionCache = new Map<string, number>();
  const resolveFor = (item: DiligenceDecorationData): number => {
    const cached = positionCache.get(item.blockType);
    if (cached !== undefined) return cached;
    const headingText = BLOCK_TYPE_ANCHOR_HEADING[item.blockType];
    const anchorStrategies: AnchorStrategy[] = headingText
      ? [{ kind: "after-heading", text: headingText }, ...config.anchors]
      : config.anchors;
    const pos = resolveAnchorPosition(doc, anchorStrategies);
    positionCache.set(item.blockType, pos);
    return pos;
  };

  for (const item of decorations) {
    const widget = Decoration.widget(
      resolveFor(item),
      () =>
        renderDiligenceDecorationElement(item, { ...config, renderers: registry }),
      {
        key: `nodebench-diligence:${item.scratchpadRunId}:${item.version}:${item.blockType}`,
        side: -1,
      },
    );
    widgets.push(widget);
  }

  return DecorationSet.create(doc, widgets);
}

export function createDiligenceDecorationPlugin(
  config: DiligenceDecorationPluginConfig,
): Plugin {
  return new Plugin<DecorationSet>({
    key: diligenceDecorationPluginKey,
    state: {
      init(_, state) {
        return buildDecorationSet(state.doc, config);
      },
      apply(tr, current, _oldState, newState) {
        const shouldRefresh =
          Boolean(tr.getMeta(diligenceDecorationPluginKey)) || tr.docChanged;
        if (!shouldRefresh) {
          return current.map(tr.mapping, tr.doc);
        }
        return buildDecorationSet(newState.doc, config);
      },
    },
    props: {
      decorations(state) {
        return diligenceDecorationPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}
