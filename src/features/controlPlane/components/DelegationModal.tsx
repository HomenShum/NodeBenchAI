/**
 * DelegationModal — Handoff from packet to Claude Code, OpenClaw, or internal worker.
 *
 * Features:
 * - Target selection (Claude Code / OpenClaw / Internal Worker)
 * - Task scope definition (goal, constraints, success criteria)
 * - Lineage tracking (parent packet ID, delegation chain)
 * - Briefing preview + copy
 * - One-click delegate with status feedback
 */

import { memo, useState, useCallback } from "react";
import {
  ArrowRight,
  Bot,
  Code,
  Cpu,
  Copy,
  Check,
  X,
  AlertTriangle,
  FileText,
  Link2,
  Shield,
  Target,
  Clock,
  Send,
} from "lucide-react";
import { DialogOverlay } from "@/shared/components/DialogOverlay";

// ─── Types ──────────────────────────────────────────────────────────────────

type DelegateTarget = "claude-code" | "openclaw" | "internal-worker";

interface DelegationBrief {
  target: DelegateTarget;
  goal: string;
  scope: string;
  constraints: string[];
  successCriteria: string[];
  parentPacketId: string | null;
  lineageDepth: number;
}

interface DelegationModalProps {
  isOpen: boolean;
  onClose: () => void;
  packetId?: string | null;
  packetSummary?: string;
}

// ─── Target metadata ─────────────────────────────────────────────────────────

const TARGETS: {
  id: DelegateTarget;
  label: string;
  icon: typeof Bot;
  description: string;
  capabilities: string[];
}[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    icon: Code,
    description: "Deep code-level agent with file system access and terminal execution",
    capabilities: [
      "Read and write files",
      "Run terminal commands",
      "Search codebase",
      "Edit and refactor code",
    ],
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    icon: Bot,
    description: "Multi-source research agent with web browsing and data extraction",
    capabilities: [
      "Web search and browse",
      "Document extraction",
      "Data pipeline execution",
      "Cross-reference verification",
    ],
  },
  {
    id: "internal-worker",
    label: "Internal Worker",
    icon: Cpu,
    description: "NodeBench built-in worker for structured tasks and pipeline steps",
    capabilities: [
      "Run Convex actions",
      "Execute search pipelines",
      "Generate packets",
      "Refresh and recompile",
    ],
  },
];

// ─── Subcomponents ───────────────────────────────────────────────────────────

function TargetCard({
  target,
  isSelected,
  onSelect,
}: {
  target: (typeof TARGETS)[number];
  isSelected: boolean;
  onSelect: () => void;
}) {
  const Icon = target.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition-all ${
        isSelected
          ? "border-accent-primary/30 bg-accent-primary/[0.06]"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
      }`}
      aria-pressed={isSelected}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${isSelected ? "text-accent-primary" : "text-content-muted"}`} />
        <span className="text-sm font-semibold text-content">{target.label}</span>
      </div>
      <p className="text-[11px] text-content-muted leading-relaxed mb-2">
        {target.description}
      </p>
      <div className="flex flex-wrap gap-1">
        {target.capabilities.map((cap) => (
          <span
            key={cap}
            className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[10px] text-content-muted"
          >
            {cap}
          </span>
        ))}
      </div>
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

function DelegationModalInner({
  isOpen,
  onClose,
  packetId = null,
  packetSummary = "",
}: DelegationModalProps) {
  const [target, setTarget] = useState<DelegateTarget>("claude-code");
  const [goal, setGoal] = useState("");
  const [scope, setScope] = useState("");
  const [constraintInput, setConstraintInput] = useState("");
  const [constraints, setConstraints] = useState<string[]>([
    "Do not modify production data",
    "Report all actions taken",
  ]);
  const [criteriaInput, setCriteriaInput] = useState("");
  const [successCriteria, setSuccessCriteria] = useState<string[]>([]);
  const [isDelegating, setIsDelegating] = useState(false);
  const [delegationResult, setDelegationResult] = useState<"success" | "error" | null>(null);
  const [copied, setCopied] = useState(false);

  const addConstraint = useCallback(() => {
    const v = constraintInput.trim();
    if (!v) return;
    setConstraints((prev) => [...prev, v]);
    setConstraintInput("");
  }, [constraintInput]);

  const removeConstraint = useCallback((idx: number) => {
    setConstraints((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const addCriteria = useCallback(() => {
    const v = criteriaInput.trim();
    if (!v) return;
    setSuccessCriteria((prev) => [...prev, v]);
    setCriteriaInput("");
  }, [criteriaInput]);

  const removeCriteria = useCallback((idx: number) => {
    setSuccessCriteria((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const buildBrief = useCallback((): DelegationBrief => {
    return {
      target,
      goal: goal.trim() || "Research and extend the current packet",
      scope: scope.trim() || "Full packet context with evidence and sources",
      constraints,
      successCriteria:
        successCriteria.length > 0
          ? successCriteria
          : ["All claims have dated, attributable sources", "No hallucinated facts"],
      parentPacketId: packetId,
      lineageDepth: packetId ? 1 : 0,
    };
  }, [target, goal, scope, constraints, successCriteria, packetId]);

  const handleDelegate = useCallback(async () => {
    setIsDelegating(true);
    setDelegationResult(null);
    try {
      const brief = buildBrief();
      // In production, this calls the shared-context delegate endpoint
      // For now, simulate delegation
      await new Promise((resolve) => setTimeout(resolve, 1200));
      console.log("[DelegationModal] Delegated:", brief);
      setDelegationResult("success");
    } catch {
      setDelegationResult("error");
    } finally {
      setIsDelegating(false);
    }
  }, [buildBrief]);

  const handleCopyBrief = useCallback(() => {
    const brief = buildBrief();
    const text = [
      `# Delegation Brief`,
      ``,
      `**Target:** ${TARGETS.find((t) => t.id === brief.target)?.label}`,
      `**Goal:** ${brief.goal}`,
      `**Scope:** ${brief.scope}`,
      `**Parent Packet:** ${brief.parentPacketId ?? "none"}`,
      `**Lineage Depth:** ${brief.lineageDepth}`,
      ``,
      `## Constraints`,
      ...brief.constraints.map((c) => `- ${c}`),
      ``,
      `## Success Criteria`,
      ...brief.successCriteria.map((c) => `- ${c}`),
      ``,
      `## Packet Summary`,
      packetSummary || "No summary available",
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [buildBrief, packetSummary]);

  return (
    <DialogOverlay
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Delegation Modal"
      closeOnBackdrop={false}
      backdropClassName="bg-black/60 backdrop-blur-sm"
      contentClassName="mx-4 w-full max-w-2xl"
    >
      <div className="relative w-full max-h-[85vh] overflow-y-auto rounded-2xl border border-white/[0.08] bg-surface-secondary p-6 shadow-2xl">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-content-muted hover:bg-white/[0.06] hover:text-content transition-colors"
          aria-label="Close delegation modal"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <ArrowRight className="h-5 w-5 text-accent-primary" />
          <div>
            <h2 className="text-lg font-semibold text-content">
              Delegate Packet
            </h2>
            <p className="text-xs text-content-muted">
              Hand off to an agent with task scope, constraints, and lineage tracking
            </p>
          </div>
        </div>

        {/* Packet context */}
        {packetId && (
          <div className="mb-4 rounded-lg border border-white/[0.06] bg-black/20 p-3">
            <div className="flex items-center gap-2 text-[10px] text-content-muted">
              <FileText className="h-3 w-3" />
              <span>Parent Packet: {packetId}</span>
              <Link2 className="h-3 w-3 ml-2" />
              <span>Lineage Depth: 1</span>
            </div>
            {packetSummary && (
              <p className="mt-1.5 text-xs text-content-secondary line-clamp-2">
                {packetSummary}
              </p>
            )}
          </div>
        )}

        {/* Target selection */}
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-2">
            Delegate To
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {TARGETS.map((t) => (
              <TargetCard
                key={t.id}
                target={t}
                isSelected={target === t.id}
                onSelect={() => setTarget(t.id)}
              />
            ))}
          </div>
        </div>

        {/* Goal */}
        <div className="mb-4">
          <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-1.5 block">
            Goal
          </label>
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What should the agent accomplish?"
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
          />
        </div>

        {/* Scope */}
        <div className="mb-4">
          <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-1.5 block">
            Scope
          </label>
          <textarea
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="What context and evidence should the agent work with?"
            rows={2}
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-content placeholder:text-content-muted resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
          />
        </div>

        {/* Constraints */}
        <div className="mb-4">
          <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-1.5 block">
            Constraints
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {constraints.map((c, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/15 bg-amber-500/[0.04] px-2.5 py-1 text-[11px] text-amber-300"
              >
                <Shield className="h-2.5 w-2.5" />
                {c}
                <button
                  type="button"
                  onClick={() => removeConstraint(i)}
                  className="ml-0.5 text-amber-400/60 hover:text-amber-300"
                  aria-label={`Remove constraint: ${c}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={constraintInput}
              onChange={(e) => setConstraintInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addConstraint();
              }}
              placeholder="Add constraint..."
              className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
            <button
              type="button"
              onClick={addConstraint}
              disabled={!constraintInput.trim()}
              className="rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-1.5 text-xs text-content-muted hover:bg-white/[0.08] disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>

        {/* Success criteria */}
        <div className="mb-5">
          <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-1.5 block">
            Success Criteria
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {successCriteria.map((c, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/15 bg-emerald-500/[0.04] px-2.5 py-1 text-[11px] text-emerald-300"
              >
                <Target className="h-2.5 w-2.5" />
                {c}
                <button
                  type="button"
                  onClick={() => removeCriteria(i)}
                  className="ml-0.5 text-emerald-400/60 hover:text-emerald-300"
                  aria-label={`Remove criteria: ${c}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={criteriaInput}
              onChange={(e) => setCriteriaInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCriteria();
              }}
              placeholder="Add success criteria..."
              className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
            <button
              type="button"
              onClick={addCriteria}
              disabled={!criteriaInput.trim()}
              className="rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-1.5 text-xs text-content-muted hover:bg-white/[0.08] disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>

        {/* Delegation result */}
        {delegationResult === "success" && (
          <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3 text-xs text-emerald-300">
            <Check className="inline h-3.5 w-3.5 mr-1.5" />
            Delegation sent to {TARGETS.find((t) => t.id === target)?.label}. Track progress in the
            Actions feed.
          </div>
        )}
        {delegationResult === "error" && (
          <div className="mb-4 rounded-lg border border-rose-500/20 bg-rose-500/[0.04] p-3 text-xs text-rose-300">
            <AlertTriangle className="inline h-3.5 w-3.5 mr-1.5" />
            Delegation failed. Check console for details.
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-white/[0.06] pt-4">
          <button
            type="button"
            onClick={handleCopyBrief}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-xs font-medium text-content-muted transition-colors hover:bg-white/[0.08] hover:text-content"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copy Brief
              </>
            )}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/[0.06] bg-white/[0.04] px-4 py-2 text-xs font-medium text-content-muted hover:bg-white/[0.08] hover:text-content"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelegate}
              disabled={isDelegating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary/90 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-primary disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {isDelegating ? "Delegating..." : "Delegate"}
            </button>
          </div>
        </div>
      </div>
    </DialogOverlay>
  );
}

export const DelegationModal = memo(DelegationModalInner);
export default DelegationModal;
