import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { X, Trash2, Calendar as CalendarIcon, MapPin, Palette, Tag } from "lucide-react";
import { toast } from "sonner";

const eventColorSwatchClasses: Record<"blue" | "green" | "amber" | "red" | "purple" | "gray", string> = {
  blue: "bg-indigo-600",
  green: "bg-emerald-500",
  amber: "bg-indigo-600/70",
  red: "bg-red-500",
  purple: "bg-indigo-700",
  gray: "bg-content-muted",
};

export default function InlineEventEditor({ eventId, onClose, documentIdForAssociation }: { eventId: Id<"events">; onClose: () => void; documentIdForAssociation?: Id<"documents"> | null }) {
  const ev = useQuery(api.domains.calendar.events.getEvent, { eventId });
  const updateEvent = useMutation(api.domains.calendar.events.updateEvent);
  const deleteEvent = useMutation(api.domains.calendar.events.deleteEvent);

  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState<boolean>(false);
  const [startStr, setStartStr] = useState<string>("");
  const [endStr, setEndStr] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [status, setStatus] = useState<"confirmed" | "tentative" | "cancelled">("confirmed");
  const [color, setColor] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved" | "unsaved">("idle");
  const lastSavedRef = useRef<string>("");
  const getEditorJsonRef = useRef<null | (() => Promise<any>)>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [showTagsEditor, setShowTagsEditor] = useState(false);

  useEffect(() => {
    if (!ev) return;
    setTitle(ev.title ?? "");
    setAllDay(!!ev.allDay);
    setStartStr(ev.startTime ? toInputDateTimeLocal(ev.startTime) : "");
    setEndStr(ev.endTime ? toInputDateTimeLocal(ev.endTime) : "");
    setLocation(ev.location ?? "");
    setStatus((ev.status as any) ?? "confirmed");
    setDescription(ev.description ?? "");
    setColor(ev.color ?? "");
    setTags(Array.isArray(ev.tags) ? ev.tags : []);
    lastSavedRef.current = JSON.stringify({
      title: ev.title ?? "",
      allDay: !!ev.allDay,
      startStr: ev.startTime ? toInputDateTimeLocal(ev.startTime) : "",
      endStr: ev.endTime ? toInputDateTimeLocal(ev.endTime) : "",
      location: ev.location ?? "",
      status: (ev.status as any) ?? "confirmed",
      description: ev.description ?? "",
      color: ev.color ?? "",
      tags: Array.isArray(ev.tags) ? ev.tags : [],
    });
  }, [ev]);

  // Track unsaved changes for Save button state
  useEffect(() => {
    if (!ev) return;
    const current = JSON.stringify({ title, allDay, startStr, endStr, location, status, description, color, tags });
    if (current === lastSavedRef.current) {
      setSaveHint((prev) => (prev === "saved" ? "saved" : "idle"));
    } else {
      setSaveHint("unsaved");
    }
  }, [title, allDay, startStr, endStr, location, status, description, color, tags, ev]);

  const save = useCallback(async () => {
    if (!ev) return;
    setIsSaving(true);
    setSaveHint("saving");
    try {
      const startMs = startStr ? fromInputDateTimeLocal(startStr) : undefined;
      const endMs = endStr ? fromInputDateTimeLocal(endStr) : undefined;
      let descriptionJson: string | undefined = undefined;
      try {
        const getter = getEditorJsonRef.current;
        if (getter) {
          const json = await getter();
          if (json) descriptionJson = JSON.stringify(json);
        }
      } catch { /* ignore */ }
      await updateEvent({
        eventId,
        title: title.trim() || ev.title,
        allDay,
        startTime: startMs,
        endTime: endMs,
        location: location.trim(),
        status,
        documentId: documentIdForAssociation ?? undefined,
        description: description.trim(),
        color: color || undefined,
        tags,
        descriptionJson,
      });
      lastSavedRef.current = JSON.stringify({ title: title.trim() || ev.title, allDay, startStr, endStr, location: location.trim(), status, description: description.trim(), color, tags });
      setSaveHint("saved");
      setTimeout(() => setSaveHint("idle"), 1200);
    } catch (e) {
      console.error(e);
      toast.error("Failed to save event");
    } finally {
      setIsSaving(false);
    }
  }, [ev, updateEvent, eventId, title, allDay, startStr, endStr, location, status, description, color, tags, documentIdForAssociation]);

  const handleDelete = useCallback(async () => {
    if (!ev) return;
    const ok = window.confirm("Delete this event?");
    if (!ok) return;
    try {
      await deleteEvent({ eventId });
      toast.success("Event deleted");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Failed to delete event");
    }
  }, [deleteEvent, ev, eventId, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, onClose]);

  if (ev === undefined) {
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
  if (!ev) return null;

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
          <div className="text-xs text-content-muted">{saveHint === "saving" ? "Saving…" : saveHint === "saved" ? "Saved" : saveHint === "unsaved" ? "Unsaved changes" : ""}</div>
          <button
            onClick={() => { void save(); }}
            disabled={saveHint !== "unsaved" || isSaving}
            className={`h-7 px-3 rounded-md flex items-center justify-center border text-[12px] ${saveHint === "unsaved" && !isSaving ? "bg-primary text-primary-foreground border-primary/30 hover:opacity-90" : "bg-surface-secondary text-content-secondary border-edge opacity-70 cursor-not-allowed"}`}
            title="Save changes"
          >
            <span className="inline-flex items-center gap-1"><CalendarIcon className="w-3.5 h-3.5" /> Save</span>
          </button>
          <button
            onClick={() => { void handleDelete(); }}
            className="w-7 h-7 rounded-md flex items-center justify-center bg-surface-secondary hover:bg-red-500 text-content-secondary hover:text-white border border-edge hover:border-red-500"
            title="Delete event"
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

      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full text-sm bg-transparent border border-transparent rounded-md px-0 py-1 text-content focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring"
          placeholder="Untitled event"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAllDay((v) => !v)}
            className="pill pill--time inline-flex items-center gap-1 text-xs"
            title="Toggle allâ€‘day"
          >
            <CalendarIcon className="w-3 h-3 opacity-70" /> {allDay ? "Allâ€‘day" : "Timed"}
          </button>
          {/* Status pills */}
          <div className="inline-flex items-center gap-1 ml-2">
            {(["confirmed", "tentative", "cancelled"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`pill inline-flex items-center gap-1 text-xs ${status === s ? "bg-primary text-primary-foreground border-primary/30" : "bg-surface-secondary text-content-secondary border-edge"}`}
                title={`Set status: ${s}`}
              >
                {s === "confirmed" ? "Confirmed" : s === "tentative" ? "Tentative" : "Cancelled"}
              </button>
            ))}
          </div>

          {/* Start/End chips */}
          <button
            type="button"
            onClick={() => setShowStartPicker((v) => !v)}
            className="pill pill--time inline-flex items-center gap-1 text-xs"
            title="Set start"
            aria-expanded={showStartPicker}
          >
            <CalendarIcon className="w-3 h-3 opacity-70" />
            {startStr ? `Start: ${startStr}` : "Start"}
          </button>
          <button
            type="button"
            onClick={() => setShowEndPicker((v) => !v)}
            className="pill pill--time inline-flex items-center gap-1 text-xs"
            title="Set end"
            aria-expanded={showEndPicker}
          >
            <CalendarIcon className="w-3 h-3 opacity-70" />
            {endStr ? `End: ${endStr}` : "End"}
          </button>

          {/* Tags chip */}
          <button
            type="button"
            onClick={() => setShowTagsEditor((v) => !v)}
            className="pill pill--time inline-flex items-center gap-1 text-xs"
            title="Edit tags"
            aria-expanded={showTagsEditor}
          >
            <Tag className="w-3 h-3 opacity-70" /> {tags.length > 0 ? `${tags.length} tag${tags.length > 1 ? "s" : ""}` : "Tags"}
          </button>
        </div>

        {(showStartPicker || showEndPicker) && (
          <div className="flex flex-wrap gap-3">
            {showStartPicker && (
              <input
                type="datetime-local"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                disabled={allDay}
                className="text-sm bg-transparent border border-transparent rounded-md px-0 py-1 text-content focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring"
              />
            )}
            {showEndPicker && (
              <input
                type="datetime-local"
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
                disabled={allDay}
                className="text-sm bg-transparent border border-transparent rounded-md px-0 py-1 text-content focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring"
              />
            )}
          </div>
        )}

        {/* Location chip and inline input */}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <button
            type="button"
            onClick={() => setShowLocation((v) => !v)}
            className="pill pill--time inline-flex items-center gap-1 text-xs"
            title="Set location"
            aria-expanded={showLocation}
          >
            <MapPin className="w-3 h-3 opacity-70" />
            {location ? (location.length > 24 ? `${location.slice(0, 24)}…` : location) : "Location"}
          </button>
        </div>
        {showLocation && (
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Where is this event?"
              className="text-sm bg-transparent border border-transparent rounded-md px-0 py-1 text-content focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring"
            />
          </div>
        )}

        {/* Color row with inline palette */}
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <span className="text-xs text-content-secondary">Color</span>
          <span className="pill pill--time inline-flex items-center gap-1 text-xs">
            <Palette className="w-3 h-3 opacity-70" /> {color || "None"}
          </span>
          <div className="flex items-center gap-1">
            {(["blue","green","amber","red","purple","gray"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-5 w-5 rounded-full border border-edge focus:outline-none focus:ring-1 focus:ring-ring ${
                  eventColorSwatchClasses[c]
                } ${color === c ? "ring-2 ring-offset-1 ring-ring" : ""}`}
                title={c}
              />
            ))}
            <button
              type="button"
              onClick={() => setColor("")}
              className="text-xs px-2 py-0.5 rounded border border-edge text-content-secondary bg-surface-secondary"
              title="Clear color"
            >
              Clear
            </button>
          </div>
        </div>

        {showTagsEditor && (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-edge bg-surface-secondary">
                {t}
                <button
                  type="button"
                  onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                  className="text-xs opacity-70 hover:opacity-100"
                  title="Remove tag"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              placeholder="Add tag…"
              className="text-xs bg-transparent border border-transparent rounded-md px-1.5 py-0.5 text-content focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring"
              onKeyDown={(e) => {
                const el = e.currentTarget;
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

        {/* Description - unified rich editor */}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Write details…"
          className="w-full min-h-[60px] px-3 py-2 text-sm border border-edge/60 rounded-md bg-surface-secondary text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />

        {/* Location moved to chip with inline input */}
      </div>
    </div>
  );
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
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  return dt.getTime();
}

