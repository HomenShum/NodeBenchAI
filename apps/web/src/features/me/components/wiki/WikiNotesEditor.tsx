/**
 * WikiNotesEditor — Zone 3: User-owned notes
 *
 * These notes are:
 * - Directly editable by the user
 * - Never silently rewritten by the AI
 * - Clearly distinct from generated content
 * - Read by AI as context but never overwritten
 *
 * Bounded: 64KB max per page
 */

import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { Save, Lock, FileText } from "lucide-react";
import { toast } from "sonner";
import { useConvexApi } from "@/lib/convexApi";

const MAX_BYTES = 65_536;

interface WikiNotesDoc {
  _id: string;
  body: string;
  bodyBytes: number;
  updatedAt: number;
}

export function WikiNotesEditor({
  ownerKey,
  pageId,
}: {
  ownerKey: string;
  pageId: string;
}) {
  const api = useConvexApi();
  const existing = useQuery(
    api?.domains?.product?.wikiStagingMutations?.getUserWikiNotes ?? "skip",
    api?.domains?.product?.wikiStagingMutations?.getUserWikiNotes
      ? { ownerKey, pageId: pageId as any }
      : "skip",
  ) as WikiNotesDoc | undefined | null;

  const upsertNotes = useMutation(
    api?.domains?.product?.wikiStagingMutations?.upsertUserWikiNotes ?? ("skip" as any),
  );

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Hydrate from server
  useEffect(() => {
    if (existing?.body !== undefined) {
      setDraft(existing.body);
      setHasChanges(false);
    }
  }, [existing?.body]);

  const bytes = new Blob([draft]).size;
  const isOverLimit = bytes > MAX_BYTES;
  const remainingBytes = Math.max(0, MAX_BYTES - bytes);

  const handleSave = useCallback(async () => {
    if (isOverLimit) {
      toast.error(`Notes exceed ${MAX_BYTES} bytes limit`);
      return;
    }
    if (!hasChanges) return;

    setSaving(true);
    try {
      await upsertNotes({ ownerKey, pageId: pageId as any, body: draft });
      setHasChanges(false);
      toast.success("Notes saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setSaving(false);
    }
  }, [draft, hasChanges, isOverLimit, ownerKey, pageId, upsertNotes]);

  return (
    <section
      data-testid="wiki-zone-user-notes"
      className="rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-4 dark:border-white/[0.1] dark:bg-white/[0.02]"
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Your notes
          </h3>
          <span
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
            title="AI can read these as context but will never overwrite them"
          >
            <Lock className="h-3 w-3" />
            Private
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`text-[11px] ${
              isOverLimit ? "text-rose-500" : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {bytes.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes
          </span>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !hasChanges || isOverLimit}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-primary)] px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-3 w-3" />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Editor */}
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setHasChanges(true);
        }}
        placeholder="Add your private notes here. These are never rewritten by the AI, but they can be read as context when regenerating the wiki page."
        className={`min-h-[120px] w-full resize-y rounded-md border bg-white px-3 py-2 text-sm outline-none transition dark:bg-white/[0.03] dark:text-gray-200 ${
          isOverLimit
            ? "border-rose-300 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 dark:border-rose-500/50"
            : "border-gray-200 focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] dark:border-white/10"
        }`}
        rows={6}
      />

      {/* Footer hints */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
        <span>Markdown supported</span>
        {isOverLimit ? (
          <span className="text-rose-500">
            Over limit by {(bytes - MAX_BYTES).toLocaleString()} bytes
          </span>
        ) : (
          <span>{remainingBytes.toLocaleString()} bytes remaining</span>
        )}
      </div>

      {hasChanges && !saving && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          You have unsaved changes
        </p>
      )}
    </section>
  );
}
