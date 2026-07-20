/**
 * FounderRenderer — prose-native DOM for the Founders diligence decoration.
 *
 * Pattern: prose-native rendering (PR3 + PR4 from the refactor checklist).
 *          Renders agent-identified founders as a quiet, notebook-style
 *          section — NOT a card grid. This keeps the live notebook's reading
 *          flow continuous instead of feeling like "editor + database widgets".
 *
 * Prior art:
 *   - Notion — inline database sections that read like prose
 *   - Wikipedia infoboxes — compact but quiet
 *   - Linear — prose-native activity entries
 *
 * See: docs/architecture/NOTEBOOK_REFACTOR_NOTES.md (PR3)
 *      docs/architecture/PROSEMIRROR_DECORATIONS.md
 *      .claude/rules/reexamine_design_reduction.md  (earned complexity)
 *      .claude/rules/reexamine_a11y.md  (focus rings, aria-label for actions)
 *      src/features/entities/components/notebook/DiligenceDecorationPlugin.ts
 *
 * This is the FIRST concrete renderer. It proves the contract. The shape
 * generalizes so Product/Funding/News/Patent renderers are one file each,
 * with no changes to the plugin or notebook shell.
 */

import type {
  DiligenceDecorationData,
  DecorationRenderer,
} from "../DiligenceDecorationPlugin";

/**
 * Data shape for a founder candidate, as it appears inside the decoration's
 * `bodyProse` or an extended payload field. For Phase 1 the renderer accepts
 * a plain `bodyProse` string; Phase 2 will extend the decoration data with a
 * typed `payload` field per block.
 *
 * For now we parse the minimal structure out of bodyProse or show the raw
 * prose if structure isn't present. That keeps this renderer honest while
 * the upstream schema solidifies.
 */

/**
 * Confidence tier → tiny human label (matches EvidenceChip).
 */
function tierLabel(tier: DiligenceDecorationData["overallTier"]): string {
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

function tierToneClass(tier: DiligenceDecorationData["overallTier"]): string {
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

function formatRelative(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  if (ageMs < 60_000) return "just now";
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Build the decoration DOM. Returns a raw HTMLElement — ProseMirror widget
 * decorations accept DOM nodes, not React components, so this renderer uses
 * vanilla DOM APIs rather than React.createElement.
 *
 * The element is not a <section> because that would introduce a landmark
 * region for screen readers — duplicating the EntityPage's own regions. A
 * plain <div role="region" aria-label="..."> keeps SR navigation calm.
 */
export function renderFounderDecoration(
  data: DiligenceDecorationData,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "diligence-decoration diligence-decoration-founder";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", data.headerText);

  // ── Header: "Founders · verified" tier chip + updated timestamp ──
  const header = document.createElement("div");
  header.className = "diligence-decoration-header";

  const title = document.createElement("h3");
  title.className = "diligence-decoration-title";
  // The decoration is read-only context, not a document heading — lower the
  // heading semantic weight by using a data attribute + role presentation
  // pattern. We still use h3 for visual hierarchy; SR uses aria-label.
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

  root.appendChild(header);

  // ── Body: prose-native. If bodyProse is empty, show the honest empty state. ──
  const body = document.createElement("div");
  body.className = "diligence-decoration-body";

  if (data.bodyProse && data.bodyProse.trim().length > 0) {
    // Render each paragraph as a <p>. Split on blank lines.
    const paragraphs = data.bodyProse
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
    empty.textContent =
      "No founders identified yet. Run a diligence pass or upload a team bio to populate this block.";
    body.appendChild(empty);
  }

  root.appendChild(body);

  // ── Actions: one quiet strip of buttons below the body. ──
  // These are "overlay actions" — they don't mutate the document. Clicks go
  // through callbacks wired by the plugin host (EntityNotebookLive).
  const actions = document.createElement("div");
  actions.className = "diligence-decoration-actions";

  // Accept into notebook — converts the decoration into frozen owned content.
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "diligence-decoration-action";
  accept.textContent = "Accept into notebook";
  accept.setAttribute("data-action", "accept");
  accept.setAttribute("data-block", data.blockType);
  accept.setAttribute("data-run-id", data.scratchpadRunId);
  actions.appendChild(accept);

  // Refresh from latest — triggers a new fan-out for this block.
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "diligence-decoration-action";
  refresh.textContent = "Refresh";
  refresh.setAttribute("data-action", "refresh");
  refresh.setAttribute("data-block", data.blockType);
  refresh.setAttribute("data-run-id", data.scratchpadRunId);
  actions.appendChild(refresh);

  // Dismiss — removes the decoration from this notebook's view (reversible).
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "diligence-decoration-action diligence-decoration-action-muted";
  dismiss.textContent = "Dismiss";
  dismiss.setAttribute("data-action", "dismiss");
  dismiss.setAttribute("data-block", data.blockType);
  dismiss.setAttribute("data-run-id", data.scratchpadRunId);
  actions.appendChild(dismiss);

  root.appendChild(actions);

  return root;
}

/**
 * DecorationRenderer contract export — drop into the plugin's registry.
 *
 * Usage:
 *   createDiligenceDecorationPlugin({
 *     renderers: { founder: FounderRenderer },
 *     anchors: [{ kind: "after-heading", text: "Overview" }, { kind: "top" }],
 *   });
 */
export const FounderRenderer: DecorationRenderer = {
  render: renderFounderDecoration,
};

export default FounderRenderer;
