import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { X, Trash2, Calendar, Flag, ChevronDown, Tag, User, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";

type RefItem = { kind: "document" | "task" | "event"; id: string };

export default function InlineTaskEditor({ taskId, onClose }: { taskId: Id<"userEvents">; onClose: () => void }) {
  const task = useQuery(api.domains.tasks.userEvents.getTask, { taskId });
  const updateTask = useMutation(api.domains.tasks.userEvents.updateTask);
  const deleteTask = useMutation(api.domains.tasks.userEvents.deleteTask);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"todo" | "in_progress" | "done" | "blocked">("todo");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent" | undefined>(undefined);

  // Dates: date-only and optional time-of-day variants
  const [startDateStr, setStartDateStr] = useState<string>("");
  const [dueDateStr, setDueDateStr] = useState<string>("");
  const [useStartTime, setUseStartTime] = useState<boolean>(false);
  const [useDueTime, setUseDueTime] = useState<boolean>(false);
  const [startDateTimeStr, setStartDateTimeStr] = useState<string>("");
  const [dueDateTimeStr, setDueDateTimeStr] = useState<string>("");

  // New: tags, assignee, references
  const [tags, setTags] = useState<string[]>([]);
  const [showTagsEditor, setShowTagsEditor] = useState(false);

  const [assigneeId, setAssigneeId] = useState<Id<"users"> | undefined>(undefined);
  const [showAssigneeEditor, setShowAssigneeEditor] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const userCandidates = useQuery(api.domains.auth.users.list, { query: assigneeQuery, limit: 8 });

  const [refs, setRefs] = useState<Array<RefItem>>([]);
  const [showRefsEditor, setShowRefsEditor] = useState(false);
  const [newRefKind, setNewRefKind] = useState<RefItem["kind"]>("document");
  const [newRefId, setNewRefId] = useState("");

  const [_isSaving, setIsSaving] = useState(false);
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved" | "unsaved">("idle");
  const titleRef = useRef<HTMLInputElement | null>(null);
  const lastSavedRef = useRef<string>("");
  const skipDirtyOnceRef = useRef(false);
  const didUserEditRef = useRef(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showDuePicker, setShowDuePicker] = useState(false);

  // Layout effect prevents a transient "unsaved" state on first paint (which can trigger beforeunload warnings)
  useLayoutEffect(() => {
    if (!task) return;
    // Skip the first dirty comparison after hydration; state updates land after this effect.
    skipDirtyOnceRef.current = true;
    didUserEditRef.current = false;
    setTitle(task.title ?? "");
    setDescription(task.description ?? "");
    setStatus((task.status as any) ?? "todo");
    setPriority((task.priority ?? undefined) as any);

    setStartDateStr(task.startDate ? toInputDate(task.startDate) : "");
    setDueDateStr(task.dueDate ? toInputDate(task.dueDate) : "");
    // Seed datetime strings from existing values; toggles default to false
    setStartDateTimeStr(task.startDate ? toInputDateTimeLocal(task.startDate) : "");
    setDueDateTimeStr(task.dueDate ? toInputDateTimeLocal(task.dueDate) : "");
    setUseStartTime(false);
    setUseDueTime(false);

    setTags(Array.isArray(task.tags) ? task.tags : []);
    setAssigneeId(task.assigneeId as any);
    setRefs(Array.isArray(task.refs) ? (task.refs as any[]).map((r) => ({ kind: r.kind, id: String(r.id) })) : []);

    // Record baseline snapshot for autosave comparisons
    lastSavedRef.current = JSON.stringify({
      title: task.title ?? "",
      description: task.description ?? "",
      status: (task.status as any) ?? "todo",
      priority: task.priority ?? undefined,
      startDateStr: task.startDate ? toInputDate(task.startDate) : "",
      dueDateStr: task.dueDate ? toInputDate(task.dueDate) : "",
      useStartTime: false,
      useDueTime: false,
      startDateTimeStr: task.startDate ? toInputDateTimeLocal(task.startDate) : "",
      dueDateTimeStr: task.dueDate ? toInputDateTimeLocal(task.dueDate) : "",
      tags: Array.isArray(task.tags) ? task.tags : [],
      assigneeId: task.assigneeId ?? null,
      refs: Array.isArray(task.refs) ? (task.refs as any[]).map((r) => ({ kind: r.kind, id: String(r.id) })) : [],
    });
    // Focus title like Notion
    requestAnimationFrame(() => {
      if (titleRef.current) {
        const el = titleRef.current;
        el.focus();
        const len = el.value.length;
        try { el.setSelectionRange(len, len); } catch { void 0; }
      }
    });
  }, [task]);

  const saveTask = useCallback(async () => {
    if (!task) return;
    setIsSaving(true);
    setSaveHint("saving");
    try {
      let descriptionJson: string | undefined = undefined;
      try {
        const getter = (globalThis as any).getEditorJsonRef?.current;
        if (getter) {
          const json = await getter();
          if (json) descriptionJson = JSON.stringify(json);
        }
      } catch { /* ignore */ }

      // Compute timestamps respecting optional time-of-day
      const startTs = useStartTime
        ? (startDateTimeStr ? fromInputDateTimeLocal(startDateTimeStr) : undefined)
        : (startDateStr ? fromInputDate(startDateStr) : undefined);
      const dueTs = useDueTime
        ? (dueDateTimeStr ? fromInputDateTimeLocal(dueDateTimeStr) : undefined)
        : (dueDateStr ? fromInputDate(dueDateStr) : undefined);

      // Build refs in schema shape (best-effort casting)
      const refsOut = refs.map((r) => (
        r.kind === "document"
          ? ({ kind: "document" as const, id: r.id as Id<"documents"> })
          : r.kind === "task"
          ? ({ kind: "task" as const, id: r.id as Id<"userEvents"> })
          : ({ kind: "event" as const, id: r.id as Id<"events"> })
      ));

      await updateTask({
        taskId,
        title: title.trim() || task.title,
        description: description.trim(),
        descriptionJson,
        status,
        priority,
        startDate: startTs,
        dueDate: dueTs,
        tags,
        assigneeId,
        refs: refsOut as any,
      });
      // snapshot after successful save
      lastSavedRef.current = JSON.stringify({
        title: title.trim() || task.title,
        description: description.trim(),
        status,
        priority,
        startDateStr,
        dueDateStr,
        useStartTime,
        useDueTime,
        startDateTimeStr,
        dueDateTimeStr,
        tags,
        assigneeId: assigneeId ?? null,
        refs,
      });
      setSaveHint("saved");
      setTimeout(() => setSaveHint("idle"), 1200);
    } catch (e) {
      console.error(e);
      toast.error("Failed to save task");
    } finally {
      setIsSaving(false);
    }
  }, [task, taskId, title, description, status, priority, startDateStr, dueDateStr, useStartTime, useDueTime, startDateTimeStr, dueDateTimeStr, tags, assigneeId, refs, updateTask]);

  // Manual save via keyboard (doesn't close, Notion-like)
  const handleSave = useCallback(async () => {
    await saveTask();
  }, [saveTask]);

  // Intercept Esc and Ctrl/Cmd+S. Prompt on discard if there are unsaved changes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (saveHint === "unsaved") {
          const discard = window.confirm("Discard unsaved changes?");
          if (!discard) return;
        }
        onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, handleSave, saveHint]);

  // Track dirty state (unsaved changes) without autosaving.
  useEffect(() => {
    if (!task) return;
    if (skipDirtyOnceRef.current) {
      skipDirtyOnceRef.current = false;
      return;
    }
    const current = JSON.stringify({
      title, description, status, priority,
      startDateStr, dueDateStr,
      useStartTime, useDueTime,
      startDateTimeStr, dueDateTimeStr,
      tags, assigneeId: assigneeId ?? null, refs,
    });
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
  }, [title, description, status, priority, startDateStr, dueDateStr, useStartTime, useDueTime, startDateTimeStr, dueDateTimeStr, tags, assigneeId, refs, task]);

  // Warn on tab close/reload if unsaved changes exist
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
    return (
      <div className="mt-2 border border-edge rounded-lg p-4 bg-surface-secondary">
        <div className="motion-safe:animate-pulse h-5 w-36 bg-surface rounded mb-3" />
        <div className="space-y-2">
          <div className="h-4 bg-surface rounded" />
          <div className="h-4 bg-surface rounded w-5/6" />
          <div className="h-4 bg-surface rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="mt-2 border border-edge rounded-lg p-4 bg-surface-secondary flex items-center justify-between">
        <div className="text-sm text-content-secondary">Task not found</div>
        <button
          className="w-8 h-8 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover border border-edge"
          onClick={onClose}
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const assigneeDisplay = (() => {
    const hit = (userCandidates ?? []).find((u: any) => String(u?._id) === String(assigneeId));
    return hit?.name || (assigneeId ? String(assigneeId).slice(0, 6) : "");
  })();

  return (
    <div
      className="mt-2 rounded-lg p-3 bg-surface border border-edge/60 transition-all relative z-10 pointer-events-auto"
      data-inline-editor="true"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onInputCapture={() => {
        didUserEditRef.current = true;
      }}
      onChangeCapture={() => {
        didUserEditRef.current = true;
      }}
    >
      {/* Top bar: actions and save hint */}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs text-content-muted">Press Esc to close · Ctrl/Cmd+S to save</div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-content-muted">
            {saveHint === "saving" ? "Saving…" : saveHint === "saved" ? "Saved" : saveHint === "unsaved" ? "Unsaved changes" : ""}
          </div>
          <button
            onClick={() => { void handleSave(); }}
            disabled={saveHint !== "unsaved" || _isSaving}
            className={`h-7 px-3 rounded-md flex items-center justify-center border text-[12px] ${
              saveHint === "unsaved" && !_isSaving
                ? "bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]/30 hover:bg-[var(--accent-primary-hover)]"
                : "bg-surface-secondary text-content-secondary border-edge opacity-70 cursor-not-allowed"
            }`}
            title="Save changes"
          >
            Save
          </button>
          <button
            onClick={() => { void handleDelete(); }}
            className="w-7 h-7 rounded-md flex items-center justify-center bg-surface-secondary hover:bg-red-500 text-content-secondary hover:text-white border border-edge hover:border-red-500"
            title="Delete task"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              if (saveHint === "unsaved") {
                const discard = window.confirm("Discard unsaved changes?");
                if (!discard) return;
              }
              onClose();
            }}
            className="w-7 h-7 rounded-md flex items-center justify-center bg-surface-secondary hover:bg-surface-hover text-content-secondary border border-edge"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-3">
        {/* Title - flat input, border only on focus */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          ref={titleRef}
          className="w-full text-sm bg-transparent border border-transparent rounded-md px-0 py-1 text-content focus:outline-none focus:border-[var(--accent-primary)]/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent-primary)_18%,transparent)]"
          placeholder="Untitled"
        />

        {/* Chips under title */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Status chip */}
          <button
            type="button"
            onClick={() => {
              const order: Array<typeof status> = ["todo", "in_progress", "done", "blocked"];
              const i = order.indexOf(status);
              setStatus(order[(i + 1) % order.length]);
            }}
            className={`pill pill--type inline-flex items-center gap-1 text-xs ${
              status === "done"
                ? "bg-green-100 text-green-700 border-green-200 dark:bg-surface dark:text-green-400 dark:border-edge"
                : status === "in_progress"
                ? "bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary)]/20 dark:bg-surface dark:text-[var(--accent-primary)] dark:border-edge"
                : status === "blocked"
                ? "bg-red-100 text-red-700 border-red-200 dark:bg-surface dark:text-red-400 dark:border-edge"
                : "bg-surface-hover text-content border-edge"
            }`}
            title="Click to cycle status"
          >
            <ChevronDown className="w-3 h-3 opacity-70" />
            {status === "todo" ? "Todo" : status === "in_progress" ? "In Progress" : status === "done" ? "Done" : "Blocked"}
          </button>

          {/* Priority chip */}
          <button
            type="button"
            onClick={() => {
              const order: Array<typeof priority> = [undefined, "low", "medium", "high", "urgent"];
              const i = order.indexOf(priority);
              setPriority(order[(i + 1) % order.length]);
            }}
            className={`pill pill--type inline-flex items-center gap-1 text-xs ${
              priority === "urgent"
                ? "bg-red-100 text-red-700 border-red-200 dark:bg-surface dark:text-red-400 dark:border-edge"
                : priority === "high"
                ? "bg-orange-100 text-orange-700 border-orange-200 dark:bg-surface dark:text-orange-400 dark:border-edge"
                : priority === "medium"
                ? "bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary)]/20 dark:bg-surface dark:text-[var(--accent-primary)] dark:border-edge"
                : priority === "low"
                ? "bg-surface-hover text-content border-edge"
                : "bg-surface-hover text-content border-edge"
            }`}
            title="Click to cycle priority"
          >
            <Flag className="w-3 h-3 opacity-70" />
            {priority ? `Priority: ${priority}` : "Priority"}
          </button>

          {/* Start date chip */}
          <button
            type="button"
            onClick={() => setShowStartPicker((v) => !v)}
            className="pill pill--time inline-flex items-center gap-1 text-xs"
            title="Set start date/time"
            aria-expanded={showStartPicker}
            aria-controls={`start-picker-${String(taskId)}`}
          >
            <Calendar className="w-3 h-3 opacity-70" />
            {useStartTime
              ? (startDateTimeStr ? `Start: ${startDateTimeStr}` : "Start time")
              : (startDateStr ? `Start: ${startDateStr}` : "Start date")}
          </button>

          {/* Due date chip */}
          <button
            type="button"
            onClick={() => setShowDuePicker((v) => !v)}
            className="pill pill--time inline-flex items-center gap-1 text-xs"
            title="Set due date/time"
            aria-expanded={showDuePicker}
            aria-controls={`due-picker-${String(taskId)}`}
          >
            <Calendar className="w-3 h-3 opacity-70" />
            {useDueTime
              ? (dueDateTimeStr ? `Due: ${dueDateTimeStr}` : "Due time")
              : (dueDateStr ? `Due: ${dueDateStr}` : "Due date")}
          </button>

          {/* Tags pill */}
          <button
            type="button"
            onClick={() => setShowTagsEditor((v) => !v)}
            className="pill pill--time inline-flex items-center gap-1 text-xs"
            title="Edit tags"
            aria-expanded={showTagsEditor}
          >
            <Tag className="w-3 h-3 opacity-70" /> {tags.length > 0 ? `${tags.length} tag${tags.length > 1 ? "s" : ""}` : "Tags"}
          </button>

          {/* Assignee pill */}
          <button
            type="button"
            onClick={() => setShowAssigneeEditor((v) => !v)}
            className="pill pill--time inline-flex items-center gap-1 text-xs"
            title="Set assignee"
            aria-expanded={showAssigneeEditor}
          >
            <User className="w-3 h-3 opacity-70" /> {assigneeDisplay ? assigneeDisplay : "Assignee"}
          </button>

          {/* References pill */}
          <button
            type="button"
            onClick={() => setShowRefsEditor((v) => !v)}
            className="pill pill--time inline-flex items-center gap-1 text-xs"
            title="Add references"
            aria-expanded={showRefsEditor}
          >
            <LinkIcon className="w-3 h-3 opacity-70" /> {refs.length > 0 ? `${refs.length} link${refs.length > 1 ? "s" : ""}` : "Links"}
          </button>
        </div>

        {/* Inline date/time pickers (toggled) */}
        {(showStartPicker || showDuePicker) && (
          <div className="flex flex-col gap-2">
            {showStartPicker && (
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-xs text-content-secondary inline-flex items-center gap-1">
                  <input type="checkbox" checked={useStartTime} onChange={(e) => setUseStartTime(e.target.checked)} /> Include time
                </label>
                {useStartTime ? (
                  <input
                    type="datetime-local"
                    value={startDateTimeStr}
                    onChange={(e) => setStartDateTimeStr(e.target.value)}
                    id={`start-picker-${String(taskId)}`}
                    className="text-sm bg-transparent border border-transparent rounded-md px-0 py-1 text-content focus:outline-none focus:border-[var(--accent-primary)]/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent-primary)_18%,transparent)]"
                  />
                ) : (
                  <input
                    type="date"
                    value={startDateStr}
                    onChange={(e) => setStartDateStr(e.target.value)}
                    id={`start-picker-${String(taskId)}`}
                    className="text-sm bg-transparent border border-transparent rounded-md px-0 py-1 text-content focus:outline-none focus:border-[var(--accent-primary)]/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent-primary)_18%,transparent)]"
                  />
                )}
              </div>
            )}
            {showDuePicker && (
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-xs text-content-secondary inline-flex items-center gap-1">
                  <input type="checkbox" checked={useDueTime} onChange={(e) => setUseDueTime(e.target.checked)} /> Include time
                </label>
                {useDueTime ? (
                  <input
                    type="datetime-local"
                    value={dueDateTimeStr}
                    onChange={(e) => setDueDateTimeStr(e.target.value)}
                    id={`due-picker-${String(taskId)}`}
                    className="text-sm bg-transparent border border-transparent rounded-md px-0 py-1 text-content focus:outline-none focus:border-[var(--accent-primary)]/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent-primary)_18%,transparent)]"
                  />
                ) : (
                  <input
                    type="date"
                    value={dueDateStr}
                    onChange={(e) => setDueDateStr(e.target.value)}
                    id={`due-picker-${String(taskId)}`}
                    className="text-sm bg-transparent border border-transparent rounded-md px-0 py-1 text-content focus:outline-none focus:border-[var(--accent-primary)]/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent-primary)_18%,transparent)]"
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Tags editor */}
        {showTagsEditor && (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-edge bg-surface-secondary">
                {t}
                <button type="button" onClick={() => setTags((prev) => prev.filter((x) => x !== t))} className="text-xs opacity-70 hover:opacity-100" title="Remove tag">×</button>
              </span>
            ))}
            <input
              type="text"
              placeholder="Add tag…"
              className="text-xs bg-transparent border border-transparent rounded-md px-1.5 py-0.5 text-content focus:outline-none focus:border-[var(--accent-primary)]/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent-primary)_18%,transparent)]"
              onKeyDown={(e) => {
                const el = e.currentTarget as HTMLInputElement;
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  const val = el.value.trim();
                  if (val && !tags.includes(val)) setTags((prev) => [...prev, val]);
                  el.value = "";
                }
              }}
            />
          </div>
        )}

        {/* Assignee editor */}
        {showAssigneeEditor && (
          <div className="flex flex-col gap-2 mt-1.5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={assigneeQuery}
                onChange={(e) => setAssigneeQuery(e.target.value)}
                placeholder="Search users…"
                className="text-xs bg-transparent border border-edge rounded-md px-2 py-1 text-content focus:outline-none focus:border-[var(--accent-primary)]/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent-primary)_18%,transparent)]"
              />
              <button
                type="button"
                className="text-xs px-2 py-0.5 rounded border border-edge text-content-secondary bg-surface-secondary"
                onClick={() => setAssigneeId(undefined)}
                title="Clear assignee"
              >
                Clear
              </button>
            </div>
            <div className="max-h-40 overflow-auto border border-edge rounded-md">
              {(userCandidates ?? []).map((u: any) => (
                <button
                  key={String(u._id)}
                  type="button"
                  onClick={() => setAssigneeId(u._id)}
                  className={`w-full text-left px-2 py-1 text-[12px] hover:bg-surface-hover ${String(u._id) === String(assigneeId) ? "bg-surface-secondary" : ""}`}
                >
                  {u.name || String(u._id)}
                </button>
              ))}
              {(userCandidates ?? []).length === 0 && (
                <div className="px-2 py-1 text-[12px] text-content-muted">No results</div>
              )}
            </div>
          </div>
        )}

        {/* References editor */}
        {showRefsEditor && (
          <div className="flex flex-col gap-2 mt-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              {refs.map((r, idx) => (
                <span key={`${r.kind}:${r.id}:${idx}`} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-edge bg-surface-secondary">
                  {r.kind}:{String(r.id).slice(0, 8)}
                  <button type="button" className="text-xs opacity-70 hover:opacity-100" onClick={() => setRefs((prev) => prev.filter((_, i) => i !== idx))} title="Remove">×</button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={newRefKind}
                onChange={(e) => setNewRefKind(e.target.value as RefItem["kind"]) }
                className="text-xs bg-transparent border border-edge rounded-md px-2 py-1 text-content focus:outline-none focus:border-[var(--accent-primary)]/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent-primary)_18%,transparent)]"
              >
                <option value="document">Document</option>
                <option value="task">Task</option>
                <option value="event">Event</option>
              </select>
              <input
                type="text"
                value={newRefId}
                onChange={(e) => setNewRefId(e.target.value)}
                placeholder="Paste ID…"
                className="text-xs bg-transparent border border-edge rounded-md px-2 py-1 text-content focus:outline-none focus:border-[var(--accent-primary)]/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent-primary)_18%,transparent)]"
              />
              <button
                type="button"
                className="text-xs px-2 py-0.5 rounded border border-edge text-content-secondary bg-surface-secondary"
                onClick={() => {
                  const id = newRefId.trim();
                  if (!id) return;
                  setRefs((prev) => [...prev, { kind: newRefKind, id }]);
                  setNewRefId("");
                }}
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Description */}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Write details…"
          className="w-full min-h-[80px] px-3 py-2 text-sm border border-edge/60 rounded-md bg-surface-secondary text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 resize-y"
        />

        <div className="text-xs text-content-muted">Last updated {task.updatedAt ? timeAgo(task.updatedAt) : "—"}</div>
      </div>
    </div>
  );
}

// Helpers
function toInputDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromInputDate(s: string): number {
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  // Noon UTC to avoid timezone edge cases for date-only
  const dt = new Date(Date.UTC(y, (m - 1), d, 12, 0, 0, 0));
  return dt.getTime();
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function toInputDateTimeLocal(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  return `${y}-${m}-${day}T${hh}:${mm}`;
}
function fromInputDateTimeLocal(s: string): number {
  const [date, time] = s.split("T");
  const [y, m, d] = date.split("-").map((x) => parseInt(x, 10));
  const [hh, mm] = time.split(":").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0); // local time -> ms
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
