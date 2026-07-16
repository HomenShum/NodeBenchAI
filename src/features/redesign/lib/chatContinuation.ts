import type { ChatAnswer } from "../fixtures";
import type { ConversationContextTurn } from "../hooks/useRedesignChatRun";

const MAX_CONVERSATION_CONTEXT_TURNS = 10;
const MAX_CONVERSATION_CONTEXT_CHARS = 2_000;

interface ConversationTurnInput {
  role: "user" | "assistant";
  text?: string;
  markdown?: string;
  packet?: ChatAnswer;
}

function sourceUrl(source: string): string | null {
  const match = source.match(/https?:\/\/[^\s)>\]]+/i);
  return match?.[0].replace(/[.,;:]+$/, "") ?? null;
}

function assistantContextText(turn: ConversationTurnInput): string {
  if (turn.packet) {
    return [
      turn.packet.shortAnswer,
      turn.packet.whyItMatters,
      turn.packet.risks.length ? `Risks: ${turn.packet.risks.join("; ")}` : "",
      turn.packet.nextAction ? `Next action: ${turn.packet.nextAction}` : "",
    ].filter(Boolean).join("\n");
  }
  return turn.markdown ?? "";
}

/** Parse only the two supported chat launches; reject path-like continuation values. */
export function parseChatLaunchParams(search: string): { prompt: string; continuationHash?: string } {
  const params = new URLSearchParams(search);
  const continuationHash = params.get("continue")?.trim();
  return {
    prompt: params.get("q")?.trim() ?? "",
    ...(continuationHash && /^[A-Za-z0-9_-]+$/.test(continuationHash)
      ? { continuationHash }
      : {}),
  };
}

/** Bounded role-aware transcript sent to the next run and persisted privately. */
export function buildConversationContext(
  turns: ConversationTurnInput[],
): ConversationContextTurn[] | undefined {
  const context = turns.flatMap((turn): ConversationContextTurn[] => {
    const text = (turn.role === "user" ? turn.text : assistantContextText(turn))?.trim();
    if (!text) return [];
    const sourceUrls = turn.role === "assistant"
      ? turn.packet?.evidence
          .map((row) => sourceUrl(row.source))
          .filter((url): url is string => Boolean(url))
          .slice(0, 5)
      : undefined;
    return [{
      role: turn.role,
      text: text.slice(0, MAX_CONVERSATION_CONTEXT_CHARS),
      ...(sourceUrls?.length ? { sourceUrls } : {}),
    }];
  }).slice(-MAX_CONVERSATION_CONTEXT_TURNS);
  return context.length ? context : undefined;
}
