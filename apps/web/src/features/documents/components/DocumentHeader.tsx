import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc } from "../../../../convex/_generated/dataModel";
import { PresenceIndicator } from "@/shared/components/PresenceIndicator";
import { DocumentBreadcrumbs } from "./DocumentBreadcrumbs";
import {
  MoreHorizontal,
  Star,
  Share,
  Archive,
  Trash2,
  Globe,
  Lock,
  Image as ImageIcon,
  Smile,
  Sparkles,
  Loader2,
  ArrowLeft
} from "lucide-react";

interface DocumentHeaderProps {
  document: Doc<"documents">;
}

// Component to display who last edited the document
function LastEditorDisplay({ userId }: { userId: string }) {
  const user = useQuery(api.domains.documents.documents.getUserById, { userId: userId as any });

  if (!user) {
    return (
      <span className="text-xs text-content-muted opacity-60 italic inline-flex items-center gap-1">
        by <span className="inline-block w-16 h-2.5 bg-surface-hover rounded motion-safe:animate-pulse" />
      </span>
    );
  }

  return (
    <span className="text-xs text-content-muted opacity-60 italic" title={`User ID: ${userId}`}>
      by {user.name || 'Unknown'} ({userId.slice(-8)})
    </span>
  );
}

export function DocumentHeader({ document }: DocumentHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [title, setTitle] = useState(document.title);

  const updateDocument = useMutation(api.domains.documents.documents.update);
  const archiveDocument = useMutation(api.domains.documents.documents.archive);
  const generateUploadUrl = useMutation(api.domains.documents.files.generateUploadUrl);
  const userId = useQuery(api.domains.auth.presence.getUserId);
  const isOwner = !!userId && userId === (document as any).createdBy;

  // Tags: list + AI generation
  // Cast `api` to any to avoid type errors until Convex codegen includes the new `tags` module
  const tags = useQuery((api as any).tags.listForDocument, { documentId: document._id });
  const generateTags = useAction((api as any).tags_actions.generateForDocument);
  const [isGenerating, setIsGenerating] = useState(false);
  const canGenerateTags = isOwner;

  const addTagsToDocument = useMutation((api as any).tags.addTagsToDocument);
  const removeTagFromDocument = useMutation((api as any).tags.removeTagFromDocument);
  const updateTagKind = useMutation((api as any).tags.updateTagKind);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [adding, setAdding] = useState(false);

  const KINDS: Array<string> = ["keyword", "entity", "topic", "community", "relationship"];
  const kindPillClass = (k?: string) => {
    switch ((k || "").toLowerCase()) {
      case "keyword": return "bg-amber-50 text-amber-800 border-amber-200";
      case "entity": return "bg-violet-50 text-violet-800 border-violet-200";
      case "topic": return "bg-sky-50 text-sky-800 border-sky-200";
      case "community": return "bg-indigo-50 text-content border-indigo-200";
      case "relationship": return "bg-rose-50 text-rose-800 border-rose-200";
      default: return "bg-surface-hover text-content-secondary border-edge";
    }
  };
  const kindStripClass = (k?: string) => {
    switch ((k || "").toLowerCase()) {
      case "keyword": return "bg-amber-400";
      case "entity": return "bg-violet-400";
      case "topic": return "bg-sky-400";
      case "community": return "bg-indigo-400";
      case "relationship": return "bg-rose-400";
      default: return "bg-[var(--border-color)]";
    }
  };
  const handleCycleKind = async (t: { _id: string; kind?: string }) => {
    const idx = KINDS.indexOf((t.kind || "").toLowerCase());
    const next = KINDS[(idx + 1 + KINDS.length) % KINDS.length];
    try {
      await updateTagKind({ documentId: document._id, tagId: t._id as any, kind: next });
    } catch (err) {
    }
  };


  const handleTitleSubmit = async () => {
    if (title.trim() !== document.title) {
      await updateDocument({
        id: document._id,
        title: title.trim() || "Untitled",
      });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      void handleTitleSubmit();
    }
    if (e.key === "Escape") {
      setTitle(document.title);
      setIsEditing(false);
    }
  };

  const handleTogglePublic = async () => {
    await updateDocument({
      id: document._id,
      isPublic: !document.isPublic,
    });
  };

  const handleAddIcon = async () => {
    const emoji = prompt("Enter an emoji:");
    if (emoji) {
      await updateDocument({
        id: document._id,
        icon: emoji,
      });
    }
  };

  const handleAddCover = async () => {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const uploadUrl = await generateUploadUrl();
          const result = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          });
          const { storageId } = await result.json();

          await updateDocument({
            id: document._id,
            coverImage: storageId,
          });
        } catch (error) {
          console.error("Failed to upload cover image:", error);
        }
      }
    };
    input.click();
  };

  const handleArchive = async () => {
    if (confirm("Are you sure you want to archive this document?")) {
      await archiveDocument({ id: document._id });
    }
  };

  const handleToggleFavorite = async () => {
    await updateDocument({
      id: document._id,
      isFavorite: !document.isFavorite,
    });
  };

  const handleShare = () => {
    if (document.isPublic) {
      const url = `${window.location.origin}/documents/${document._id}`;
      navigator.clipboard.writeText(url).then(() => {
        alert("Public link copied to clipboard!");
      }).catch(err => {
        console.error('Failed to copy text: ', err);
        alert("Failed to copy link.");
      });
    } else {
      alert("This document is private. Make it public to share.");
    }
  };

  const handleGenerateTags = useCallback(async () => {
    if (!canGenerateTags) {
      alert("You don't have permission to generate tags for this document.");
      return;
    }
    try {
      setIsGenerating(true);
      await generateTags({ documentId: document._id });
      // tags query will auto-refresh via Convex reactivity
    } catch (e) {
      console.error("Failed to generate tags:", e);
      alert("Failed to generate tags. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }, [canGenerateTags, document._id, generateTags]);

  // Listen for auto-generate requests (from FileViewer after analysis)
  useEffect(() => {
    const handler = (e: any) => {
      try {
        const id = e?.detail?.documentId;
        if (String(id) === String(document._id)) {
          void handleGenerateTags();
        }
      } catch { /* noop */ }
    };
    window.addEventListener('nodebench:generateTags', handler as any);
    return () => window.removeEventListener('nodebench:generateTags', handler as any);
  }, [document._id, handleGenerateTags]);

  const handleDelete = async () => {
    if (confirm("Are you sure you want to permanently delete this document? This action cannot be undone.")) {
      alert("Delete functionality not yet implemented.");
    }
  };

  return (
    <div className="border-b border-edge bg-surface">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-5">
        {/* Breadcrumb Navigation */}
        <DocumentBreadcrumbs documentId={document._id} />

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-3">
          {/* Back Button and Public/Private Status */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('nodebench:goBack'));
              }}
              className="p-2 rounded-lg border border-edge hover:bg-surface-hover transition-colors mr-1"
              title="Go back"
              aria-label="Go back to documents"
            >
              <ArrowLeft className="h-4 w-4 text-content-secondary" />
            </button>
            {document.isPublic ? (
              <>
                <Globe className="h-4 w-4 text-[var(--accent-green)]" />
                <span className="text-sm font-medium text-content-secondary">Public</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border font-medium ${(document as any).allowPublicEdit
                    ? 'border-[var(--accent-green)] text-[var(--accent-green)] bg-[var(--accent-green)]/5'
                    : 'border-edge text-content-muted bg-surface-secondary'
                    }`}
                  title={(document as any).allowPublicEdit ? 'Anyone with the link can edit' : 'Public view-only'}
                >
                  {(document as any).allowPublicEdit ? 'Editable' : 'View-only'}
                </span>
              </>
            ) : (
              <>
                <Lock className="h-4 w-4 text-content-muted" />
                <span className="text-sm font-medium text-content-secondary">Private</span>
              </>
            )}
          </div>

          {/* Action Buttons - Grouped with better spacing */}
          <div className="flex items-center gap-1.5">
            {/* Inspect Tab toggle */}
            <button
              type="button"
              onClick={() => {
                try {
                  window.dispatchEvent(new CustomEvent('nodebench:toggleInspector'));
                } catch {
                  // Event dispatch failed
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-edge text-content-secondary hover:text-content hover:bg-surface-hover transition-all duration-200"
              title="Toggle Inspect view"
              aria-label="Toggle Inspect view"
            >
              <span className="hidden sm:inline">Inspect</span>
            </button>

            {isOwner && (
              <button
                type="button"
                onClick={() => void handleToggleFavorite()}
                className="flex items-center gap-1.5 p-2 hover:bg-surface-hover rounded-lg transition-all duration-200"
                title={document.isFavorite ? "Unfavorite" : "Favorite"}
                aria-label={document.isFavorite ? "Unfavorite document" : "Favorite document"}
              >
                <Star className={`h-4 w-4 ${document.isFavorite ? 'text-yellow-500 fill-yellow-500' : 'text-content-secondary'}`} />
                <span className="hidden sm:inline text-sm">{document.isFavorite ? "Favorited" : "Favorite"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleShare}
              className="flex items-center gap-1.5 p-2 hover:bg-surface-hover rounded-lg transition-all duration-200"
              title="Share"
              aria-label="Share document"
            >
              <Share className="h-4 w-4 text-content-secondary" />
              <span className="hidden sm:inline text-sm">Share</span>
            </button>

            {/* More Options Menu (owner only) */}
            {isOwner && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className="p-2 hover:bg-surface-hover rounded-lg transition-colors"
                  title="More options"
                  aria-label="More options"
                  aria-expanded={isMenuOpen}
                >
                  <MoreHorizontal className="h-4 w-4 text-content-secondary" />
                </button>
                {isMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-surface rounded-lg shadow-xl border border-edge z-50 overflow-hidden ring-1 ring-black/5" role="dialog" aria-label="Document options">
                    <div className="py-1">
                      {!document.isPublic ? (
                        <>
                          <button onClick={async () => { await updateDocument({ id: document._id, isPublic: true, allowPublicEdit: false }); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-surface-hover hover:text-content flex items-center gap-3 transition-colors">
                            <Globe className="h-4 w-4" />
                            Make Public (view-only)
                          </button>
                          <button onClick={async () => { await updateDocument({ id: document._id, isPublic: true, allowPublicEdit: true }); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-surface-hover hover:text-content flex items-center gap-3 transition-colors">
                            <Globe className="h-4 w-4" />
                            Make Public (editable)
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={async () => { await updateDocument({ id: document._id, isPublic: false, allowPublicEdit: false }); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-surface-hover hover:text-content flex items-center gap-3 transition-colors">
                            <Lock className="h-4 w-4" />
                            Make Private
                          </button>
                          <button onClick={async () => { await updateDocument({ id: document._id, allowPublicEdit: !(document as any).allowPublicEdit }); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-surface-hover hover:text-content flex items-center gap-3 transition-colors">
                            <Globe className="h-4 w-4" />
                            {(document as any).allowPublicEdit ? "Disable public editing" : "Enable public editing"}
                          </button>
                        </>
                      )}
                      <button onClick={() => { void handleAddIcon(); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-surface-hover hover:text-content flex items-center gap-3 transition-colors">
                        <Smile className="h-4 w-4" />
                        Change Icon
                      </button>
                      <button onClick={() => { void handleAddCover(); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-surface-hover hover:text-content flex items-center gap-3 transition-colors">
                        <ImageIcon className="h-4 w-4" />
                        Change Cover
                      </button>
                      <div className="border-t border-edge my-1"></div>
                      <button onClick={() => { void handleArchive(); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-surface-hover hover:text-content flex items-center gap-3 transition-colors">
                        <Archive className="h-4 w-4" />
                        Archive
                      </button>
                      <button onClick={() => { void handleDelete(); setIsMenuOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-3 transition-colors">
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Title and Icon */}
        <div className="flex items-center gap-3">
          {document.icon && (
            <span className="text-3xl sm:text-4xl flex-shrink-0">{document.icon}</span>
          )}

          {isEditing ? (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void handleTitleSubmit()}
              onKeyDown={handleKeyDown}
              className="text-2xl sm:text-3xl font-bold text-content bg-transparent border-none outline-none flex-1"
              autoFocus
            />
          ) : (
            <h1
              onClick={isOwner ? () => setIsEditing(true) : undefined}
              className={`text-2xl sm:text-3xl font-bold text-content ${isOwner ? 'cursor-pointer hover:bg-surface-hover rounded-lg' : ''} px-2 py-1.5 flex-1 transition-colors`}
            >
              {document.title}
            </h1>
          )}
        </div>

        {/* Tags Row */}
        <div className="mt-2 px-1 sm:px-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
          <div className="flex flex-wrap gap-1 items-center min-h-[24px] w-full sm:w-auto">
            {tags === undefined ? (
              <span className="text-xs text-content-muted flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" /> Loading tags...
              </span>
            ) : (
              <>
                {tags && tags.length > 0 ? (
                  tags.map((t: { _id: string; name: string; kind?: string; importance?: number }) => (
                    <span
                      key={t._id}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${kindPillClass(t.kind)}`}
                      title={t.kind ? `${t.name} · ${t.kind === 'entity' ? 'topic' : t.kind}${typeof t.importance === 'number' ? ` · ${t.importance.toFixed(2)}` : ''}` : (typeof t.importance === 'number' ? `${t.name} · ${t.importance.toFixed(2)}` : t.name)}
                    >
                      {/* Left kind strip (click to cycle kind) */}
                      <button
                        onClick={() => void handleCycleKind(t)}
                        className={`${kindStripClass(t.kind)} w-1.5 h-3 rounded-sm`}
                        title={`Kind: ${t.kind === 'entity' ? 'topic' : (t.kind ?? 'unknown')} (click to change)`}
                        aria-label={`Change kind for ${t.name}`}
                      />

                      {/* Name with inline rename */}
                      {editingTagId === (t._id as any) ? (
                        <input
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              const name = editingValue.trim();
                              setEditingTagId(null);
                              if (!name || name === t.name) return;
                              void addTagsToDocument({ documentId: document._id, tags: [{ name }] })
                                .then(() => removeTagFromDocument({ documentId: document._id, tagId: t._id as any }))
                                .catch((err) => console.warn('[DocumentHeader] rename failed', err));
                            }
                          }}
                          onBlur={() => {
                            const name = editingValue.trim();
                            setEditingTagId(null);
                            if (!name || name === t.name) return;
                            void addTagsToDocument({ documentId: document._id, tags: [{ name }] })
                              .then(() => removeTagFromDocument({ documentId: document._id, tagId: t._id as any }))
                              .catch((err) => console.warn('[DocumentHeader] rename failed', err));
                          }}
                          className="bg-transparent outline-none min-w-[60px] max-w-[160px] text-content"
                          autoFocus
                        />
                      ) : (
                        <button
                          onClick={() => { setEditingTagId(t._id as any); setEditingValue(t.name); }}
                          className="truncate max-w-[140px] text-left"
                          title={`Rename ${t.name}`}
                        >
                          {t.name}
                        </button>
                      )}

                      {/* Remove */}
                      <button
                        onClick={() => void removeTagFromDocument({ documentId: document._id, tagId: t._id as any })}
                        className="ml-1 px-1 rounded hover:bg-red-100 text-xs text-red-600"
                        title={`Remove ${t.name}`}
                        aria-label={`Remove ${t.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-content-muted">No tags yet</span>
                )}

                {/* Ghost add pill */}
                {adding ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed text-xs text-content-secondary">
                    <input
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      placeholder="Add tag…"
                      className="bg-transparent outline-none h-5 min-w-[80px]"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          const name = editingValue.trim();
                          setAdding(false);
                          setEditingValue("");
                          if (!name) return;
                          void addTagsToDocument({ documentId: document._id, tags: [{ name }] })
                            .catch((err) => console.warn('[DocumentHeader] add tag failed', err));
                        }
                      }}
                      onBlur={() => {
                        const name = editingValue.trim();
                        setAdding(false);
                        setEditingValue("");
                        if (!name) return;
                        void addTagsToDocument({ documentId: document._id, tags: [{ name }] })
                          .catch((err) => console.warn('[DocumentHeader] add tag failed', err));
                      }}
                    />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setAdding(true); setEditingValue(""); }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed text-xs text-content-muted hover:text-content-secondary hover:bg-surface-hover"
                    title="Add tag"
                  >
                    + Add tag
                  </button>
                )}
              </>
            )}
          </div>
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => void handleGenerateTags()}
              disabled={isGenerating || !canGenerateTags}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border transition-colors ${isGenerating || !canGenerateTags
                ? 'bg-surface-hover text-content-muted border-edge cursor-not-allowed'
                : 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30 hover:bg-indigo-600/20'
                }`}
              title={canGenerateTags ? 'Generate tags with AI' : 'Only the document owner can generate tags'}
            >
              {isGenerating ? (
                <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>{tags && tags.length > 0 ? 'Regenerate Tags' : 'Generate Tags'}</span>
            </button>
          </div>
        </div>

        {/* Presence and Date Information Row */}
        <div className="flex items-center justify-between mt-2 px-2">
          {/* Editing Presence (Left side) */}
          <div className="flex items-center gap-2">
            {userId && (
              <div className="flex items-center gap-3">
                <PresenceIndicator documentId={document._id} userId={userId} />
                {!document.isPublic && isOwner && (
                  <div className="flex items-center gap-1 text-xs text-content-muted opacity-75">
                    <span>•</span>
                    <span className="italic">
                      You're editing alone. Make this document{" "}
                      <button
                        onClick={() => void handleTogglePublic()}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                      >
                        public
                      </button>
                      {" "}for collaboration
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Date Information (Right side) */}
          <div className="flex flex-col items-end gap-0.5">
            {(() => {
              const lastModified = (document as any).lastModified || document._creationTime;
              const lastEditedBy = (document as any).lastEditedBy;
              const isRecent = Date.now() - lastModified < 24 * 60 * 60 * 1000; // Within 24 hours
              const showBothDates = lastModified !== document._creationTime;

              return showBothDates ? (
                <>
                  <div className="flex items-center gap-1 text-xs text-content-muted">
                    <span>updated</span>
                    <span>{new Date(lastModified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    <span>{new Date(lastModified).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {lastEditedBy && <LastEditorDisplay userId={lastEditedBy} />}
                    {isRecent && <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-content-muted opacity-75">
                    <span>created</span>
                    <span>{new Date(document._creationTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-1 text-xs text-content-muted">
                  <span>created</span>
                  <span>{new Date(document._creationTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  <span>{new Date(document._creationTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {isRecent && <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

