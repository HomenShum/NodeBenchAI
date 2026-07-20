/**
 * usePlannerEditor
 *
 * Editor/modal/inline state: toolbar event dialog, mini editor, inline create,
 * new task modal, focus management, keyboard shortcuts.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { AgendaPopoverState } from "@features/documents/components/documentsHub";
import type { PlannerMode } from "@features/documents/components/documentsHub";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlannerEditorParams {
  /** Current planner mode (needed for toolbar dialog autofocus) */
  mode: PlannerMode;
  /** createTask mutation from usePlannerMutations */
  createTask: (args: {
    title: string;
    description?: string;
    dueDate?: number;
    priority?: "low" | "medium" | "high" | "urgent";
  }) => Promise<any>;
}

export interface PlannerEditorSlice {
  // Toolbar event dialog
  showToolbarEventDialog: boolean;
  setShowToolbarEventDialog: React.Dispatch<React.SetStateAction<boolean>>;
  toolbarEventTitle: string;
  setToolbarEventTitle: React.Dispatch<React.SetStateAction<string>>;
  toolbarEventStart: string;
  setToolbarEventStart: React.Dispatch<React.SetStateAction<string>>;
  toolbarEventEnd: string;
  setToolbarEventEnd: React.Dispatch<React.SetStateAction<string>>;
  toolbarAllDay: boolean;
  setToolbarAllDay: React.Dispatch<React.SetStateAction<boolean>>;
  toolbarTitleRef: React.MutableRefObject<HTMLInputElement | null>;

  // Mini editor
  miniEditorAnchor: HTMLElement | null;
  setMiniEditorAnchor: React.Dispatch<
    React.SetStateAction<HTMLElement | null>
  >;

  // Selected event
  selectedEventId: Id<"events"> | null;
  setSelectedEventId: React.Dispatch<
    React.SetStateAction<Id<"events"> | null>
  >;

  // Quick agenda
  quickAgendaText: string;
  setQuickAgendaText: React.Dispatch<React.SetStateAction<string>>;
  agendaPopover: AgendaPopoverState;
  setAgendaPopover: React.Dispatch<React.SetStateAction<AgendaPopoverState>>;

  // Prompt
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;

  // New task modal
  showNewTaskModal: boolean;
  setShowNewTaskModal: React.Dispatch<React.SetStateAction<boolean>>;
  newTaskModalTitle: string;
  setNewTaskModalTitle: React.Dispatch<React.SetStateAction<string>>;
  newTaskModalDue: string;
  setNewTaskModalDue: React.Dispatch<React.SetStateAction<string>>;
  newTaskModalPriority: string;
  setNewTaskModalPriority: React.Dispatch<React.SetStateAction<string>>;
  newTaskModalDescription: string;
  setNewTaskModalDescription: React.Dispatch<React.SetStateAction<string>>;
  isSubmittingTask: boolean;
  setIsSubmittingTask: React.Dispatch<React.SetStateAction<boolean>>;
  newTaskTitleRef: React.MutableRefObject<HTMLInputElement | null>;
  modalRef: React.MutableRefObject<HTMLDivElement | null>;
  prevFocusRef: React.MutableRefObject<HTMLElement | null>;

  // Inline create
  inlineCreate: {
    dateMs: number;
    defaultKind?: "task" | "event";
    defaultTitle?: string;
    defaultAllDay?: boolean;
  } | null;
  setInlineCreate: React.Dispatch<
    React.SetStateAction<{
      dateMs: number;
      defaultKind?: "task" | "event";
      defaultTitle?: string;
      defaultAllDay?: boolean;
    } | null>
  >;

  // Event editor inline
  eventEditorInline: boolean;
  setEventEditorInline: React.Dispatch<React.SetStateAction<boolean>>;

  // Callbacks
  handleSubmitNewTask: () => Promise<void>;
  handleModalKeyDown: (e: React.KeyboardEvent) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlannerEditor(
  params: PlannerEditorParams,
): PlannerEditorSlice {
  const { mode, createTask } = params;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [showToolbarEventDialog, setShowToolbarEventDialog] = useState(false);
  const [toolbarEventTitle, setToolbarEventTitle] = useState("");
  const [toolbarEventStart, setToolbarEventStart] = useState<string>("");
  const [toolbarEventEnd, setToolbarEventEnd] = useState<string>("");
  const [toolbarAllDay, setToolbarAllDay] = useState<boolean>(false);
  const toolbarTitleRef = useRef<HTMLInputElement | null>(null);

  const [miniEditorAnchor, setMiniEditorAnchor] =
    useState<HTMLElement | null>(null);
  const [selectedEventId, setSelectedEventId] =
    useState<Id<"events"> | null>(null);
  const [quickAgendaText, setQuickAgendaText] = useState<string>("");
  const [agendaPopover, setAgendaPopover] =
    useState<AgendaPopoverState>(null);
  const [prompt, setPrompt] = useState<string>("");

  const [showNewTaskModal, setShowNewTaskModal] = useState<boolean>(false);
  const [newTaskModalTitle, setNewTaskModalTitle] = useState<string>("");
  const [newTaskModalDue, setNewTaskModalDue] = useState<string>("");
  const [newTaskModalPriority, setNewTaskModalPriority] =
    useState<string>("");
  const [newTaskModalDescription, setNewTaskModalDescription] =
    useState<string>("");
  const [isSubmittingTask, setIsSubmittingTask] = useState<boolean>(false);

  const newTaskTitleRef = useRef<HTMLInputElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const [inlineCreate, setInlineCreate] = useState<{
    dateMs: number;
    defaultKind?: "task" | "event";
    defaultTitle?: string;
    defaultAllDay?: boolean;
  } | null>(null);

  const [eventEditorInline, setEventEditorInline] = useState(true);

  // -------------------------------------------------------------------------
  // Effects: Autofocus toolbar dialog title
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (showToolbarEventDialog && mode !== "list") {
      setTimeout(() => toolbarTitleRef.current?.focus(), 0);
    }
  }, [showToolbarEventDialog, mode]);

  // -------------------------------------------------------------------------
  // Effects: New task modal focus management
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (showNewTaskModal) {
      setTimeout(() => newTaskTitleRef.current?.focus(), 0);
    }
  }, [showNewTaskModal]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (showNewTaskModal) {
      prevFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    } else {
      prevFocusRef.current?.focus?.();
    }
  }, [showNewTaskModal]);

  // On open: suggest default due date (today)
  useEffect(() => {
    if (!showNewTaskModal) return;

    setNewTaskModalDue((prev) => {
      if (prev) return prev;
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    });
  }, [showNewTaskModal]);

  // -------------------------------------------------------------------------
  // Effects: Voice intent create listeners
  // -------------------------------------------------------------------------

  useEffect(() => {
    const openTaskCreate = () => {
      setInlineCreate({
        dateMs: Date.now(),
        defaultKind: "task",
      });
    };

    const openEventCreate = () => {
      setInlineCreate({
        dateMs: Date.now(),
        defaultKind: "event",
      });
    };

    window.addEventListener("voice:create-task", openTaskCreate);
    window.addEventListener("voice:create-event", openEventCreate);
    return () => {
      window.removeEventListener("voice:create-task", openTaskCreate);
      window.removeEventListener("voice:create-event", openEventCreate);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Effects: Modal keyboard shortcuts (ESC, Ctrl+Enter)
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!showNewTaskModal) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isSubmittingTask) return;
        e.preventDefault();
        setShowNewTaskModal(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (isSubmittingTask) return;
        e.preventDefault();
        void handleSubmitNewTask();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewTaskModal, isSubmittingTask]);

  // -------------------------------------------------------------------------
  // Effects: Scroll selected event into view
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedEventId) return;

    const idStr = String(selectedEventId);
    const tryScroll = () => {
      const el = document.getElementById(`event-${idStr}`);
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add(
        "ring-2",
        "ring-ring",
        "ring-offset-1",
        "ring-offset-surface-secondary",
      );
      setTimeout(() => {
        el.classList.remove(
          "ring-2",
          "ring-ring",
          "ring-offset-1",
          "ring-offset-surface-secondary",
        );
      }, 1200);
      return true;
    };

    if (!tryScroll()) {
      const t = setTimeout(() => {
        tryScroll();
      }, 250);
      return () => clearTimeout(t);
    }
  }, [selectedEventId]);

  // -------------------------------------------------------------------------
  // Callbacks: Submit new task
  // -------------------------------------------------------------------------

  const toTaskPriority = (
    p?: string,
  ): "low" | "medium" | "high" | "urgent" | undefined =>
    p === "low" || p === "medium" || p === "high" || p === "urgent"
      ? p
      : undefined;

  const handleSubmitNewTask = useCallback(async () => {
    if (isSubmittingTask) return;

    const title = newTaskModalTitle.trim();
    if (!title) {
      return;
    }

    const due = newTaskModalDue
      ? (() => {
          const [yy, mm, dd] = newTaskModalDue
            .split("-")
            .map((x) => parseInt(x, 10));
          if (!yy || !mm || !dd) return undefined as unknown as number;
          const dt = new Date(yy, mm - 1, dd, 23, 59, 59, 999);
          return dt.getTime();
        })()
      : undefined;

    const priority = toTaskPriority(newTaskModalPriority || undefined);

    try {
      setIsSubmittingTask(true);

      await createTask({
        title,
        description: newTaskModalDescription || undefined,
        dueDate: due,
        priority,
      });

      setShowNewTaskModal(false);
      setNewTaskModalTitle("");
      setNewTaskModalDue("");
      setNewTaskModalPriority("");
      setNewTaskModalDescription("");
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingTask(false);
    }
  }, [
    createTask,
    isSubmittingTask,
    newTaskModalTitle,
    newTaskModalDue,
    newTaskModalPriority,
    newTaskModalDescription,
  ]);

  // -------------------------------------------------------------------------
  // Callbacks: Modal focus trap
  // -------------------------------------------------------------------------

  const handleModalKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const container = modalRef.current;
      if (!container) return;

      const focusable = container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    showToolbarEventDialog,
    setShowToolbarEventDialog,
    toolbarEventTitle,
    setToolbarEventTitle,
    toolbarEventStart,
    setToolbarEventStart,
    toolbarEventEnd,
    setToolbarEventEnd,
    toolbarAllDay,
    setToolbarAllDay,
    toolbarTitleRef,
    miniEditorAnchor,
    setMiniEditorAnchor,
    selectedEventId,
    setSelectedEventId,
    quickAgendaText,
    setQuickAgendaText,
    agendaPopover,
    setAgendaPopover,
    prompt,
    setPrompt,
    showNewTaskModal,
    setShowNewTaskModal,
    newTaskModalTitle,
    setNewTaskModalTitle,
    newTaskModalDue,
    setNewTaskModalDue,
    newTaskModalPriority,
    setNewTaskModalPriority,
    newTaskModalDescription,
    setNewTaskModalDescription,
    isSubmittingTask,
    setIsSubmittingTask,
    newTaskTitleRef,
    modalRef,
    prevFocusRef,
    inlineCreate,
    setInlineCreate,
    eventEditorInline,
    setEventEditorInline,
    handleSubmitNewTask,
    handleModalKeyDown,
  };
}
