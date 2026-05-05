/**
 * ChatEmptyState — fresh-thread starter chips + resume deep-link.
 *
 * Used when ChatSurface has zero turns. Mirrors ChatGPT/Cursor/Claude's
 * "what would you like to do?" first-impression UX.
 */

interface ChatEmptyStateProps {
  onPick: (prompt: string) => void;
  onResume?: (threadId: string) => void;
  recentThread?: { id: string; entity: string; lastMessage: string; minutesAgo: number };
}

const STARTERS = [
  { icon: "🔍", title: "Run diligence on Orbital Labs", prompt: "Run a banker-style diligence pass on Orbital Labs. Focus on the healthcare design-partner angle." },
  { icon: "📊", title: "Compare Mercor vs Augmedix", prompt: "Compare Mercor vs Augmedix on hiring velocity, funding stage, and regulatory exposure. Use the Founder/banker lens." },
  { icon: "📰", title: "What's new in my watchlist?", prompt: "Summarize what changed in my watchlist over the last 7 days. Group by signal class." },
  { icon: "📥", title: "Build me a tear-sheet", prompt: "Generate a one-page tear-sheet for Anthropic with ownership, hiring, peer comps, news, and red flags." },
];

export function ChatEmptyState({ onPick, onResume, recentThread }: ChatEmptyStateProps) {
  return (
    <div className="rd-chat-empty">
      <div className="rd-chat-empty__hero">
        <div className="rd-chat-empty__avatar" aria-hidden="true">✦</div>
        <h2 className="rd-chat-empty__h">What would you like to know?</h2>
        <p className="rd-chat-empty__sub">Every question becomes a claim. Every answer joins the entity report.</p>
      </div>

      <div className="rd-chat-empty__chips">
        {STARTERS.map((s) => (
          <button
            key={s.title}
            type="button"
            className="rd-chat-empty__chip"
            onClick={() => onPick(s.prompt)}
          >
            <span className="rd-chat-empty__chip-icon" aria-hidden="true">{s.icon}</span>
            <span>
              <span className="rd-chat-empty__chip-title">{s.title}</span>
              <span className="rd-chat-empty__chip-hint">{s.prompt.slice(0, 70)}…</span>
            </span>
          </button>
        ))}
      </div>

      {recentThread && onResume && (
        <button
          type="button"
          className="rd-chat-empty__resume"
          onClick={() => onResume(recentThread.id)}
        >
          <span className="rd-chat-empty__resume-eyebrow">Resume thread</span>
          <span className="rd-chat-empty__resume-title">{recentThread.entity} · {recentThread.lastMessage}</span>
          <span className="rd-chat-empty__resume-meta">{recentThread.minutesAgo}m ago →</span>
        </button>
      )}

      <div className="rd-chat-empty__hint">
        <span className="rd-kbd">/</span> for commands · <span className="rd-kbd">@</span> to mention an entity · <span className="rd-kbd">⌘ Enter</span> to send
      </div>
    </div>
  );
}
