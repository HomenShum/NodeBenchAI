/**
 * ResilienceSettings — operator-facing panel for budget caps + failover knobs.
 *
 * B-PR7 of the Autonomous Continuation System.
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Surfaces the `userBudgets` row introduced in B-PR6 so the operator can:
 *   - See today's token / cost consumption against their cap
 *   - Edit the daily caps (0 = no cap on that dimension)
 *   - Toggle enforcement on/off without losing the configured caps
 *   - See when the daily counters reset
 *
 * Pure presentation. The parent supplies the current `BudgetSnapshot`
 * (or `null` when not enrolled) and `onSave` / `onToggleEnforced`
 * callbacks. The Convex wiring (`useQuery(getBudgetForOwner)` +
 * `useMutation(upsertBudgetForOwner)`) lands in a follow-up wiring PR
 * so this component can be reused across modal / drawer / settings
 * surfaces without coupling to a specific call path.
 *
 * HONEST_STATUS:
 *   - When `snapshot` is `null` we render an explicit "not yet enrolled"
 *     state with the default caps shown as placeholders. Saving from
 *     that state auto-enrols on the backend (see B-PR6).
 *   - Cap-of-zero never renders as "0% used"; we surface "no cap" so
 *     the user does not misread an unbounded dimension as exhausted.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Gauge,
  ShieldCheck,
  ShieldOff,
  Timer,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════
// PUBLIC TYPES
// ════════════════════════════════════════════════════════════════════════

/** Snapshot of the user's current budget row. `null` = not enrolled. */
export interface BudgetSnapshot {
  dailyTokenCap: number;
  dailyCostCapUsd: number;
  consumedTokensToday: number;
  consumedCostUsdToday: number;
  resetAt: number;
  enforced: boolean;
}

export interface ResilienceSettingsValues {
  dailyTokenCap: number;
  dailyCostCapUsd: number;
  enforced: boolean;
}

export interface ResilienceSettingsProps {
  /** Current budget row, or `null` when the user has not been enrolled. */
  snapshot: BudgetSnapshot | null;
  /**
   * Save handler. Receives the proposed cap values. The parent should
   * call `upsertBudgetForOwner` (B-PR6). Resolved promise = success
   * UI state; rejection = parent should surface its own error toast.
   */
  onSave: (values: ResilienceSettingsValues) => Promise<void> | void;
  /** Optional pending flag controlled by the parent. */
  saving?: boolean;
  /** Optional error message surfaced after a failed save. */
  saveError?: string | null;
  /** className passthrough for layout integration. */
  className?: string;
}

// ════════════════════════════════════════════════════════════════════════
// DEFAULTS
// ════════════════════════════════════════════════════════════════════════

/** Mirrors `DEFAULT_DAILY_TOKEN_CAP` from `budgetGate.ts`. */
const DEFAULT_DAILY_TOKEN_CAP = 1_000_000;
/** Mirrors `DEFAULT_DAILY_COST_CAP_USD` from `budgetGate.ts`. */
const DEFAULT_DAILY_COST_CAP_USD = 5;

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

function clampPercent(numerator: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.max(0, Math.min(100, (numerator / cap) * 100));
}

function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  const seconds = totalSeconds % 60;
  return `${seconds}s`;
}

// ════════════════════════════════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════════════════════════════════

export function ResilienceSettings({
  snapshot,
  onSave,
  saving = false,
  saveError = null,
  className,
}: ResilienceSettingsProps) {
  // Form state mirrors the snapshot but allows the user to type freely.
  // We initialize from the snapshot or fall back to defaults when not enrolled.
  const initialValues = useMemo<ResilienceSettingsValues>(() => {
    if (snapshot) {
      return {
        dailyTokenCap: snapshot.dailyTokenCap,
        dailyCostCapUsd: snapshot.dailyCostCapUsd,
        enforced: snapshot.enforced,
      };
    }
    return {
      dailyTokenCap: DEFAULT_DAILY_TOKEN_CAP,
      dailyCostCapUsd: DEFAULT_DAILY_COST_CAP_USD,
      enforced: true,
    };
  }, [snapshot]);

  const [tokenCapInput, setTokenCapInput] = useState(
    String(initialValues.dailyTokenCap),
  );
  const [costCapInput, setCostCapInput] = useState(
    String(initialValues.dailyCostCapUsd),
  );
  const [enforced, setEnforced] = useState(initialValues.enforced);

  // Re-sync the form when the snapshot changes (e.g. after a save).
  useEffect(() => {
    setTokenCapInput(String(initialValues.dailyTokenCap));
    setCostCapInput(String(initialValues.dailyCostCapUsd));
    setEnforced(initialValues.enforced);
  }, [initialValues.dailyTokenCap, initialValues.dailyCostCapUsd, initialValues.enforced]);

  const parsedTokenCap = Number.parseInt(tokenCapInput, 10);
  const parsedCostCap = Number.parseFloat(costCapInput);
  const tokenCapValid = Number.isFinite(parsedTokenCap) && parsedTokenCap >= 0;
  const costCapValid = Number.isFinite(parsedCostCap) && parsedCostCap >= 0;
  const dirty =
    parsedTokenCap !== initialValues.dailyTokenCap ||
    parsedCostCap !== initialValues.dailyCostCapUsd ||
    enforced !== initialValues.enforced;
  const canSave = !saving && dirty && tokenCapValid && costCapValid;

  const handleSave = () => {
    if (!canSave) return;
    void onSave({
      dailyTokenCap: parsedTokenCap,
      dailyCostCapUsd: parsedCostCap,
      enforced,
    });
  };

  // ── Display values ───────────────────────────────────────────────
  const consumedTokens = snapshot?.consumedTokensToday ?? 0;
  const consumedCost = snapshot?.consumedCostUsdToday ?? 0;
  const tokenPct = snapshot
    ? clampPercent(consumedTokens, snapshot.dailyTokenCap)
    : 0;
  const costPct = snapshot
    ? clampPercent(consumedCost, snapshot.dailyCostCapUsd)
    : 0;
  const tokensExhausted = snapshot
    ? snapshot.dailyTokenCap > 0 &&
      consumedTokens >= snapshot.dailyTokenCap
    : false;
  const costExhausted = snapshot
    ? snapshot.dailyCostCapUsd > 0 &&
      consumedCost >= snapshot.dailyCostCapUsd
    : false;
  const msUntilReset = snapshot
    ? Math.max(snapshot.resetAt - Date.now(), 0)
    : 0;

  return (
    <div
      data-testid="resilience-settings"
      className={cn(
        "flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.2)] dark:border-white/[0.08] dark:bg-white/[0.04]",
        className,
      )}
    >
      {/* ─── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden />
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Resilience &amp; budget
        </h3>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
            snapshot
              ? snapshot.enforced
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/[0.1] dark:text-emerald-200"
                : "bg-slate-200 text-slate-700 dark:bg-white/[0.08] dark:text-slate-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-500/[0.1] dark:text-amber-200",
          )}
        >
          {snapshot ? (
            snapshot.enforced ? (
              <>
                <ShieldCheck className="h-3 w-3" aria-hidden />
                Enforced
              </>
            ) : (
              <>
                <ShieldOff className="h-3 w-3" aria-hidden />
                Disabled
              </>
            )
          ) : (
            <>
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Not yet enrolled
            </>
          )}
        </span>
      </div>

      {/* ─── Today's consumption ─────────────────────────────────── */}
      {snapshot ? (
        <div className="flex flex-col gap-2">
          <UsageRow
            icon={Zap}
            label="Tokens today"
            consumed={formatTokens(consumedTokens)}
            cap={
              snapshot.dailyTokenCap > 0
                ? formatTokens(snapshot.dailyTokenCap)
                : "no cap"
            }
            pct={tokenPct}
            exhausted={tokensExhausted}
            unbounded={snapshot.dailyTokenCap === 0}
          />
          <UsageRow
            icon={DollarSign}
            label="USD today"
            consumed={formatUsd(consumedCost)}
            cap={
              snapshot.dailyCostCapUsd > 0
                ? formatUsd(snapshot.dailyCostCapUsd)
                : "no cap"
            }
            pct={costPct}
            exhausted={costExhausted}
            unbounded={snapshot.dailyCostCapUsd === 0}
          />
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Timer className="h-3 w-3" aria-hidden />
            Daily counters reset in{" "}
            <span className="font-mono">{formatCountdown(msUntilReset)}</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          You'll be auto-enrolled with default caps the first time you save.
          Until then, agent requests run without budget enforcement.
        </p>
      )}

      {/* ─── Edit form ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 border-t border-slate-200/60 pt-3 dark:border-white/[0.06]">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Daily token cap
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={10_000}
              value={tokenCapInput}
              onChange={(e) => setTokenCapInput(e.target.value)}
              className={cn(
                "rounded-md border bg-white/90 px-2 py-1 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-white/[0.05] dark:text-slate-100",
                tokenCapValid
                  ? "border-slate-200 dark:border-white/[0.08]"
                  : "border-rose-400 dark:border-rose-400/60",
              )}
              aria-invalid={!tokenCapValid}
              aria-describedby="token-cap-help"
            />
            <span
              id="token-cap-help"
              className="text-[10px] text-slate-500 dark:text-slate-400"
            >
              0 = no cap on this dimension
            </span>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Daily USD cap
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              value={costCapInput}
              onChange={(e) => setCostCapInput(e.target.value)}
              className={cn(
                "rounded-md border bg-white/90 px-2 py-1 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-white/[0.05] dark:text-slate-100",
                costCapValid
                  ? "border-slate-200 dark:border-white/[0.08]"
                  : "border-rose-400 dark:border-rose-400/60",
              )}
              aria-invalid={!costCapValid}
              aria-describedby="cost-cap-help"
            />
            <span
              id="cost-cap-help"
              className="text-[10px] text-slate-500 dark:text-slate-400"
            >
              0 = no USD limit
            </span>
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={enforced}
            onChange={(e) => setEnforced(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/40 dark:border-white/[0.1]"
          />
          <span>
            Enforce caps — when off, the gate logs consumption but never denies a request.
          </span>
        </label>

        {saveError ? (
          <div className="flex items-start gap-1.5 rounded-md bg-rose-50/80 px-2 py-1.5 text-xs text-rose-800 dark:bg-rose-500/[0.08] dark:text-rose-200">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>{saveError}</span>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              canSave
                ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                : "cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-white/[0.05] dark:text-slate-500",
            )}
            aria-live="polite"
          >
            {saving ? (
              <>Saving…</>
            ) : dirty ? (
              <>Save changes</>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                Saved
              </>
            )}
          </button>
          {!tokenCapValid || !costCapValid ? (
            <span className="text-[11px] text-rose-700 dark:text-rose-300">
              Enter non-negative numbers in both fields.
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════════

interface UsageRowProps {
  icon: typeof Zap;
  label: string;
  consumed: string;
  cap: string;
  pct: number;
  exhausted: boolean;
  unbounded: boolean;
}

function UsageRow({
  icon: Icon,
  label,
  consumed,
  cap,
  pct,
  exhausted,
  unbounded,
}: UsageRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs">
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            exhausted
              ? "text-rose-500 dark:text-rose-400"
              : "text-slate-500 dark:text-slate-400",
          )}
          aria-hidden
        />
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {label}
        </span>
        <span className="ml-auto font-mono text-[11px] text-slate-600 dark:text-slate-300">
          {consumed} / {cap}
        </span>
      </div>
      {!unbounded ? (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-label={`${label} usage`}
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              exhausted
                ? "bg-rose-500"
                : pct >= 80
                  ? "bg-amber-500"
                  : "bg-emerald-500",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
