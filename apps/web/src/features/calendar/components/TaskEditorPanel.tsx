import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { X, Trash2, Save, Tag as TagIcon, User as UserIcon, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";

type Props = {
  taskId: Id<"userEvents">;
  onClose: () => void;
  /**
   * When true, renders inline within the parent (no full-screen overlay/backdrop).
   * Defaults to false (overlay panel behavior).
   */
  embedded?: boolean;
};

export default function TaskEditorPanel({ taskId, onClose, embedded = false }: Props) {
  const task = useQuery(api.domains.tasks.userEvents.getTask, { taskId });
  const updateTask = useMutation(api.domains.tasks.userEvents.updateTask);
  const deleteTask = useMutation(api.domains.tasks.userEvents.deleteTask);
  const me = useQuery(api.domains.auth.auth.loggedInUser);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const userSuggestions = useQuery(api.domains.auth.users.list as any, assigneeQuery ? { query: assigneeQuery, limit: 10 } : { limit: 10 } as any) as any[] | undefined;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"todo" | "in_progress" | "done" | "blocked">("todo");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent" | undefined>(undefined);
  const [dueDateStr, setDueDateStr] = useState<string>("");
  const [startDateStr, setStartDateStr] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<Id<"users"> | "">("");
  type RefKind = "document" | "task" | "event";
  const [refs, setRefs] = useState<Array<{ kind: RefKind; id: string }>>([]);
  const [newRefKind, setNewRefKind] = useState<RefKind>("document");
  const [newRefId, setNewRefId] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [showAssigneeEditor, setShowAssigneeEditor] = useState(false);
  const [showRefsEditor, setShowRefsEditor] = useState(false);
  const [showTagsEditor, setShowTagsEditor] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved" | "unsaved">("idle");
  const lastSavedRef = useRef<string>("");
  const skipDirtyOnceRef = useRef(false);
  const didUserEditRef = useRef(false);

  const isTaskStatus = (v: string): v is "todo" | "in_progress" | "done" | "blocked" =>
    v === "todo" || v === "in_progress" || v === "done" || v === "blocked";
  const isPriority = (v: string): v is "low" | "medium" | "high" | "urgent" =>
    v === "low" || v === "medium" || v === "high" || v === "urgent";

  // Initialize form from task (layout effect prevents a transient "unsaved" state on first paint)
  useLayoutEffect(() => {
    if (!task) return;
    // Skip the first dirty comparison after hydration; state updates land after this effect.
    skipDirtyOnceRef.current = true;
    didUserEditRef.current = false;
    setTitle(task.title ?? "");
    setDescription(task.description ?? "");
    setStatus(isTaskStatus(String(task.status)) ? (task.status as any) : "todo");
    setPriority(isPriority(String(task.priority)) ? (task.priority as any) : undefined);
    setDueDateStr(task.dueDate ? toInputDate(task.dueDate) : "");
    setStartDateStr(task.startDate ? toInputDate(task.startDate) : "");
    setAssigneeId((task as any).assigneeId ?? "");
    setRefs(Array.isArray((task as any).refs) ? ((task as any).refs as any[]).map((r) => ({ kind: r.kind, id: String(r.id) })) : []);
    setTags(Array.isArray((task as any).tags) ? ((task as any).tags as string[]) : []);
    // Record baseline snapshot for dirty checking
    lastSavedRef.current = JSON.stringify({
      title: task.title ?? "",
      description: task.description ?? "",
      status: isTaskStatus(String(task.status)) ? task.status : "todo",
      priority: isPriority(String(task.priority)) ? task.priority : undefined,
      dueDateStr: task.dueDate ? toInputDate(task.dueDate) : "",
      startDateStr: task.startDate ? toInputDate(task.startDate) : "",
      assigneeId: (task as any).assigneeId ?? "",
      refs: Array.isArray((task as any).refs) ? ((task as any).refs as any[]).map((r) => ({ kind: r.kind, id: String(r.id) })) : [],
      tags: Array.isArray((task as any).tags) ? ((task as any).tags as string[]) : [],
    });
    setSaveHint("idle");
  }, [task]);

  const assigneeDisplay = useMemo(() => {
    if (!assigneeId) return "";
    if (me && String((me as any)?._id) === String(assigneeId)) {
      return (me as any)?.name || "Me";
    }
    const hit = (userSuggestions ?? []).find((u: any) => String(u?._id) === String(assigneeId));
    return hit?.name || String(assigneeId).slice(0, 6);
  }, [assigneeId, me, userSuggestions]);

  // Stable handlers declared before effects that depend on them
  const handleClose = useCallback(() => {
    if (saveHint === "unsaved") {
      const discard = window.confirm("Discard unsaved changes?");
      if (!discard) return;
    }
    onClose();
  }, [saveHint, onClose]);

  const handleSave = useCallback(async () => {
    if (!task) return;
    setIsSaving(true);
    setSaveHint("saving");
    try {
      await updateTask({
        taskId,
        title: title.trim() || task.title,
        description: description.trim(),
        status,
        priority,
        dueDate: dueDateStr ? fromInputDate(dueDateStr) : undefined,
        startDate: startDateStr ? fromInputDate(startDateStr) : undefined,
        assigneeId: assigneeId || undefined,
        refs: refs.map((r) => ({ kind: r.kind, id: r.id as any })),
        tags,
      });
      // update baseline snapshot
      lastSavedRef.current = JSON.stringify({ title: title.trim() || task.title, description: description.trim(), status, priority, dueDateStr, startDateStr, assigneeId, refs, tags });
      setSaveHint("saved");
      toast.success("Task saved");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Failed to save task");
    } finally {
      setIsSaving(false);
    }
  }, [task, updateTask, taskId, title, description, status, priority, dueDateStr, startDateStr, onClose, assigneeId, refs, tags]);

  // Keyboard: ESC to close (with prompt if dirty), Ctrl/Cmd+S to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, handleClose]);

  // Track dirty state of the form
  useEffect(() => {
    if (!task) return;
    if (skipDirtyOnceRef.current) {
      skipDirtyOnceRef.current = false;
      return;
    }
    const current = JSON.stringify({ title, description, status, priority, dueDateStr, startDateStr, assigneeId, refs, tags });
    if (current === lastSavedRef.current) {
      setSaveHint((prev) => (prev === "saved" ? "saved" : "idle"));
    } else {
      if (!didUserEditRef.current) {
        // If the user hasn't interacted yet, treat diffs as hydration noise (prevents beforeunload warnings).
        setSaveHint((prev) => (prev === "saved" ? "saved" : "idle"));
        return;
      }
      setSaveHint("unsaved");
    }
  }, [title, description, status, priority, dueDateStr, startDateStr, assigneeId, refs, tags, task]);

  // Resolve reference titles (batch per kind)
  const docIds = React.useMemo(() => refs.filter((r) => r.kind === "document").map((r) => r.id), [refs]);
  const taskIds = React.useMemo(() => refs.filter((r) => r.kind === "task").map((r) => r.id), [refs]);
  const eventIds = React.useMemo(() => refs.filter((r) => r.kind === "event").map((r) => r.id), [refs]);
  const docTitles = useQuery(api.domains.documents.documents.getTitles as any, docIds.length ? { ids: docIds as any } : "skip") as any[] | undefined;
  const taskTitles = useQuery(api.domains.tasks.userEvents.getTitles as any, taskIds.length ? { ids: taskIds as any } : "skip") as any[] | undefined;
  const eventTitles = useQuery(api.domains.calendar.events.getTitles as any, eventIds.length ? { ids: eventIds as any } : "skip") as any[] | undefined;
  const docTitleById = React.useMemo(() => {
    const m: Record<string, string> = {};
    (docTitles ?? []).forEach((t: any) => { if (t?._id) m[String(t._id)] = t.title; });
    return m;
  }, [docTitles]);
  const taskTitleById = React.useMemo(() => {
    const m: Record<string, string> = {};
    (taskTitles ?? []).forEach((t: any) => { if (t?._id) m[String(t._id)] = t.title; });
    return m;
  }, [taskTitles]);
  const eventTitleById = React.useMemo(() => {
    const m: Record<string, string> = {};
    (eventTitles ?? []).forEach((t: any) => { if (t?._id) m[String(t._id)] = t.title; });
    return m;
  }, [eventTitles]);

  // Warn on page unload if there are unsaved changes
  useEffect(() => {
    if (saveHint !== "unsaved") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveHint === "unsaved") {
        if (!didUserEditRef.current) return;
        // Chromium blocks (and logs an error for) beforeunload prompts that fire without a prior user gesture.
        // Gate prompts behind an explicit gesture so long-running automated navigations don't accumulate errors.
        if (typeof window !== "undefined" && (window as any).__nodebenchHasUserGesture !== true) return;
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveHint]);

  

  const handleDelete = async () => {
    if (!task) return;
    const ok = window.confirm("Delete this task?");
    if (!ok) return;
    try {
      await deleteTask({ taskId });
      toast.success("Task deleted");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Failed to delete task");
    }
  };

  if (task === undefined) {
    return embedded ? (
      <div className="h-full w-full bg-surface-secondary border-l border-edge p-4">
        <div className="motion-safe:animate-pulse h-6 w-40 bg-surface rounded mb-4" />
        <div className="space-y-2">
          <div className="h-4 bg-surface rounded" />
          <div className="h-4 bg-surface rounded w-5/6" />
          <div className="h-4 bg-surface rounded w-2/3" />
        </div>
      </div>
    ) : (
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-black/30 z-0" onClick={handleClose} />
        <div
          className="absolute right-0 top-0 h-full w-[min(480px,100%)] bg-surface-secondary border-l border-edge shadow-2xl p-4 z-10"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="motion-safe:animate-pulse h-6 w-40 bg-surface rounded mb-4" />
          <div className="space-y-2">
            <div className="h-4 bg-surface rounded" />
            <div className="h-4 bg-surface rounded w-5/6" />
            <div className="h-4 bg-surface rounded w-2/3" />
          </div>
        </div>
      </div>
    );
  }

  if (!task) {
    return embedded ? (
      <div className="h-full w-full bg-surface-secondary border-l border-edge p-4 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-content">Task not found</h3>
          <button className="w-8 h-8 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover border border-edge" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-content-secondary text-sm">This task may have been deleted.</p>
      </div>
    ) : (
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-black/30 z-0" onClick={onClose} />
        <div
          className="absolute right-0 top-0 h-full w-[min(480px,100%)] bg-surface-secondary border-l border-edge shadow-2xl p-4 flex flex-col z-10"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-content">Task not found</h3>
            <button className="w-8 h-8 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover border border-edge" onClick={onClose}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-content-secondary text-sm">This task may have been deleted.</p>
        </div>
      </div>
    );
  }

  return embedded ? (
    <div
      className="h-full w-full bg-surface-secondary border-l border-edge flex flex-col"
      onInputCapture={() => {
        didUserEditRef.current = true;
      }}
      onChangeCapture={() => {
        didUserEditRef.current = true;
      }}
    >
        {/* Header */}
        <div className="p-4 border-b border-edge flex items-center justify-between">
          <h3 className="text-sm font-semibold text-content truncate">Edit Task</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleDelete()}
              className="w-8 h-8 rounded-md flex items-center justify-center bg-surface hover:bg-red-500 text-content-secondary hover:text-white border border-edge hover:border-red-500"
              title="Delete task"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover text-content-secondary border border-edge"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 flex-1 overflow-auto space-y-4">
          <div>
            <label className="block text-xs font-medium text-content-secondary mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Task title"
            />
            {/* Pills under title */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="pill pill--time inline-flex items-center gap-1 text-xs"
                onClick={() => setShowAssigneeEditor((v) => !v)}
                aria-expanded={showAssigneeEditor}
                title="Set assignee"
              >
                <UserIcon className="w-3 h-3 opacity-70" /> {assigneeDisplay || "Assignee"}
              </button>
              <button
                type="button"
                className="pill pill--time inline-flex items-center gap-1 text-xs"
                onClick={() => setShowRefsEditor((v) => !v)}
                aria-expanded={showRefsEditor}
                title="Add references"
              >
                <LinkIcon className="w-3 h-3 opacity-70" /> {refs.length > 0 ? `${refs.length} link${refs.length > 1 ? "s" : ""}` : "Links"}
              </button>
              <button
                type="button"
                className="pill pill--time inline-flex items-center gap-1 text-xs"
                onClick={() => setShowTagsEditor((v) => !v)}
                aria-expanded={showTagsEditor}
                title="Edit tags"
              >
                <TagIcon className="w-3 h-3 opacity-70" /> {tags.length > 0 ? `${tags.length} tag${tags.length > 1 ? "s" : ""}` : "Tags"}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-content-secondary mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Details, notes, links…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Status</label>
              <select
                className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
              >
                <option value="todo">Todo</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Priority</label>
              <select
                className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                value={priority ?? ""}
                onChange={(e) => setPriority((e.target.value || undefined) as any)}
              >
                <option value="">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Inline editors toggled by pills (overlay) */}
          {showAssigneeEditor && (
            <div className="grid grid-cols-1 gap-2">
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Assignee</label>
                <select
                  className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                  value={(assigneeId as any) ?? ''}
                  onChange={(e) => setAssigneeId((e.target.value || '') as any)}
                >
                  <option value="">Unassigned</option>
                  {me && (
                    <option value={(me as any)._id}>Me{(me as any)?.name ? ` (${(me as any).name})` : ''}</option>
                  )}
                </select>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={assigneeQuery}
                    onChange={(e) => setAssigneeQuery(e.target.value)}
                    placeholder="Search people…"
                    className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setAssigneeId("")}
                    className="text-xs px-2 py-1 rounded border border-edge bg-surface text-content-secondary"
                  >
                    Clear
                  </button>
                </div>
                {(userSuggestions ?? []).length > 0 && (
                  <div className="mt-1 max-h-40 overflow-auto border border-edge rounded-md bg-surface">
                    {(userSuggestions ?? []).map((u) => (
                      <button
                        key={String(u._id)}
                        type="button"
                        onClick={() => { setAssigneeId(u._id); setAssigneeQuery(''); }}
                        className="w-full text-left px-2 py-1 text-sm hover:bg-surface-hover"
                        title={u.name ?? ''}
                      >
                        {u.name ?? String(u._id)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {showRefsEditor && (
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">References</label>
              <div className="flex items-center gap-2">
                <select
                  className="text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none"
                  value={newRefKind}
                  onChange={(e) => setNewRefKind(e.target.value as any)}
                >
                  <option value="document">Document</option>
                  <option value="task">Task</option>
                  <option value="event">Event</option>
                </select>
                <input
                  value={newRefId}
                  onChange={(e) => setNewRefId(e.target.value)}
                  placeholder="Target ID"
                  className="flex-1 text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => {
                    const id = newRefId.trim();
                    if (!id) return;
                    if (refs.some((r) => r.kind === newRefKind && r.id === id)) return;
                    setRefs([...refs, { kind: newRefKind, id }]);
                    setNewRefId('');
                  }}
                  disabled={!newRefId.trim()}
                  className="text-xs px-2.5 py-1 bg-surface border border-edge rounded-md hover:bg-surface-hover text-content-secondary disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              {refs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {refs.map((r, idx) => {
                    const title = r.kind === 'document' ? docTitleById[r.id] : r.kind === 'task' ? taskTitleById[r.id] : eventTitleById[r.id];
                    return (
                      <span key={`${r.kind}:${r.id}:${idx}`} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border bg-surface text-content-secondary border-edge">
                        <span className="uppercase">{r.kind}</span>
                        <span className="text-content-muted">{title ?? r.id}</span>
                        <button
                          type="button"
                          onClick={() => setRefs(refs.filter((_, i) => i !== idx))}
                          className="ml-1 w-4 h-4 rounded hover:bg-surface-hover flex items-center justify-center"
                          title="Remove"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {showTagsEditor && (
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Tags</label>
              <div className="flex flex-wrap items-center gap-1">
                {tags.map((t, idx) => (
                  <span key={`${t}:${idx}`} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-edge bg-surface text-content-secondary">
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((_, i) => i !== idx))}
                      className="ml-1 w-4 h-4 rounded hover:bg-surface-hover flex items-center justify-center"
                      title="Remove tag"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  placeholder="Add tag…"
                  className="text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                  onKeyDown={(e) => {
                    const el = e.currentTarget as HTMLInputElement;
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      const val = el.value.trim();
                      if (val && !tags.includes(val)) setTags([...tags, val]);
                      el.value = '';
                    }
                  }}
                />
              </div>
            </div>
          )}

          {/* Inline editors toggled by pills */}
          {showAssigneeEditor && (
            <div className="grid grid-cols-1 gap-2">
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Assignee</label>
                <select
                  className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                  value={(assigneeId as any) ?? ''}
                  onChange={(e) => setAssigneeId((e.target.value || '') as any)}
                >
                  <option value="">Unassigned</option>
                  {me && (
                    <option value={(me as any)._id}>Me{(me as any)?.name ? ` (${(me as any).name})` : ''}</option>
                  )}
                </select>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={assigneeQuery}
                    onChange={(e) => setAssigneeQuery(e.target.value)}
                    placeholder="Search people…"
                    className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setAssigneeId("")}
                    className="text-xs px-2 py-1 rounded border border-edge bg-surface text-content-secondary"
                  >
                    Clear
                  </button>
                </div>
                {(userSuggestions ?? []).length > 0 && (
                  <div className="mt-1 max-h-40 overflow-auto border border-edge rounded-md bg-surface">
                    {(userSuggestions ?? []).map((u) => (
                      <button
                        key={String(u._id)}
                        type="button"
                        onClick={() => { setAssigneeId(u._id); setAssigneeQuery(''); }}
                        className="w-full text-left px-2 py-1 text-sm hover:bg-surface-hover"
                        title={u.name ?? ''}
                      >
                        {u.name ?? String(u._id)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {showRefsEditor && (
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">References</label>
              <div className="flex items-center gap-2">
                <select
                  className="text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none"
                  value={newRefKind}
                  onChange={(e) => setNewRefKind(e.target.value as any)}
                >
                  <option value="document">Document</option>
                  <option value="task">Task</option>
                  <option value="event">Event</option>
                </select>
                <input
                  value={newRefId}
                  onChange={(e) => setNewRefId(e.target.value)}
                  placeholder="Target ID"
                  className="flex-1 text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => {
                    const id = newRefId.trim();
                    if (!id) return;
                    if (refs.some((r) => r.kind === newRefKind && r.id === id)) return;
                    setRefs([...refs, { kind: newRefKind, id }]);
                    setNewRefId('');
                  }}
                  disabled={!newRefId.trim()}
                  className="text-xs px-2.5 py-1 bg-surface border border-edge rounded-md hover:bg-surface-hover text-content-secondary disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              {refs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {refs.map((r, idx) => {
                    const title = r.kind === 'document' ? docTitleById[r.id] : r.kind === 'task' ? taskTitleById[r.id] : eventTitleById[r.id];
                    return (
                      <span key={`${r.kind}:${r.id}:${idx}`} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border bg-surface text-content-secondary border-edge">
                        <span className="uppercase">{r.kind}</span>
                        <span className="text-content-muted">{title ?? r.id}</span>
                        <button
                          type="button"
                          onClick={() => setRefs(refs.filter((_, i) => i !== idx))}
                          className="ml-1 w-4 h-4 rounded hover:bg-surface-hover flex items-center justify-center"
                          title="Remove"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {showTagsEditor && (
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Tags</label>
              <div className="flex flex-wrap items-center gap-1">
                {tags.map((t, idx) => (
                  <span key={`${t}:${idx}`} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-edge bg-surface text-content-secondary">
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((_, i) => i !== idx))}
                      className="ml-1 w-4 h-4 rounded hover:bg-surface-hover flex items-center justify-center"
                      title="Remove tag"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  placeholder="Add tag…"
                  className="text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                  onKeyDown={(e) => {
                    const el = e.currentTarget as HTMLInputElement;
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      const val = el.value.trim();
                      if (val && !tags.includes(val)) setTags([...tags, val]);
                      el.value = '';
                    }
                  }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Start date</label>
              <input
                type="date"
                value={startDateStr}
                onChange={(e) => setStartDateStr(e.target.value)}
                className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Due date</label>
              <input
                type="date"
                value={dueDateStr}
                onChange={(e) => setDueDateStr(e.target.value)}
                className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {/* Inline editors toggled by pills */}
          {showAssigneeEditor && (
            <div className="grid grid-cols-1 gap-2">
              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Assignee</label>
                <select
                  className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                  value={(assigneeId as any) ?? ''}
                  onChange={(e) => setAssigneeId((e.target.value || '') as any)}
                >
                  <option value="">Unassigned</option>
                  {me && (
                    <option value={(me as any)._id}>Me{(me as any)?.name ? ` (${(me as any).name})` : ''}</option>
                  )}
                </select>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={assigneeQuery}
                    onChange={(e) => setAssigneeQuery(e.target.value)}
                    placeholder="Search people…"
                    className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setAssigneeId("")}
                    className="text-xs px-2 py-1 rounded border border-edge bg-surface text-content-secondary"
                  >
                    Clear
                  </button>
                </div>
                {(userSuggestions ?? []).length > 0 && (
                  <div className="mt-1 max-h-40 overflow-auto border border-edge rounded-md bg-surface">
                    {(userSuggestions ?? []).map((u) => (
                      <button
                        key={String(u._id)}
                        type="button"
                        onClick={() => { setAssigneeId(u._id); setAssigneeQuery(''); }}
                        className="w-full text-left px-2 py-1 text-sm hover:bg-surface-hover"
                        title={u.name ?? ''}
                      >
                        {u.name ?? String(u._id)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {showRefsEditor && (
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">References</label>
              <div className="flex items-center gap-2">
                <select
                  className="text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none"
                  value={newRefKind}
                  onChange={(e) => setNewRefKind(e.target.value as any)}
                >
                  <option value="document">Document</option>
                  <option value="task">Task</option>
                  <option value="event">Event</option>
                </select>
                <input
                  value={newRefId}
                  onChange={(e) => setNewRefId(e.target.value)}
                  placeholder="Target ID"
                  className="flex-1 text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => {
                    const id = newRefId.trim();
                    if (!id) return;
                    if (refs.some((r) => r.kind === newRefKind && r.id === id)) return;
                    setRefs([...refs, { kind: newRefKind, id }]);
                    setNewRefId('');
                  }}
                  disabled={!newRefId.trim()}
                  className="text-xs px-2.5 py-1 bg-surface border border-edge rounded-md hover:bg-surface-hover text-content-secondary disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              {refs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {refs.map((r, idx) => {
                    const title = r.kind === 'document' ? docTitleById[r.id] : r.kind === 'task' ? taskTitleById[r.id] : eventTitleById[r.id];
                    return (
                      <span key={`${r.kind}:${r.id}:${idx}`} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border bg-surface text-content-secondary border-edge">
                        <span className="uppercase">{r.kind}</span>
                        <span className="text-content-muted">{title ?? r.id}</span>
                        <button
                          type="button"
                          onClick={() => setRefs(refs.filter((_, i) => i !== idx))}
                          className="ml-1 w-4 h-4 rounded hover:bg-surface-hover flex items-center justify-center"
                          title="Remove"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {showTagsEditor && (
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Tags</label>
              <div className="flex flex-wrap items-center gap-1">
                {tags.map((t, idx) => (
                  <span key={`${t}:${idx}`} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-edge bg-surface text-content-secondary">
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((_, i) => i !== idx))}
                      className="ml-1 w-4 h-4 rounded hover:bg-surface-hover flex items-center justify-center"
                      title="Remove tag"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  placeholder="Add tag…"
                  className="text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                  onKeyDown={(e) => {
                    const el = e.currentTarget as HTMLInputElement;
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      const val = el.value.trim();
                      if (val && !tags.includes(val)) setTags([...tags, val]);
                      el.value = '';
                    }
                  }}
                />
              </div>
            </div>
        )}

          

          <div className="text-xs text-content-muted">Last updated {task.updatedAt ? timeAgo(task.updatedAt) : "—"}</div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-edge flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-content-muted">
            {saveHint === "saving" ? "Saving…" : saveHint === "saved" ? "Saved" : saveHint === "unsaved" ? "Unsaved changes" : ""}
          </span>
          <button
            onClick={handleClose}
            className="text-xs px-2.5 py-1 bg-surface border border-edge rounded-md hover:bg-surface-hover text-content-secondary"
          >
            Close
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={isSaving || saveHint !== "unsaved"}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${(isSaving || saveHint !== 'unsaved') ? 'bg-surface-secondary text-content-muted border border-edge cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
          >
            <span className="inline-flex items-center gap-1"><Save className="w-3.5 h-3.5" /> Save</span>
          </button>
        </div>
    </div>
  ) : (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30 z-0" onClick={handleClose} />
      <div
        className="absolute right-0 top-0 h-full w-[min(520px,100%)] bg-surface-secondary border-l border-edge shadow-2xl flex flex-col z-10"
        onMouseDown={(e) => e.stopPropagation()}
        onInputCapture={() => {
          didUserEditRef.current = true;
        }}
        onChangeCapture={() => {
          didUserEditRef.current = true;
        }}
      >
        {/* Header */}
        <div className="p-4 border-b border-edge flex items-center justify-between">
          <h3 className="text-sm font-semibold text-content truncate">Edit Task</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleDelete()}
              className="w-8 h-8 rounded-md flex items-center justify-center bg-surface hover:bg-red-500 text-content-secondary hover:text-white border border-edge hover:border-red-500"
              title="Delete task"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover text-content-secondary border border-edge"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 flex-1 overflow-auto space-y-4">
          <div>
            <label className="block text-xs font-medium text-content-secondary mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Task title"
            />
            {/* Pills under title (overlay) */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="pill pill--time inline-flex items-center gap-1 text-xs"
                onClick={() => setShowAssigneeEditor((v) => !v)}
                aria-expanded={showAssigneeEditor}
                title="Set assignee"
              >
                <UserIcon className="w-3 h-3 opacity-70" /> {assigneeDisplay || "Assignee"}
              </button>
              <button
                type="button"
                className="pill pill--time inline-flex items-center gap-1 text-xs"
                onClick={() => setShowRefsEditor((v) => !v)}
                aria-expanded={showRefsEditor}
                title="Add references"
              >
                <LinkIcon className="w-3 h-3 opacity-70" /> {refs.length > 0 ? `${refs.length} link${refs.length > 1 ? "s" : ""}` : "Links"}
              </button>
              <button
                type="button"
                className="pill pill--time inline-flex items-center gap-1 text-xs"
                onClick={() => setShowTagsEditor((v) => !v)}
                aria-expanded={showTagsEditor}
                title="Edit tags"
              >
                <TagIcon className="w-3 h-3 opacity-70" /> {tags.length > 0 ? `${tags.length} tag${tags.length > 1 ? "s" : ""}` : "Tags"}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-content-secondary mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Details, notes, links…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Status</label>
              <select
                className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
              >
                <option value="todo">Todo</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Priority</label>
              <select
                className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                value={priority ?? ""}
                onChange={(e) => setPriority((e.target.value || undefined) as any)}
              >
                <option value="">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Start date</label>
              <input
                type="date"
                value={startDateStr}
                onChange={(e) => setStartDateStr(e.target.value)}
                className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-content-secondary mb-1">Due date</label>
              <input
                type="date"
                value={dueDateStr}
                onChange={(e) => setDueDateStr(e.target.value)}
                className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="text-xs text-content-muted">Last updated {task.updatedAt ? timeAgo(task.updatedAt) : "—"}</div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-edge flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-content-muted">
            {saveHint === "saving" ? "Saving…" : saveHint === "saved" ? "Saved" : saveHint === "unsaved" ? "Unsaved changes" : ""}
          </span>
          <button
            onClick={handleClose}
            className="text-xs px-2.5 py-1 bg-surface border border-edge rounded-md hover:bg-surface-hover text-content-secondary"
          >
            Close
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={isSaving || saveHint !== "unsaved"}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${(isSaving || saveHint !== 'unsaved') ? 'bg-surface-secondary text-content-muted border border-edge cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
          >
            <span className="inline-flex items-center gap-1"><Save className="w-3.5 h-3.5" /> Save</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function toInputDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromInputDate(s: string): number {
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, (m - 1), d, 12, 0, 0, 0));
  return dt.getTime();
}

function timeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 4) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}
