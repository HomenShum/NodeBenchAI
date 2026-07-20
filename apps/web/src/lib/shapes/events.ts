import { Id } from "../../../convex/_generated/dataModel";

// Typed payload for quick prompt events used across the app
export type QuickPromptEventDetail = {
  prompt: string;
  documentId?: Id<"documents">;
};

// Dispatch a typed quick prompt event
export function dispatchQuickPrompt(detail: QuickPromptEventDetail): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent<QuickPromptEventDetail>("ai:quickPrompt", { detail }));
  } catch {
    // no-op
  }
}

// Typed payload for "chat with document" events
export type ChatWithDocumentEventDetail = {
  documentId: Id<"documents">;
  documentTitle?: string;
};

/**
 * Dispatch event to open Fast Agent Panel with a specific document as context
 * This opens the panel and pre-fills the context with the selected document
 */
export function dispatchChatWithDocument(detail: ChatWithDocumentEventDetail): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent<ChatWithDocumentEventDetail>("ai:chatWithDocument", { detail }));
  } catch {
    // no-op
  }
}

// Generic condition waiter with timeout; resolves even if condition not met by timeout
export async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 600,
  intervalMs = 16
): Promise<void> {
  if (typeof window === "undefined") return;
  const start = performance.now();
  return new Promise<void>((resolve) => {
    const check = () => {
      try {
        if (predicate()) return resolve();
      } catch {
        // ignore predicate errors
      }
      if (performance.now() - start >= timeoutMs) return resolve();
      setTimeout(check, intervalMs);
    };
    check();
  });
}

// Wait for the app's currently selected document to match the given id
export async function waitForDocumentFocus(
  targetId: Id<"documents">,
  getSelected: () => Id<"documents"> | null | undefined,
  opts?: { timeoutMs?: number; intervalMs?: number }
): Promise<void> {
  return waitForCondition(
    () => getSelected() === targetId,
    opts?.timeoutMs ?? 600,
    opts?.intervalMs ?? 16
  );
}
