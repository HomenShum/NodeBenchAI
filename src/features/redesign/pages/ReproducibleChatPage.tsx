/**
 * Phase 3 — /redesign/chat/r/{hash} route.
 *
 * Renders an immutable answer cached in `redesignChatRuns by_hash`.
 * Same packet → same hash → same URL across deploys, so anyone with
 * the link sees what you saw. Closes the loop on Sprint 4 P2.13:
 * the Share button now produces a URL that actually serves a 200.
 *
 * Behavior:
 *   - Loading: skeleton card
 *   - Not found: helpful message + back-to-chat CTA
 *   - Complete: full AnswerPacket render with continuation + re-run CTAs
 *
 * Accessibility: doc title set to "{shortAnswer} · NodeBench" so the
 * tab name reflects the cached answer.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useRedesignChatByHash, type ChatAnswer } from "../hooks/useRedesignChatRun";
import { ChatAssistantMessage } from "../components/ChatAssistantMessage";
import type { RouterTier } from "../components/UniversalComposer";

interface ReproducibleChatPageProps {
  hash: string;
}

export function ReproducibleChatPage({ hash }: ReproducibleChatPageProps) {
  const navigate = useNavigate();
  const row = useRedesignChatByHash(hash);

  // Tab title reflects the cached answer
  useEffect(() => {
    if (row?.packet?.shortAnswer) {
      const prev = document.title;
      const txt = String(row.packet.shortAnswer).slice(0, 80);
      document.title = `${txt} · NodeBench`;
      return () => { document.title = prev; };
    }
  }, [row?.packet?.shortAnswer]);

  const packet: ChatAnswer | null = (row?.packet as ChatAnswer | undefined) ?? null;

  // Loading state — Convex query returns undefined while in flight
  if (row === undefined) {
    return (
      <div className="rd-stack" style={{ padding: "40px 24px", maxWidth: 880, margin: "0 auto" }}>
        <div className="rd-card" style={{ padding: 24 }}>
          <div className="rd-eyebrow">Reproducible answer · {hash}</div>
          <p className="rd-body" style={{ color: "var(--rd-ink-mute)", marginTop: 12 }}>
            Loading the cached run from Convex…
          </p>
        </div>
      </div>
    );
  }

  // Not found — hash doesn't match any run
  if (row === null || !packet) {
    return (
      <div className="rd-stack" style={{ padding: "60px 24px", maxWidth: 720, margin: "0 auto", gap: 16 }}>
        <div className="rd-card" style={{ padding: 24 }}>
          <div className="rd-eyebrow">Reproducible answer · {hash}</div>
          <h1 style={{ fontFamily: "var(--rd-font-display)", fontSize: 22, color: "var(--rd-ink-strong)", margin: "10px 0 8px" }}>
            No cached run found for this link
          </h1>
          <p className="rd-body" style={{ color: "var(--rd-ink-mute)", margin: 0 }}>
            Reproducible answers are cached by a deterministic hash of the
            prompt, tier, model, and grounded source URLs. The cache may
            have been pruned, the hash may be malformed, or the run may
            have errored before the packet was sealed. Start a new chat to
            generate a fresh, citable answer.
          </p>
          <div className="rd-row" style={{ gap: 8, marginTop: 16 }}>
            <button
              type="button"
              className="rd-btn rd-btn--primary rd-btn--sm"
              onClick={() => navigate("/redesign/chat")}
            >
              Open chat →
            </button>
            <button
              type="button"
              className="rd-btn rd-btn--quiet rd-btn--sm"
              onClick={() => navigate("/redesign")}
            >
              Back to home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cost = row.estimatedCostUsd;
  const latencyStr = row.totalLatencyMs
    ? row.totalLatencyMs < 1000
      ? `${row.totalLatencyMs}ms`
      : `${(row.totalLatencyMs / 1000).toFixed(1)}s`
    : null;
  const costStr = typeof cost === "number"
    ? cost >= 0.01 ? `$${cost.toFixed(3)}` : "<$0.01"
    : null;

  const created = new Date(row.createdAt);

  return (
    <div className="rd-stack" style={{ padding: "32px 24px 48px", maxWidth: 920, margin: "0 auto", gap: 16 }}>
      {/* Banner */}
      <div className="rd-card" style={{
        padding: "12px 16px",
        background: "var(--rd-accent-tint)",
        borderColor: "var(--rd-accent-ring)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <span className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)" }}>
          Reproducible answer
        </span>
        <span className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-mute)" }}>
          /r/{hash}
        </span>
        <span className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-soft)" }}>
          {row.tier} tier · {row.model} · {created.toISOString().slice(0, 10)}
          {latencyStr && ` · ${latencyStr}`}
          {costStr && ` · ${costStr}`}
        </span>
        <div className="rd-row" style={{ marginLeft: "auto", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="rd-btn rd-btn--quiet rd-btn--sm"
            onClick={() => {
              navigate(`/redesign/chat?q=${encodeURIComponent(row.prompt)}`);
            }}
            title="Run the original prompt again with current memory and sources"
          >
            Re-run prompt
          </button>
          <button
            type="button"
            className="rd-btn rd-btn--primary rd-btn--sm"
            data-testid="continue-reproducible-chat"
            aria-label="Continue this reproducible answer in live chat"
            onClick={() => {
              navigate(`/redesign/chat?continue=${encodeURIComponent(hash)}`);
            }}
            title="Open a live chat with this prompt, answer, and evidence carried forward"
          >
            Continue in chat →
          </button>
        </div>
      </div>

      {/* User prompt */}
      <article className="rd-card" style={{ padding: 16 }}>
        <div className="rd-eyebrow">Prompt</div>
        <p className="rd-body" style={{ marginTop: 6, color: "var(--rd-ink)" }}>{row.prompt}</p>
      </article>

      {/* Answer — the ONE ChatAssistantMessage anatomy, rendered as an
          immutable receipt (variant="receipt" suppresses the live action bar).
          The two renderers structurally cannot drift because both mount this
          same component. */}
      <ChatAssistantMessage
        packet={packet}
        tier={(row.tier ?? "auto") as RouterTier}
        variant="receipt"
        receiptLatencyMs={row.totalLatencyMs ?? null}
        receiptCostUsd={typeof row.estimatedCostUsd === "number" ? row.estimatedCostUsd : null}
      />

      {/* Footer */}
      <div className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-soft)", textAlign: "center" }}>
        Hash deterministic over {`{prompt, tier, model, shortAnswer, sortedEvidenceUrls}`} · same input → same URL
      </div>
    </div>
  );
}
