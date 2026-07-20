import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Save, X } from "lucide-react";
import { toast } from "sonner";
import PopoverMiniDocEditor from "@shared/editors/PopoverMiniDocEditor";

export default function DocumentMiniEditor({ documentId, onClose }: { documentId: Id<"documents">; onClose: () => void }) {
  const doc = useQuery(api.domains.documents.documents.getById, { documentId });
  const updateDocument = useMutation(api.domains.documents.documents.update);
  const nodesInDoc = useQuery(api.domains.knowledge.nodes.by_document, { docId: documentId });
  const addNode = useMutation(api.domains.knowledge.nodes.add);

  const [title, setTitle] = useState("");
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved" | "unsaved">("idle");
  const [isSaving, setIsSaving] = useState(false);
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    if (!doc) return;
    setTitle(doc.title ?? "");
    lastSavedRef.current = JSON.stringify({ title: doc.title ?? "" });
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    const current = JSON.stringify({ title });
    setSaveHint(current === lastSavedRef.current ? (saveHint === "saved" ? "saved" : "idle") : "unsaved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, doc]);

  const handleSave = useCallback(async () => {
    if (!doc) return;
    const next = (title || "").trim();
    if (next === (doc.title || "")) {
      setSaveHint("idle");
      return;
    }
    try {
      setIsSaving(true);
      setSaveHint("saving");
      await updateDocument({ id: doc._id, title: next || "Untitled" });
      lastSavedRef.current = JSON.stringify({ title: next || "Untitled" });
      setSaveHint("saved");
      setTimeout(() => setSaveHint("idle"), 1200);
      toast.success("Document updated");
    } catch (e) {
      console.error(e);
      toast.error("Failed to update document");
      setSaveHint("unsaved");
    } finally {
      setIsSaving(false);
    }
  }, [doc, title, updateDocument]);

  const handleQuickNoteSave = useCallback(async ({ text }: { text: string; json?: any }) => {
    try {
      const trimmed = (text || "").trim();
      if (!trimmed) {
        toast.info("Nothing to save");
        return;
      }
      // Compute an order that puts the new note at the top
      const orders = Array.isArray(nodesInDoc) ? nodesInDoc.map((n: any) => Number(n.order) || 0) : [];
      const minOrder = orders.length ? Math.min(...orders) : 0;
      const nextOrder = minOrder - 1;
      await addNode({
        documentId,
        parentId: undefined as any,
        order: nextOrder,
        type: "paragraph",
        json: undefined as any,
        text: trimmed,
      } as any);
      toast.success("Note added to document");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Failed to add note");
    }
  }, [addNode, documentId, nodesInDoc, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, onClose]);

  if (doc === undefined) {
    return (
      <div className="mt-2 border border-edge rounded-lg p-3 bg-surface-secondary">
        <div className="motion-safe:animate-pulse h-4 w-28 bg-surface rounded mb-2" />
        <div className="space-y-2">
          <div className="h-3 bg-surface rounded" />
          <div className="h-3 bg-surface rounded w-5/6" />
        </div>
      </div>
    );
  }
  if (!doc) return null;

  return (
    <div
      className="mt-2 rounded-lg p-3 bg-surface border border-edge/60 transition-all relative z-10 pointer-events-auto"
      data-inline-editor="true"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs text-content-muted">Press Esc to close · Ctrl/Cmd+S to save</div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-content-muted">
            {saveHint === "saving" ? "Saving…" : saveHint === "saved" ? "Saved" : saveHint === "unsaved" ? "Unsaved changes" : ""}
          </div>
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={saveHint !== "unsaved" || isSaving}
            className={`h-7 px-3 rounded-md flex items-center justify-center border text-[12px] ${saveHint === "unsaved" && !isSaving ? "bg-[var(--accent-primary)] text-white border-transparent hover:opacity-90" : "bg-surface-secondary text-content-secondary border-edge opacity-70 cursor-not-allowed"}`}
            title="Save changes"
          >
            <span className="inline-flex items-center gap-1"><Save className="w-3.5 h-3.5" /> Save</span>
          </button>
          <button
            type="button"
            onClick={() => onClose()}
            className="w-7 h-7 rounded-md flex items-center justify-center bg-surface-secondary hover:bg-surface-hover text-content-secondary border border-edge"
            title="Close"
            aria-label="Close editor"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {/* Quick title edit */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full text-sm bg-transparent border border-transparent rounded-md px-0 py-1 text-content focus:outline-none focus:ring-1 focus:ring-ring focus:border-indigo-500/30"
          placeholder="Untitled document"
        />

        {/* Quick note (Editor.js) */}
        <PopoverMiniDocEditor
          initialValue=""
          initialJson={null}
          onSave={handleQuickNoteSave}
          onCancel={onClose}
          title="Quick note"
          saveLabel="Save note"
          cancelLabel="Close"
        />
      </div>
    </div>
  );
}
