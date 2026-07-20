/**
 * PendingEditHighlights - Visual indicators for pending edit locations in the editor
 * 
 * This component renders overlay highlights on the editor to show:
 * - Where pending edits will be applied (anchor regions)
 * - The type of operation (INSERT/DELETE/REPLACE)
 * - Which agent thread each edit belongs to
 * 
 * Works by finding anchor text in the editor and positioning absolute overlays.
 */

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import type { PendingEdit } from "../../hooks/usePendingEdits";
import type { BlockNoteEditor } from "@blocknote/core";

// Thread colors for multi-agent scenarios
// bg values are used in inline styles for absolute-positioned overlays, so they remain as style strings.
// Equivalent Tailwind classes: bg-blue-500/15, bg-emerald-500/15, etc.
const THREAD_COLORS = [
  { bg: "hsl(217 91% 60% / 0.15)", border: "#3b82f6" },   // blue-500
  { bg: "hsl(160 84% 39% / 0.15)", border: "#10b981" },   // emerald-500
  { bg: "hsl(271 91% 65% / 0.15)", border: "#a855f7" },   // purple-500
  { bg: "hsl(25 95% 53% / 0.15)", border: "#f97316" },    // orange-500
  { bg: "hsl(330 81% 60% / 0.15)", border: "#ec4899" },   // pink-500
  { bg: "hsl(173 80% 40% / 0.15)", border: "#14b8a6" },   // teal-500
];

interface HighlightPosition {
  editId: string;
  top: number;
  left: number;
  width: number;
  height: number;
  operationType: "INSERT" | "DELETE" | "REPLACE";
  threadColor: { bg: string; border: string };
  anchor: string;
  sectionHint?: string;
  isCurrentEdit: boolean;
}

interface PendingEditHighlightsProps {
  editor: BlockNoteEditor<any, any, any> | null;
  pendingEdits: PendingEdit[];
  currentEdit: PendingEdit | null;
  containerRef: React.RefObject<HTMLDivElement>;
}

export function PendingEditHighlights({
  editor,
  pendingEdits,
  currentEdit,
  containerRef,
}: PendingEditHighlightsProps) {
  const [highlights, setHighlights] = useState<HighlightPosition[]>([]);

  // Get unique thread IDs for color assignment
  const allThreadIds = useMemo(() => {
    const ids = new Set<string>();
    pendingEdits.forEach((e) => ids.add(e.agentThreadId));
    return Array.from(ids);
  }, [pendingEdits]);

  const getThreadColor = useCallback(
    (threadId: string) => {
      const index = allThreadIds.indexOf(threadId);
      return THREAD_COLORS[index % THREAD_COLORS.length];
    },
    [allThreadIds]
  );

  const getOperationType = useCallback(
    (edit: PendingEdit): "INSERT" | "DELETE" | "REPLACE" => {
      if (!edit.operation.search) return "INSERT";
      if (!edit.operation.replace) return "DELETE";
      return "REPLACE";
    },
    []
  );

  // Find anchor positions in the editor
  useEffect(() => {
    if (!editor || !containerRef.current) {
      setHighlights([]);
      return;
    }

    const container = containerRef.current;
    const pending = pendingEdits.filter((e) => e.status === "pending");
    
    if (pending.length === 0) {
      setHighlights([]);
      return;
    }

    // Use a timeout to allow editor to render
    const timer = setTimeout(() => {
      const newHighlights: HighlightPosition[] = [];
      
      // Get all text nodes in the editor
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      const textNodes: { node: Text; text: string; rect: DOMRect | null }[] = [];
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const text = node.textContent || "";
        if (text.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          textNodes.push({ node, text, rect: range.getBoundingClientRect() });
        }
      }

      // Find anchor matches for each pending edit
      for (const edit of pending) {
        const anchor = edit.operation.anchor;
        if (!anchor || anchor.length < 5) continue;

        // Search for anchor text in text nodes
        const fullText = textNodes.map((t) => t.text).join("");
        const anchorIndex = fullText.indexOf(anchor);
        
        if (anchorIndex === -1) continue;

        // Find which text node contains the anchor start
        let charCount = 0;
        for (const { node, text, rect } of textNodes) {
          const nodeStart = charCount;
          const nodeEnd = charCount + text.length;
          
          if (anchorIndex >= nodeStart && anchorIndex < nodeEnd) {
            // Found the node containing the anchor start
            if (rect) {
              const containerRect = container.getBoundingClientRect();
              newHighlights.push({
                editId: edit._id,
                top: rect.top - containerRect.top,
                left: rect.left - containerRect.left,
                width: Math.min(rect.width, 300),
                height: rect.height,
                operationType: getOperationType(edit),
                threadColor: getThreadColor(edit.agentThreadId),
                anchor: anchor.substring(0, 30),
                sectionHint: edit.operation.sectionHint,
                isCurrentEdit: currentEdit?._id === edit._id,
              });
            }
            break;
          }
          charCount = nodeEnd;
        }
      }

      setHighlights(newHighlights);
    }, 100);

    return () => clearTimeout(timer);
  }, [editor, pendingEdits, currentEdit, containerRef, getThreadColor, getOperationType]);

  // Don't render if no highlights
  if (highlights.length === 0 || !containerRef.current) return null;

  return createPortal(
    <>
      {highlights.map((h) => (
        <HighlightOverlay key={h.editId} {...h} />
      ))}
    </>,
    containerRef.current
  );
}

function HighlightOverlay({
  editId,
  top,
  left,
  width,
  height,
  operationType,
  threadColor,
  anchor,
  sectionHint,
  isCurrentEdit,
}: HighlightPosition) {
  const [showTooltip, setShowTooltip] = useState(false);

  const opBadgeColor = useMemo(() => {
    switch (operationType) {
      case "INSERT": return { bg: "#10b981", text: "white" };
      case "DELETE": return { bg: "#ef4444", text: "white" };
      case "REPLACE": return { bg: "#3b82f6", text: "white" };
    }
  }, [operationType]);

  return (
    <div
      style={{
        position: "absolute",
        top: top - 2,
        left: left - 4,
        width: width + 8,
        height: height + 4,
        backgroundColor: isCurrentEdit ? "hsl(258 90% 66% / 0.25)" : threadColor.bg, // violet-500/25
        borderLeft: `3px solid ${isCurrentEdit ? "#8b5cf6" : threadColor.border}`,
        borderRadius: "4px",
        pointerEvents: "auto",
        cursor: "pointer",
        transition: "all 0.2s ease",
        animation: isCurrentEdit ? "pulse-glow 1.5s infinite" : undefined,
        zIndex: 10,
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Operation badge */}
      <div
        style={{
          position: "absolute",
          top: -8,
          right: -4,
          fontSize: "9px",
          padding: "1px 4px",
          borderRadius: "3px",
          backgroundColor: opBadgeColor.bg,
          color: opBadgeColor.text,
          fontWeight: 600,
          boxShadow: "0 1px 2px hsl(0 0% 0% / 0.2)",
        }}
      >
        {operationType}
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div
          style={{
            position: "absolute",
            top: height + 8,
            left: 0,
            padding: "8px 12px",
            backgroundColor: "var(--background-secondary, #1e1e2e)",
            border: "1px solid var(--border-color, #333)",
            borderRadius: "6px",
            boxShadow: "0 4px 12px hsl(0 0% 0% / 0.2)",
            zIndex: 100,
            minWidth: "200px",
            maxWidth: "300px",
          }}
        >
          <div style={{ fontSize: "11px", color: "#8b5cf6", fontWeight: 500, marginBottom: "4px" }}>
            {isCurrentEdit ? "⚡ Applying Now" : "⏳ Pending Edit"}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-primary, #fff)", marginBottom: "4px" }}>
            <strong>Anchor:</strong> {anchor}...
          </div>
          {sectionHint && (
            <div style={{ fontSize: "11px", color: "var(--text-secondary, #888)" }}>
              📍 {sectionHint}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 0 0 hsl(258 90% 66% / 0.4); }
          50% { box-shadow: 0 0 8px 2px hsl(258 90% 66% / 0.6); }
        }
      `}</style>
    </div>
  );
}

export default PendingEditHighlights;

