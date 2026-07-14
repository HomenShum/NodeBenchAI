import { AlertCircle } from "lucide-react";

const ACTIVE_RUN_STATUSES = new Set(["pending", "queued", "running", "scheduled"]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "error", "failed", "cancelled"]);

export function isActiveAgentRunStatus(status: unknown): boolean {
  return typeof status === "string" && ACTIVE_RUN_STATUSES.has(status);
}

export function isTerminalAgentRunStatus(status: unknown): boolean {
  return typeof status === "string" && TERMINAL_RUN_STATUSES.has(status);
}

export function AgentRunErrorBanner({
  errorMessage,
  status,
}: {
  errorMessage?: string;
  status?: string;
}) {
  if (status !== "error" && status !== "failed") return null;

  return (
    <div
      className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
      data-testid="agent-run-error"
      role="alert"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        <div className="font-medium">Agent run stopped</div>
        <div className="mt-0.5 leading-relaxed">
          {errorMessage || "The agent failed before producing a response. Please try again."}
        </div>
      </div>
    </div>
  );
}
