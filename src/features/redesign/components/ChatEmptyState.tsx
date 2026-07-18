/**
 * ChatEmptyState — fresh-thread starter chips + resume deep-link.
 *
 * Used when ChatSurface has zero turns. Mirrors ChatGPT/Cursor/Claude's
 * "what would you like to do?" first-impression UX.
 *
 * Chip icons are inline stroke SVGs (the CardStack / composer house style),
 * not emoji: emoji render with platform-specific color glyphs that ignore
 * the theme and clash with every other icon on the surface.
 */

import type { ReactNode } from "react";

interface ChatEmptyStateProps {
  onPick: (prompt: string) => void;
  starters?: Array<{ icon: ReactNode; title: string; prompt: string }>;
}

function StarterIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Shared starter glyphs — one place so live and default chip sets match. */
export const STARTER_ICONS = {
  search: (
    <StarterIcon>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </StarterIcon>
  ),
  compare: (
    <StarterIcon>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </StarterIcon>
  ),
  watch: (
    <StarterIcon>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </StarterIcon>
  ),
  summarize: (
    <StarterIcon>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </StarterIcon>
  ),
  promote: (
    <StarterIcon>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </StarterIcon>
  ),
  export: (
    <StarterIcon>
      <path d="M12 3v12" />
      <path d="m17 8-5-5-5 5" />
      <path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
    </StarterIcon>
  ),
} as const;

const STARTERS = [
  { icon: STARTER_ICONS.search, title: "Run diligence on a company", prompt: "Run a banker-style diligence pass on the company I name. Focus on evidence, risks, and next action." },
  { icon: STARTER_ICONS.compare, title: "Compare a short list", prompt: "Compare these entities on funding, hiring velocity, source quality, and strategic fit. Use the Founder/banker lens." },
  { icon: STARTER_ICONS.watch, title: "What's new in my watchlist?", prompt: "Summarize what changed in my watchlist over the last 7 days. Group by signal class." },
];

/**
 * "Ember threads" — the landing's signature composition. Abstract source
 * nodes whose threads converge into the composer below: the product truth
 * (answers drawing on evidence) as form, not copy. Deterministic geometry
 * (no randomness — replay-stable screenshots), aria-hidden decoration, and
 * the draw-in/drift motion lives entirely in CSS so prefers-reduced-motion
 * can flatten it to the static composition.
 */
const EMBER_NODES: Array<{ x: number; y: number }> = [
  { x: 96, y: 96 },
  { x: 232, y: 34 },
  { x: 598, y: 48 },
  { x: 756, y: 128 },
  { x: 152, y: 296 },
  { x: 694, y: 312 },
];
// Past the viewBox floor on purpose: threads clip at the SVG's bottom edge
// still converging, so they read as running INTO the composer dock below
// rather than dying in the empty band.
const EMBER_FOCUS = { x: 420, y: 560 };

function EmberThreads() {
  return (
    <svg
      className="rd-ember"
      viewBox="0 0 840 520"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      data-testid="ember-threads"
    >
      {EMBER_NODES.map((node, i) => (
        <path
          key={`t-${node.x}`}
          className="rd-ember__thread"
          style={{ ["--i" as string]: i }}
          pathLength={1}
          d={`M ${node.x} ${node.y} Q ${(node.x + EMBER_FOCUS.x) / 2} ${
            node.y + (EMBER_FOCUS.y - node.y) * 0.72
          } ${EMBER_FOCUS.x} ${EMBER_FOCUS.y}`}
        />
      ))}
      {EMBER_NODES.map((node, i) => (
        <circle
          key={`n-${node.x}`}
          className="rd-ember__node"
          style={{ ["--i" as string]: i }}
          cx={node.x}
          cy={node.y}
          r={3}
        />
      ))}
    </svg>
  );
}

export function ChatEmptyState({ onPick, starters = STARTERS }: ChatEmptyStateProps) {
  return (
    <div className="rd-chat-empty">
      <EmberThreads />
      <div className="rd-chat-empty__hero">
        <h2 className="rd-chat-empty__h">What do you need to know?</h2>
        <p className="rd-chat-empty__tag">
          Answers with <em>receipts</em>.
        </p>
      </div>

      <div className="rd-chat-empty__chips">
        {starters.slice(0, 3).map((s) => (
          <button
            key={s.title}
            type="button"
            className="rd-chat-empty__chip"
            onClick={() => onPick(s.prompt)}
          >
            <span className="rd-chat-empty__chip-icon" aria-hidden="true">{s.icon}</span>
            <span>
              <span className="rd-chat-empty__chip-title">{s.title}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Value before identity: a real, persisted production answer — prompt,
          evidence rows, model, cost, deterministic hash — reachable in one
          click with no account and no spend. The route carries the answer
          into a live composer, so the example IS a usable starting point.
          Swap the hash when a stronger showcase receipt is minted. */}
      <a className="rd-chat-empty__example" href="/redesign/chat/r/36imyvtrf0d3">
        See a real answered example, receipts included →
      </a>

    </div>
  );
}
