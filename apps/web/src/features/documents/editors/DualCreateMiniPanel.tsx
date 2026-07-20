import React from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { toast } from "sonner";
import PopoverMiniEditor from "./PopoverMiniEditor";

export default function DualCreateMiniPanel({
  dateMs,
  onClose,
  defaultTitle,
  defaultAllDay = true,
  documentIdForAssociation,
}: {
  dateMs: number;
  onClose: () => void;
  defaultTitle?: string;
  defaultAllDay?: boolean;
  documentIdForAssociation?: Id<"documents"> | null;
}) {
  const createTask = useMutation(api.domains.tasks.userEvents.createTask);
  const createEvent = useMutation(api.domains.calendar.events.createEvent);

  const [taskTitle, setTaskTitle] = React.useState<string>(defaultTitle ?? "New task");
  const [eventTitle, setEventTitle] = React.useState<string>(defaultTitle ?? "New event");
  const [allDay, setAllDay] = React.useState<boolean>(!!defaultAllDay);

  const [createdTaskId, setCreatedTaskId] = React.useState<Id<"userEvents"> | null>(null);
  const [createdEventId, setCreatedEventId] = React.useState<Id<"events"> | null>(null);

  if (createdTaskId) {
    return <PopoverMiniEditor kind="task" taskId={createdTaskId} onClose={onClose} />;
  }
  if (createdEventId) {
    return (
      <PopoverMiniEditor
        kind="event"
        eventId={createdEventId}
        onClose={onClose}
        documentIdForAssociation={documentIdForAssociation}
      />
    );
  }

  const handleCreateTask = async () => {
    try {
      const title = taskTitle.trim() || "New task";
      const id = await createTask({ title, status: "todo", dueDate: dateMs });
      setCreatedTaskId(id as Id<"userEvents">);
      toast.success("Task created");
    } catch (e) {
      console.error(e);
      toast.error("Failed to create task");
    }
  };

  const handleCreateEvent = async () => {
    try {
      const title = eventTitle.trim() || "New event";
      const start = allDay ? dateMs : dateMs + 9 * 60 * 60 * 1000;
      const end = allDay ? undefined : dateMs + 10 * 60 * 60 * 1000;
      const id = await createEvent({ title, startTime: start, endTime: end, allDay, status: "confirmed" });
      setCreatedEventId(id as Id<"events">);
      toast.success("Event created");
    } catch (e) {
      console.error(e);
      toast.error("Failed to create event");
    }
  };

  return (
    <div
      className="mt-2 rounded-lg p-2 bg-surface border border-edge/60 pointer-events-auto"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Create task or event"
    >
      <div className="text-xs text-content-muted mb-2">
        Create on {new Date(dateMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {/* Task create card */}
        <div className="relative overflow-visible p-2 rounded-sm border border-edge bg-surface-secondary">
          <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-indigo-500/60" aria-hidden />
          <div className="min-w-0 flex flex-col gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500" />
              <span className="truncate text-content text-xs">Add Task</span>
            </div>
            <input
              type="text"
              className="w-full text-xs px-2 py-1 rounded border border-edge bg-surface"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="Task title"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateTask(); } }}
            />
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-md border border-edge bg-surface-secondary hover:bg-surface-hover"
                onClick={() => void handleCreateTask()}
              >
                Create Task
              </button>
            </div>
          </div>
        </div>
        {/* Event create card */}
        <div className="relative overflow-visible p-2 rounded-sm border border-edge bg-surface-secondary">
          <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500/70" aria-hidden />
          <div className="min-w-0 flex flex-col gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="truncate text-content text-xs">Create Event</span>
            </div>
            <input
              type="text"
              className="w-full text-xs px-2 py-1 rounded border border-edge bg-surface"
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              placeholder="Event title"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateEvent(); } }}
            />
            <label className="inline-flex items-center gap-2 text-xs text-content-secondary">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              All-day
            </label>
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-md border border-edge bg-surface-secondary hover:bg-surface-hover"
                onClick={() => void handleCreateEvent()}
              >
                Create Event
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end mt-2">
        <button
          type="button"
          className="text-xs px-2 py-1 rounded-md border border-edge bg-surface-secondary hover:bg-surface-hover"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
