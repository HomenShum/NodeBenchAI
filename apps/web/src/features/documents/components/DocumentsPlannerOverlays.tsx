/**
 * DocumentsPlannerOverlays
 *
 * Lazy-loadable overlay layer extracted from DocumentsHomeHub.
 * Contains: New Task Modal, TaskEditorPanel, MiniAgendaEditorPanel (inline create),
 * MiniEditorPopover, AgendaEditorPopover, MediaCinemaViewer.
 *
 * Consumes context slices for planner/editor/overlay state instead of receiving
 * 25+ individual props. Shell-level values (user, task selection, mini-editor
 * local state, refs) remain as props.
 */

import { lazy, Suspense, useMemo } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ai-ui/dialog";
import {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
} from "@/components/ai-ui/popover";
import {
  usePlannerEditorCtx,
  usePlannerViewCtx,
  useDocumentOverlayCtx,
} from "../context";

const LazyMiniEditorPopover = lazy(
  () => import("@/shared/components/MiniEditorPopover"),
);
const LazyAgendaEditorPopover = lazy(
  () => import("@features/calendar/components/agenda/AgendaEditorPopover"),
);
const LazyTaskEditorPanel = lazy(
  () => import("@/features/calendar/components/TaskEditorPanel"),
);
const LazyMiniAgendaEditorPanel = lazy(
  () => import("@features/calendar/components/agenda/MiniAgendaEditorPanel"),
);
const LazyMediaCinemaViewer = lazy(() =>
  import("./MediaCinemaViewer").then((module) => ({
    default: module.MediaCinemaViewer,
  })),
);

export interface DocumentsPlannerOverlaysProps {
  loggedInUser: unknown;

  // --- Shell-level task selection ---
  selectedTaskId?: Id<"userEvents"> | null;
  onClearTaskSelection?: () => void;

  // --- Mini Editor Popover (local state in DocumentsHomeHub) ---
  hideCalendarCard?: boolean;
  miniEditorDocId: Id<"documents"> | null;
  closeMiniEditor: () => void;
}

export default function DocumentsPlannerOverlays({
  loggedInUser,
  selectedTaskId,
  onClearTaskSelection,
  hideCalendarCard,
  miniEditorDocId,
  closeMiniEditor,
}: DocumentsPlannerOverlaysProps) {
  const inlineCreateAnchorRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () =>
          new DOMRect(
            typeof window === "undefined" ? 0 : window.innerWidth - 24,
            typeof window === "undefined" ? 0 : window.innerHeight - 24,
            0,
            0,
          ),
      },
    }),
    [],
  );
  // ── Context slices ──────────────────────────────────────────────────────────
  const {
    agendaPopover,
    setAgendaPopover,
    inlineCreate,
    setInlineCreate,
    miniEditorAnchor,
    handleSubmitNewTask,
    handleModalKeyDown,
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
    newTaskTitleRef,
    modalRef,
  } = usePlannerEditorCtx();
  const { mode } = usePlannerViewCtx();
  const { viewingMediaDoc, setViewingMediaDoc } = useDocumentOverlayCtx();
  return (
    <>
      {/* New Task Modal */}
      <Dialog
        open={showNewTaskModal}
        onOpenChange={(open) => {
          if (!open && !isSubmittingTask) setShowNewTaskModal(false);
        }}
      >
          <DialogContent
            className="w-[calc(100%-2rem)] max-w-md gap-0 rounded-lg border-edge bg-surface-secondary p-0 shadow-2xl"
            overlayClassName="bg-black/30 backdrop-blur-[1px]"
            showCloseButton={false}
            ref={modalRef}
            onKeyDown={handleModalKeyDown}
            onEscapeKeyDown={(event) => { if (isSubmittingTask) event.preventDefault(); }}
            onPointerDownOutside={(event) => { if (isSubmittingTask) event.preventDefault(); }}
            aria-busy={isSubmittingTask}
          >
            <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
              <DialogTitle
                className="text-sm font-semibold text-content"
              >
                New Task
              </DialogTitle>

              <DialogClose asChild>
                <button
                  aria-label="Close"
                  className="w-7 h-7 p-1.5 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover border border-edge text-content-secondary"
                  disabled={isSubmittingTask}
                >
                  <X className="h-4 w-4" />
                </button>
              </DialogClose>
            </div>

            <form
              className="p-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!isSubmittingTask) void handleSubmitNewTask();
              }}
            >
              <div>
                <label className="block text-xs text-content-muted mb-1">
                  Title
                </label>

                <input
                  ref={newTaskTitleRef}
                  type="text"
                  value={newTaskModalTitle}
                  onChange={(e) => setNewTaskModalTitle(e.target.value)}
                  placeholder="e.g., Follow up with design team"
                  className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content placeholder:text-content-muted focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-xs text-content-muted mb-1">
                  Description (optional)
                </label>

                <textarea
                  value={newTaskModalDescription}
                  onChange={(e) => setNewTaskModalDescription(e.target.value)}
                  placeholder="Add a few details to provide context..."
                  rows={3}
                  className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content placeholder:text-content-muted focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-content-muted mb-1">
                    Due date
                  </label>

                  <input
                    type="date"
                    value={newTaskModalDue}
                    onChange={(e) => setNewTaskModalDue(e.target.value)}
                    className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div>
                  <label className="block text-xs text-content-muted mb-1">
                    Priority
                  </label>

                  <select
                    value={newTaskModalPriority}
                    onChange={(e) => setNewTaskModalPriority(e.target.value)}
                    className="w-full text-sm bg-surface border border-edge rounded-md p-2 text-content focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">None</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => !isSubmittingTask && setShowNewTaskModal(false)}
                  disabled={isSubmittingTask}
                  className="text-xs px-3 py-1.5 bg-surface border border-edge rounded-md hover:bg-surface-hover text-content-secondary"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    !newTaskModalTitle.trim() || !loggedInUser || isSubmittingTask
                  }
                  className={`text-xs px-3 py-1.5 rounded-md transition-colors ${!newTaskModalTitle.trim() || !loggedInUser || isSubmittingTask ? "bg-surface-secondary text-content-muted border border-edge cursor-not-allowed" : "bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)]"}`}
                  title={
                    !loggedInUser
                      ? "Please sign in to create tasks"
                      : undefined
                  }
                >
                  {isSubmittingTask ? "Creating..." : "Create Task"}
                </button>
              </div>
            </form>
          </DialogContent>
      </Dialog>

      {/* Unified Task Editor Panel (overlay only outside list mode) */}
      {selectedTaskId && mode !== "list" && (
        <Suspense fallback={null}>
          <LazyTaskEditorPanel
            taskId={selectedTaskId}
            onClose={() => onClearTaskSelection?.()}
          />
        </Suspense>
      )}

      {/* Centralized Agenda Create (floating popover) */}
      <Popover
        open={!!inlineCreate}
        onOpenChange={(open) => { if (!open) setInlineCreate(null); }}
      >
        <PopoverAnchor virtualRef={inlineCreateAnchorRef} />
        {inlineCreate ? (
          <PopoverContent
            role="dialog"
            aria-label="Create agenda item"
            side="top"
            align="end"
            sideOffset={0}
            collisionPadding={16}
            className="z-[70] w-[min(520px,calc(100vw-32px))] border-0 bg-transparent p-0 shadow-none"
          >
          <div className="rounded-lg border border-edge bg-surface-secondary shadow-2xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-edge bg-surface rounded-t-xl">
              <div className="text-xs text-content-secondary">
                Create on{" "}
                {new Date(inlineCreate.dateMs).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>

              <PopoverClose asChild>
                <button
                  type="button"
                  aria-label="Close create panel"
                  className="w-7 h-7 p-1.5 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover border border-edge text-content-secondary"
                >
                  <X className="h-4 w-4" />
                </button>
              </PopoverClose>
            </div>

            <div className="p-3">
              <Suspense
                fallback={
                  <div className="px-3 py-6 text-sm text-content-secondary">
                    Loading editor...
                  </div>
                }
              >
                <LazyMiniAgendaEditorPanel
                  {...({ kind: "create" } as any)}
                  dateMs={inlineCreate.dateMs}
                  defaultKind={inlineCreate.defaultKind}
                  defaultTitle={inlineCreate.defaultTitle}
                  defaultAllDay={inlineCreate.defaultAllDay}
                  onClose={() => setInlineCreate(null)}
                />
              </Suspense>
            </div>
          </div>
          </PopoverContent>
        ) : null}
      </Popover>

      {/* Mini Editor Popover */}
      {!hideCalendarCard && (
        <Suspense fallback={null}>
          <LazyMiniEditorPopover
            isOpen={!!miniEditorDocId}
            documentId={miniEditorDocId}
            anchorEl={miniEditorAnchor}
            onClose={closeMiniEditor}
          />
        </Suspense>
      )}

      {/* Agenda Editor Popover for weekly editing (events) */}
      {agendaPopover && (
        <Suspense fallback={null}>
          <LazyAgendaEditorPopover
            isOpen={true}
            anchorEl={agendaPopover.anchor}
            onClose={() => setAgendaPopover(null)}
            kind={agendaPopover.kind}
            eventId={
              agendaPopover.kind === "event"
                ? agendaPopover.eventId
                : undefined
            }
            taskId={
              agendaPopover.kind === "task" ? agendaPopover.taskId : undefined
            }
            dateMs={
              agendaPopover.kind === "create" ||
              agendaPopover.kind === "createBoth"
                ? agendaPopover.dateMs
                : undefined
            }
            defaultKind={
              agendaPopover.kind === "create" ||
              agendaPopover.kind === "createBoth"
                ? agendaPopover.defaultKind
                : undefined
            }
            defaultTitle={
              agendaPopover.kind === "create" ||
              agendaPopover.kind === "createBoth"
                ? agendaPopover.defaultTitle
                : undefined
            }
            defaultAllDay={
              agendaPopover.kind === "create" ||
              agendaPopover.kind === "createBoth"
                ? agendaPopover.defaultAllDay
                : undefined
            }
            documentIdForAssociation={
              agendaPopover.kind === "event" ||
              agendaPopover.kind === "createBoth"
                ? agendaPopover.documentIdForAssociation
                : undefined
            }
          />
        </Suspense>
      )}

      {/* Media Cinema Viewer for images and videos */}
      <Suspense fallback={null}>
        <LazyMediaCinemaViewer
          doc={viewingMediaDoc}
          isOpen={!!viewingMediaDoc}
          onClose={() => setViewingMediaDoc(null)}
        />
      </Suspense>
    </>
  );
}
