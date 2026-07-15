import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import type { Id } from "../../../../convex/_generated/dataModel";
import { useConvexApi } from "@/lib/convexApi";

import { AuthorityControl } from "./AuthorityControl";
import type {
  AuthorityGrantStatus,
  AuthorityMode,
} from "./authorityPresentation";
import {
  DelegatedReceiptRow,
  type AuthorityReceiptSummary,
} from "./DelegatedReceiptRow";

const RUN_TTL_MS = 2 * 60 * 60 * 1_000;
const WORKSPACE_TTL_MS = 24 * 60 * 60 * 1_000;
const RUN_OPERATION_CAP = 25;
const WORKSPACE_OPERATION_CAP = 100;

type AuthorityState = {
  mode: "review" | "run" | "workspace";
  grant: null | AuthorityGrant;
  lastGrant: null | AuthorityGrant;
  autonomyEndedReason: AuthorityGrantStatus | null;
};

type AuthorityGrant = {
  grantId: string;
  mode: "run" | "workspace";
  effectiveStatus: AuthorityGrantStatus;
  agentLabel?: string;
  maxOperations: number;
  usedOperations: number;
  expiresAt: number;
};

type ReceiptRow = AuthorityReceiptSummary & {
  entityId: Id<"productEntities">;
};

function newCreationKey(mode: Exclude<AuthorityMode, "review">): string {
  const random =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `notebook-authority:${mode}:${Date.now()}:${random}`;
}

function formatExpiry(expiresAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(expiresAt));
}

/**
 * Server-backed authority control for a real product notebook entity.
 * Shared/member/anonymous notebooks pass isOwner=false and remain review-only.
 */
export function NotebookAuthorityControl({
  entityId,
  runId,
  isOwner,
  className,
}: {
  entityId: Id<"productEntities">;
  runId?: Id<"agentScratchpads">;
  isOwner: boolean;
  className?: string;
}) {
  const api = useConvexApi();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authority = useQuery(
    api?.domains.agents.autonomy.grants.getAuthorityState ?? "skip",
    api && isOwner ? { entityId } : "skip",
  ) as AuthorityState | undefined;
  const receipts = useQuery(
    api?.domains.agents.autonomy.proposals.listReceipts ?? "skip",
    api && isOwner ? { entityId, limit: 8 } : "skip",
  ) as ReceiptRow[] | undefined;

  const createGrant = useMutation(
    api?.domains.agents.autonomy.grants.createGrant ?? ("skip" as never),
  );
  const pauseGrant = useMutation(
    api?.domains.agents.autonomy.grants.pauseGrant ?? ("skip" as never),
  );
  const resumeGrant = useMutation(
    api?.domains.agents.autonomy.grants.resumeGrant ?? ("skip" as never),
  );
  const revokeGrant = useMutation(
    api?.domains.agents.autonomy.grants.revokeGrant ?? ("skip" as never),
  );
  const undoReceipt = useMutation(
    api?.domains.agents.autonomy.commits.undoBlockReceipt ?? ("skip" as never),
  );

  const liveGrant = authority?.grant ?? null;
  const displayGrant = liveGrant ?? authority?.lastGrant ?? null;
  const mode: AuthorityMode = displayGrant?.mode ?? authority?.mode ?? "review";
  const grantStatus: AuthorityGrantStatus =
    displayGrant?.effectiveStatus ??
    authority?.autonomyEndedReason ??
    "inactive";
  const latestReceipt = useMemo(
    () => receipts?.find((receipt) => receipt.entityId === entityId) ?? null,
    [entityId, receipts],
  );

  const runAction = async (label: string, action: () => Promise<unknown>) => {
    if (pendingAction) return;
    setPendingAction(label);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Authority update failed.",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const handleModeChange = (nextMode: AuthorityMode) => {
    void runAction(`mode:${nextMode}`, async () => {
      if (liveGrant) {
        await revokeGrant({
          grantId: liveGrant.grantId,
          reason:
            nextMode === "review"
              ? "Owner returned to review mode"
              : "Authority mode changed",
        });
      }
      if (nextMode === "review") return;
      if (nextMode === "run" && !runId) {
        throw new Error("A concrete live intelligence run is required.");
      }

      const now = Date.now();
      await createGrant({
        creationKey: newCreationKey(nextMode),
        mode: nextMode,
        entityId: nextMode === "run" ? entityId : undefined,
        runId: nextMode === "run" ? runId : undefined,
        maxOperations:
          nextMode === "run" ? RUN_OPERATION_CAP : WORKSPACE_OPERATION_CAP,
        expiresAt: now + (nextMode === "run" ? RUN_TTL_MS : WORKSPACE_TTL_MS),
      });
    });
  };

  return (
    <div className={className}>
      <AuthorityControl
        mode={mode}
        grantStatus={grantStatus}
        isAuthenticated={isOwner}
        runAuthorityAvailable={Boolean(runId)}
        onModeChange={handleModeChange}
        onPause={
          liveGrant
            ? () =>
                void runAction("pause", () =>
                  pauseGrant({ grantId: liveGrant.grantId }),
                )
            : undefined
        }
        onResume={
          liveGrant
            ? () =>
                void runAction("resume", () =>
                  resumeGrant({ grantId: liveGrant.grantId }),
                )
            : undefined
        }
        onRevoke={
          liveGrant
            ? () =>
                void runAction("revoke", () =>
                  revokeGrant({
                    grantId: liveGrant.grantId,
                    reason: "Revoked by owner",
                  }),
                )
            : undefined
        }
        disabled={!api || !isOwner}
        isPending={Boolean(pendingAction)}
        agentLabel={displayGrant?.agentLabel}
        grantReference={displayGrant?.grantId}
        expiresAtLabel={
          displayGrant ? formatExpiry(displayGrant.expiresAt) : undefined
        }
        remainingOperations={
          displayGrant
            ? Math.max(
                0,
                displayGrant.maxOperations - displayGrant.usedOperations,
              )
            : undefined
        }
      />

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive"
        >
          {error}
        </p>
      ) : null}

      {latestReceipt ? (
        <DelegatedReceiptRow
          receipt={latestReceipt}
          className="mt-2"
          undoPending={pendingAction === "undo"}
          onUndo={
            latestReceipt.event === "commit" && latestReceipt.canUndoNow
              ? () =>
                  void runAction("undo", () =>
                    undoReceipt({ receiptId: latestReceipt.receiptId }),
                  )
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
