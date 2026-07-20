/**
 * ShareEntityButton — owner-facing "copy share link" for an entity.
 *
 * On click:
 *   1. Calls mintPublicShare({ resourceType: "entity", resourceSlug })
 *   2. Writes https://{origin}/share/{token} to clipboard
 *   3. Shows a brief "Copied" toast-style state
 *   4. Renders as a disabled minted link with copy + revoke affordances
 *      for the current session
 *
 * Design posture:
 *   - HONEST_STATUS: on failure shows the exact error, not a generic
 *     "something went wrong"
 *   - BOUND: the button cannot mint twice in the same session without
 *     explicit "re-mint" (prevents accidental duplicates)
 *   - user_privacy.md: only the owner sees this button (caller gates
 *     visibility via canEditNotebook prop)
 */

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";

export type ShareEntityButtonProps = {
  entitySlug: string;
  /** Optional default label for the share (e.g. entity display name). */
  defaultLabel?: string;
  className?: string;
};

type LocalState =
  | { kind: "idle" }
  | { kind: "minting" }
  | { kind: "ready"; url: string; token: string; label?: string }
  | { kind: "error"; message: string }
  | { kind: "revoked" };

export function ShareEntityButton({
  entitySlug,
  defaultLabel,
  className,
}: ShareEntityButtonProps) {
  const mintShare = useMutation(api.domains.product.publicShares.mintPublicShare);
  const revokeShare = useMutation(api.domains.product.publicShares.revokePublicShare);
  const [state, setState] = useState<LocalState>({ kind: "idle" });
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  async function handleMint() {
    setState({ kind: "minting" });
    try {
      const result = await mintShare({
        resourceType: "entity",
        resourceSlug: entitySlug,
        label: defaultLabel,
      });
      const url = `${origin}/share/${result.token}`;
      setState({ kind: "ready", url, token: result.token, label: defaultLabel });
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          setCopyNotice("Copied link");
          setTimeout(() => setCopyNotice(null), 1500);
        } catch {
          setCopyNotice("Link ready — select to copy");
        }
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleCopyAgain() {
    if (state.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopyNotice("Copied link");
      setTimeout(() => setCopyNotice(null), 1500);
    } catch (err) {
      setCopyNotice(err instanceof Error ? err.message : "Copy failed");
    }
  }

  async function handleRevoke() {
    if (state.kind !== "ready") return;
    try {
      await revokeShare({ token: state.token });
      setState({ kind: "revoked" });
      setTimeout(() => setState({ kind: "idle" }), 2_000);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div
      className={"flex flex-wrap items-center gap-2 text-xs " + (className ?? "")}
      aria-label="Share this entity"
    >
      {state.kind === "idle" ? (
        <button
          type="button"
          onClick={handleMint}
          className="inline-flex items-center rounded border border-white/[0.1] bg-white/[0.03] px-2.5 py-1 text-white/80 transition hover:border-white/[0.2] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d97757]"
        >
          Copy share link
        </button>
      ) : null}

      {state.kind === "minting" ? (
        <span className="text-white/60" aria-live="polite">
          Minting…
        </span>
      ) : null}

      {state.kind === "ready" ? (
        <>
          <code className="max-w-[20rem] truncate rounded border border-white/[0.08] bg-white/[0.02] px-2 py-1 font-mono text-[11px] text-white/70">
            {state.url}
          </code>
          <button
            type="button"
            onClick={handleCopyAgain}
            className="inline-flex items-center rounded border border-white/[0.1] bg-white/[0.03] px-2 py-1 text-white/80 hover:border-white/[0.2] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d97757]"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={handleRevoke}
            className="inline-flex items-center rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-200 hover:border-rose-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d97757]"
          >
            Revoke
          </button>
          {copyNotice ? (
            <span className="text-white/50" aria-live="polite">
              {copyNotice}
            </span>
          ) : null}
        </>
      ) : null}

      {state.kind === "revoked" ? (
        <span className="text-rose-200" aria-live="polite">
          Revoked.
        </span>
      ) : null}

      {state.kind === "error" ? (
        <span className="text-rose-200" role="alert">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
