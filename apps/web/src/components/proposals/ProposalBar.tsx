import React, { useMemo, useState } from "react";
import { useProposal } from "./ProposalProvider";

export type LineOp = { type: "eq" | "add" | "del"; line: string };

export type ProposalTarget = {
  blockId: string;
  nodeId?: string;
  ops: LineOp[];
  action: any; // original action payload (updateNode/createNode)
};

export function ProposalBar({
  targets,
  onDismiss,
}: {
  targets: ProposalTarget[];
  onDismiss: () => void;
}) {
  const { selections, selectAllAcrossBlocks, clearAllSelections } = useProposal();
  const [confirmAll, setConfirmAll] = useState(false);

  const counts = useMemo(() => {
    const blocks = targets.length;
    let totalAdds = 0;
    let totalDels = 0;
    let selected = 0;
    for (const t of targets) {
      t.ops.forEach((op, idx) => {
        if (op.type === "add") totalAdds++;
        if (op.type === "del") totalDels++;
        const checked = selections[t.blockId]?.[idx];
        if (checked) selected++;
      });
    }
    return { blocks, totalAdds, totalDels, selected };
  }, [targets, selections]);

  const applySelected = () => {
    try {
      const actions: any[] = [];
      for (const t of targets) {
        const sel = selections[t.blockId] || {};
        const merged: string[] = [];
        t.ops.forEach((op, idx) => {
          const accepted = sel[idx] ?? (op.type === "add");
          if (op.type === "eq") merged.push(op.line);
          else if (op.type === "del") { if (!accepted) merged.push(op.line); }
          else if (op.type === "add") { if (accepted) merged.push(op.line); }
        });
        const newMarkdown = merged.join("\n").replace(/\n{3,}/g, "\n\n").trim();
        const base = t.action?.nodeId
          ? { type: "updateNode", nodeId: t.action.nodeId, markdown: newMarkdown }
          : { type: "createNode", markdown: newMarkdown };
        actions.push({ ...base, anchorBlockId: t.blockId });
      }
      if (actions.length) {
        window.dispatchEvent(new CustomEvent("nodebench:applyActions", { detail: { actions } }));
        onDismiss?.();
      }
    } catch {
      // Silently ignore action dispatch errors
    }
  };

  const applyAll = () => {
    if (!confirmAll) {
      setConfirmAll(true);
      // Auto-cancel confirm after 2 seconds
      window.setTimeout(() => setConfirmAll(false), 2000);
      return;
    }
    try {
      const actions: any[] = targets.map((t) => {
        const base = t.action?.nodeId
          ? { type: "updateNode", nodeId: t.action.nodeId, markdown: t.action.markdown }
          : { type: "createNode", markdown: t.action.markdown };
        return { ...base, anchorBlockId: t.blockId };
      });
      if (actions.length) {
        window.dispatchEvent(new CustomEvent("nodebench:applyActions", { detail: { actions } }));
        onDismiss?.();
      }
    } catch {
      // Silently ignore action dispatch errors
    } finally {
      setConfirmAll(false);
    }
  };

  return (
    <div
      className="fixed top-3 right-3 z-[70] rounded-md border border-edge bg-surface/90 backdrop-blur px-3 py-2 shadow"
      role="region"
      aria-label="AI proposal controls"
    >
      <div className="text-xs text-content-secondary mb-1">
        {counts.blocks} block{counts.blocks !== 1 ? "s" : ""} • {counts.selected} selected • +{counts.totalAdds} −{counts.totalDels}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={applySelected}
          className="text-xs px-2 py-0.5 rounded bg-[var(--accent-primary)] text-white"
          title="Apply only the selected lines across all blocks"
        >
          Apply Selected
        </button>
        <div className="relative">
          <button
            onClick={applyAll}
            className={`text-xs px-2 py-0.5 rounded border ${confirmAll ? 'bg-red-600 text-white border-red-600' : ''}`}
            title={confirmAll ? "Click again to confirm Apply All" : "Apply all proposed changes"}
          >
            {confirmAll ? 'Confirm Apply All' : 'Apply All'}
          </button>
          {confirmAll && (
            <div className="absolute -bottom-7 right-0 text-xs bg-surface border border-edge rounded px-2 py-0.5 shadow">
              Click again to confirm
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-xs px-2 py-0.5 rounded border"
          title="Dismiss proposal"
        >
          Dismiss
        </button>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <button
          onClick={selectAllAcrossBlocks}
          className="text-xs px-1.5 py-0.5 rounded border"
          title="Select all lines across blocks"
        >
          Select All
        </button>
        <button
          onClick={clearAllSelections}
          className="text-xs px-1.5 py-0.5 rounded border"
          title="Clear all selections"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

