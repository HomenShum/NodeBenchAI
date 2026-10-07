import {
  Ban,
  ChevronDown,
  CirclePause,
  CirclePlay,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import {
  AUTHORITY_MODE_OPTIONS,
  AUTHORITY_OPERATION,
  getAuthorityStatusPresentation,
  getAuthoritySummary,
  RESTRICTED_AUTHORITY_OPERATIONS,
  type AuthorityGrantStatus,
  type AuthorityMode,
} from "./authorityPresentation";

export interface AuthorityControlProps {
  /** The server-backed authority selection. Review is the safe default. */
  mode: AuthorityMode;
  /** The durable grant state. Use inactive when mode is review or no grant exists. */
  grantStatus: AuthorityGrantStatus;
  /** Guests are review-only; delegated authority requires an authenticated owner. */
  isAuthenticated: boolean;
  /** Run authority must bind to a concrete server scratchpad at grant time. */
  runAuthorityAvailable?: boolean;
  onModeChange: (mode: AuthorityMode) => void;
  onPause?: () => void;
  onResume?: () => void;
  onRevoke?: () => void;
  disabled?: boolean;
  isPending?: boolean;
  agentLabel?: string;
  grantReference?: string;
  expiresAtLabel?: string;
  remainingOperations?: number | null;
  className?: string;
}

const STATUS_TONE_CLASSES = {
  neutral: "border-edge bg-surface-secondary text-content-muted",
  active:
    "border-[var(--accent-primary)]/30 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]",
  paused:
    "border-[var(--accent-primary)]/30 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]",
  ended: "border-edge bg-surface-secondary text-content-muted",
} as const;

export function AuthorityControl({
  mode,
  grantStatus,
  isAuthenticated,
  runAuthorityAvailable = true,
  onModeChange,
  onPause,
  onResume,
  onRevoke,
  disabled = false,
  isPending = false,
  agentLabel,
  grantReference,
  expiresAtLabel,
  remainingOperations,
  className,
}: AuthorityControlProps) {
  const [confirmWorkspace, setConfirmWorkspace] = useState(false);
  const authenticatedMode = isAuthenticated ? mode : "review";
  const authenticatedGrantStatus = isAuthenticated ? grantStatus : "inactive";
  const selectedMode =
    authenticatedGrantStatus === "revoked" ||
    authenticatedGrantStatus === "expired" ||
    authenticatedGrantStatus === "consumed"
      ? "review"
      : authenticatedMode;
  const status = getAuthorityStatusPresentation(
    authenticatedMode,
    authenticatedGrantStatus,
  );
  const isDelegatedMode = authenticatedMode !== "review";
  const actionsDisabled = disabled || isPending;
  const showGrantMetadata =
    isDelegatedMode &&
    Boolean(
      agentLabel ||
      grantReference ||
      expiresAtLabel ||
      remainingOperations !== undefined,
    );

  return (
    <section
      aria-labelledby="agent-authority-label"
      className={cn(
        "rounded-lg border border-edge bg-surface px-3 py-2.5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck
            className="h-4 w-4 shrink-0 text-[var(--accent-primary)]"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h3
              id="agent-authority-label"
              className="text-xs font-semibold text-content"
            >
              Live intelligence authority
            </h3>
            <p className="text-[11px] leading-4 text-content-muted">
              Choose who approves eligible existing-block replacements.
            </p>
          </div>
        </div>

        <span
          role="status"
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            STATUS_TONE_CLASSES[status.tone],
          )}
        >
          {isPending ? "Updating authority…" : status.label}
        </span>
      </div>

      <fieldset className="mt-2.5" disabled={disabled || isPending}>
        <legend className="sr-only">Agent authority mode</legend>
        <div
          className="grid grid-cols-3 gap-1 rounded-lg bg-surface-secondary p-1"
          role="radiogroup"
          aria-label="Agent authority mode"
        >
          {AUTHORITY_MODE_OPTIONS.map((option) => {
            const selected = selectedMode === option.id;
            const requiresSignIn = option.id !== "review" && !isAuthenticated;
            const requiresLiveRun =
              option.id === "run" && !runAuthorityAvailable;
            const optionDisabled =
              requiresSignIn || requiresLiveRun || disabled || isPending;
            const availabilityDescription = requiresSignIn
              ? "Sign in to grant"
              : requiresLiveRun
                ? "No live run available"
                : option.description;
            const inputId = `agent-authority-${option.id}`;

            return (
              <label
                key={option.id}
                htmlFor={inputId}
                className={cn(
                  "relative flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-1.5 py-2 text-center transition-colors sm:justify-start sm:px-2.5 sm:text-left",
                  "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-surface",
                  selected
                    ? "border-[var(--accent-primary)]/35 bg-surface text-content shadow-sm"
                    : "border-transparent text-content-muted hover:bg-surface-hover hover:text-content",
                  (requiresSignIn || requiresLiveRun) &&
                    "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  id={inputId}
                  name="agent-authority-mode"
                  type="radio"
                  value={option.id}
                  checked={selected}
                  disabled={optionDisabled}
                  onChange={() => {
                    if (optionDisabled) return;
                    if (
                      option.id === "workspace" &&
                      selectedMode !== "workspace"
                    ) {
                      setConfirmWorkspace(true);
                      return;
                    }
                    setConfirmWorkspace(false);
                    onModeChange(option.id);
                  }}
                  aria-describedby={`${inputId}-description`}
                  className="sr-only"
                />
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold leading-4">
                    {option.label}
                  </span>
                  <span id={`${inputId}-description`} className="sr-only">
                    {availabilityDescription}
                  </span>
                  <span
                    aria-hidden="true"
                    className="mt-0.5 hidden text-[10px] leading-3.5 text-content-muted sm:block"
                  >
                    {availabilityDescription}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {confirmWorkspace && isAuthenticated && (
        <div
          role="alert"
          className="mt-2.5 rounded-lg border border-[var(--accent-primary)]/30 bg-[var(--accent-primary-bg)] p-2.5 text-[11px] leading-4 text-content"
        >
          <p className="font-semibold">
            Grant authority across your notebook workspace?
          </p>
          <p className="mt-1 text-content-muted">
            This covers eligible Live intelligence replacements to existing
            blocks in all your NodeBench notebooks. It does not delegate new
            blocks, structural changes, slash-agent commands, network egress,
            file access, spend, publishing, sharing, export, deletion, or access
            changes.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                setConfirmWorkspace(false);
                onModeChange("workspace");
              }}
              disabled={actionsDisabled}
              className="inline-flex min-h-8 items-center rounded-md bg-[var(--accent-primary)] px-2.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Grant workspace authority
            </button>
            <button
              type="button"
              onClick={() => setConfirmWorkspace(false)}
              disabled={actionsDisabled}
              className="inline-flex min-h-8 items-center rounded-md border border-edge px-2.5 text-[11px] font-medium text-content-muted transition-colors hover:bg-surface-hover hover:text-content disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!isAuthenticated && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] leading-4 text-content-muted">
          <LockKeyhole className="h-3 w-3 shrink-0" aria-hidden="true" />
          Only the authenticated workspace owner can delegate authority. Shared,
          member, and guest sessions stay in Review every change.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-[11px] leading-4 text-content-muted">
          {getAuthoritySummary(authenticatedMode, authenticatedGrantStatus)}
        </p>

        {isDelegatedMode && authenticatedGrantStatus === "active" && (
          <div className="flex shrink-0 items-center gap-1">
            {onPause && (
              <button
                type="button"
                onClick={onPause}
                disabled={actionsDisabled}
                className="inline-flex min-h-8 items-center gap-1 rounded-md border border-edge px-2 text-[11px] font-medium text-content-muted transition-colors hover:bg-surface-hover hover:text-content disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CirclePause className="h-3.5 w-3.5" aria-hidden="true" />
                Pause
              </button>
            )}
            {onRevoke && (
              <button
                type="button"
                onClick={onRevoke}
                disabled={actionsDisabled}
                className="inline-flex min-h-8 items-center gap-1 rounded-md border border-edge px-2 text-[11px] font-medium text-content-muted transition-colors hover:border-destructive/25 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                Revoke
              </button>
            )}
          </div>
        )}

        {isDelegatedMode && authenticatedGrantStatus === "paused" && (
          <div className="flex shrink-0 items-center gap-1">
            {onResume && (
              <button
                type="button"
                onClick={onResume}
                disabled={actionsDisabled}
                className="inline-flex min-h-8 items-center gap-1 rounded-md bg-[var(--accent-primary)] px-2 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CirclePlay className="h-3.5 w-3.5" aria-hidden="true" />
                Resume
              </button>
            )}
            {onRevoke && (
              <button
                type="button"
                onClick={onRevoke}
                disabled={actionsDisabled}
                className="inline-flex min-h-8 items-center gap-1 rounded-md border border-edge px-2 text-[11px] font-medium text-content-muted transition-colors hover:border-destructive/25 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                Revoke
              </button>
            )}
          </div>
        )}
      </div>

      {showGrantMetadata && (
        <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-edge pt-2 text-[10px] leading-4 text-content-muted">
          {agentLabel && (
            <div className="flex gap-1">
              <dt>Agent</dt>
              <dd className="font-medium text-content">{agentLabel}</dd>
            </div>
          )}
          {grantReference && (
            <div className="flex min-w-0 max-w-full gap-1">
              <dt className="shrink-0">Grant</dt>
              <dd
                className="min-w-0 max-w-[min(18rem,70vw)] truncate font-mono text-content"
                title={grantReference}
                aria-label={`Grant ${grantReference}`}
              >
                {grantReference}
              </dd>
            </div>
          )}
          {expiresAtLabel && (
            <div className="flex gap-1">
              <dt>Expires</dt>
              <dd className="font-medium text-content">{expiresAtLabel}</dd>
            </div>
          )}
          {remainingOperations !== undefined && (
            <div className="flex gap-1">
              <dt>Operations left</dt>
              <dd className="font-medium text-content">
                {remainingOperations === null
                  ? "Not reported"
                  : remainingOperations}
              </dd>
            </div>
          )}
        </dl>
      )}

      <details className="group mt-2 border-t border-edge pt-2">
        <summary className="flex min-h-7 w-fit cursor-pointer list-none items-center gap-1 rounded px-1 text-[11px] font-medium text-content-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Scope and safeguards
          <ChevronDown
            className="h-3 w-3 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-2 grid gap-3 text-[11px] leading-4 text-content-muted sm:grid-cols-2">
          <div>
            <p className="font-semibold text-content">Delegated operation</p>
            <code className="mt-1 inline-block rounded bg-[var(--accent-primary-bg)] px-1.5 py-0.5 font-mono text-[var(--accent-primary)]">
              {AUTHORITY_OPERATION}
            </code>
            <p className="mt-1">
              Only one verified or corroborated existing block's content and
              preserved source references may change. Unverified and
              single-source intelligence stays on the explicit path. Ownership,
              evidence, operation cap, expiry, revocation, and block revision
              are rechecked at commit.
            </p>
            <p className="mt-1">
              Run authority is bound to this notebook and its live intelligence
              run. Workspace authority covers existing blocks in all notebooks
              you own.
            </p>
          </div>
          <div>
            <p className="font-semibold text-content">Not delegated here</p>
            <p className="mt-1">
              {RESTRICTED_AUTHORITY_OPERATIONS.join(" · ")}
            </p>
            <p className="mt-1">
              Slash-agent commands and other agent workflows keep their existing
              approval behavior; this control does not govern them. A successful
              eligible commit records its grant, agent, validation, version, and
              undo reference.
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

export default AuthorityControl;
