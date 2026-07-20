/**
 * sharedRendererHelpers — tiny primitives reused by every DecorationRenderer.
 *
 * Pattern: generic renderer contract (PR9). Keep per-block renderers thin by
 *          sharing tier/time/action helpers. Each block file stays under
 *          ~200 lines of declarative DOM construction.
 *
 * See: src/features/entities/components/notebook/DiligenceDecorationPlugin.ts
 *      src/features/entities/components/notebook/renderers/FounderRenderer.tsx
 */

import type { DiligenceDecorationData } from "../DiligenceDecorationPlugin";

export function tierLabel(tier: DiligenceDecorationData["overallTier"]): string {
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

export function tierToneClass(tier: DiligenceDecorationData["overallTier"]): string {
  switch (tier) {
    case "verified":
      return "diligence-tier diligence-tier-verified";
    case "corroborated":
      return "diligence-tier diligence-tier-corroborated";
    case "single-source":
      return "diligence-tier diligence-tier-single";
    case "unverified":
      return "diligence-tier diligence-tier-unverified";
  }
}

export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const ageMs = Math.max(0, now - timestamp);
  if (ageMs < 60_000) return "just now";
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Build the shared header row: title + tier chip + updated timestamp.
 * Every renderer uses this so the top of each decoration reads identically.
 */
export function buildDecorationHeader(data: DiligenceDecorationData): HTMLElement {
  const header = document.createElement("div");
  header.className = "diligence-decoration-header";

  const title = document.createElement("h3");
  title.className = "diligence-decoration-title";
  title.textContent = data.headerText;
  header.appendChild(title);

  const chip = document.createElement("span");
  chip.className = tierToneClass(data.overallTier);
  chip.setAttribute("aria-label", `Evidence tier: ${tierLabel(data.overallTier)}`);
  const chipDot = document.createElement("span");
  chipDot.className = "diligence-tier-dot";
  chipDot.setAttribute("aria-hidden", "true");
  chip.appendChild(chipDot);
  chip.appendChild(document.createTextNode(tierLabel(data.overallTier)));
  header.appendChild(chip);

  const updated = document.createElement("span");
  updated.className = "diligence-decoration-updated";
  updated.textContent = `updated ${formatRelative(data.updatedAt)}`;
  header.appendChild(updated);

  return header;
}

/**
 * Build the shared action strip: Accept / Refresh / Dismiss.
 * Each button carries data-action + data-block + data-run-id so the editor's
 * capture-phase click handler can route them to the parent callbacks.
 */
export function buildDecorationActions(data: DiligenceDecorationData): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "diligence-decoration-actions";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "diligence-decoration-action";
  accept.textContent = "Accept into notebook";
  accept.setAttribute("data-action", "accept");
  accept.setAttribute("data-block", data.blockType);
  accept.setAttribute("data-run-id", data.scratchpadRunId);
  actions.appendChild(accept);

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "diligence-decoration-action";
  refresh.textContent = "Refresh";
  refresh.setAttribute("data-action", "refresh");
  refresh.setAttribute("data-block", data.blockType);
  refresh.setAttribute("data-run-id", data.scratchpadRunId);
  actions.appendChild(refresh);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className =
    "diligence-decoration-action diligence-decoration-action-muted";
  dismiss.textContent = "Dismiss";
  dismiss.setAttribute("data-action", "dismiss");
  dismiss.setAttribute("data-block", data.blockType);
  dismiss.setAttribute("data-run-id", data.scratchpadRunId);
  actions.appendChild(dismiss);

  return actions;
}

/**
 * Build a prose body from either bodyProse (paragraphs split on blank lines)
 * or a caller-supplied empty-state message.
 */
export function buildProseBody(
  bodyProse: string | undefined,
  emptyMessage: string,
): HTMLElement {
  const body = document.createElement("div");
  body.className = "diligence-decoration-body";

  if (bodyProse && bodyProse.trim().length > 0) {
    const paragraphs = bodyProse
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    for (const para of paragraphs) {
      const p = document.createElement("p");
      p.textContent = para;
      body.appendChild(p);
    }
  } else {
    const empty = document.createElement("p");
    empty.className = "diligence-decoration-empty";
    empty.textContent = emptyMessage;
    body.appendChild(empty);
  }

  return body;
}

/**
 * Build the root <div> wrapper with the generic decoration class + a
 * block-specific class + role=region + aria-label.
 */
export function buildDecorationRoot(
  data: DiligenceDecorationData,
  blockSpecificClass: string,
): HTMLElement {
  const root = document.createElement("div");
  root.className = `diligence-decoration ${blockSpecificClass}`;
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", data.headerText);
  return root;
}
