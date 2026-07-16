/**
 * ChatEmptyState — fresh-thread starter chips + resume deep-link.
 *
 * Used when ChatSurface has zero turns. Mirrors ChatGPT/Cursor/Claude's
 * "what would you like to do?" first-impression UX.
 */

interface ChatEmptyStateProps {
  onPick: (prompt: string) => void;
  starters?: Array<{ icon: string; title: string; prompt: string }>;
}

const STARTERS = [
  { icon: "🔍", title: "Run diligence on a company", prompt: "Run a banker-style diligence pass on the company I name. Focus on evidence, risks, and next action." },
  { icon: "📊", title: "Compare a short list", prompt: "Compare these entities on funding, hiring velocity, source quality, and strategic fit. Use the Founder/banker lens." },
  { icon: "📰", title: "What's new in my watchlist?", prompt: "Summarize what changed in my watchlist over the last 7 days. Group by signal class." },
];

export function ChatEmptyState({ onPick, starters = STARTERS }: ChatEmptyStateProps) {
  return (
    <div className="rd-chat-empty">
      <div className="rd-chat-empty__hero">
        <div className="rd-chat-empty__avatar" aria-hidden="true">✦</div>
        <h2 className="rd-chat-empty__h">What do you need to know?</h2>
        <p className="rd-chat-empty__sub">Ask from saved memory or start a sourced research run.</p>
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

    </div>
  );
}
