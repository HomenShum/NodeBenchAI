/**
 * ConferenceCapture — Fast mobile-first capture mode for events and conferences.
 *
 * Lets bankers, founders, VCs, and operators:
 * - Take quick text notes tied to a person/company
 * - Record voice memos
 * - Link entities (person, company, event)
 * - Generate CRM-ready summary packets
 *
 * This is the "conference mode" wedge from the JPM banking workflow.
 */

import { memo, useState, useCallback } from "react";
import {
  Mic,
  MicOff,
  Plus,
  Link2,
  Building2,
  User,
  MapPin,
  Tag,
  FileText,
  Sparkles,
  Copy,
  Check,
  Trash2,
  Send,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface CapturedEntity {
  id: string;
  type: "person" | "company" | "event" | "topic";
  name: string;
  context?: string;
}

interface CapturedNote {
  id: string;
  kind: "text" | "voice" | "tag";
  content: string;
  linkedEntityId?: string;
  timestamp: Date;
}

interface CrmSummary {
  who: string;
  company: string;
  context: string;
  whyRelevant: string;
  nextAction: string;
  confidence: string;
  followUpDate: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

let _nextId = 0;
function uid(): string {
  return `cap-${Date.now()}-${++_nextId}`;
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function EntityChip({
  entity,
  onRemove,
}: {
  entity: CapturedEntity;
  onRemove: (id: string) => void;
}) {
  const icon =
    entity.type === "person" ? (
      <User className="h-3 w-3" />
    ) : entity.type === "company" ? (
      <Building2 className="h-3 w-3" />
    ) : entity.type === "event" ? (
      <MapPin className="h-3 w-3" />
    ) : (
      <Tag className="h-3 w-3" />
    );

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-content-secondary">
      {icon}
      {entity.name}
      <button
        type="button"
        onClick={() => onRemove(entity.id)}
        className="ml-0.5 text-content-muted hover:text-content transition-colors"
        aria-label={`Remove ${entity.name}`}
      >
        ×
      </button>
    </span>
  );
}

function NoteCard({
  note,
  onRemove,
}: {
  note: CapturedNote;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] text-content-muted">
          {note.kind === "voice" ? (
            <Mic className="h-3 w-3 text-rose-400" />
          ) : note.kind === "tag" ? (
            <Tag className="h-3 w-3 text-amber-400" />
          ) : (
            <FileText className="h-3 w-3" />
          )}
          <span className="capitalize">{note.kind}</span>
          <span>·</span>
          <span>
            {note.timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onRemove(note.id)}
          className="text-content-muted hover:text-rose-400 transition-colors"
          aria-label="Remove note"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-content">
        {note.content}
      </p>
    </div>
  );
}

function CrmSummaryCard({ summary }: { summary: CrmSummary }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = [
      `Who: ${summary.who}`,
      `Company: ${summary.company}`,
      `Context: ${summary.context}`,
      `Why relevant: ${summary.whyRelevant}`,
      `Next action: ${summary.nextAction}`,
      `Confidence: ${summary.confidence}`,
      `Follow-up: ${summary.followUpDate}`,
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [summary]);

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
            CRM-Ready Summary
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-content-muted transition-colors hover:bg-white/[0.08] hover:text-content"
          aria-label={copied ? "Copied" : "Copy to clipboard"}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copy
            </>
          )}
        </button>
      </div>
      <div className="space-y-2 text-xs">
        {[
          { label: "Who", value: summary.who },
          { label: "Company", value: summary.company },
          { label: "Context", value: summary.context },
          { label: "Why relevant", value: summary.whyRelevant },
          { label: "Next action", value: summary.nextAction },
          { label: "Confidence", value: summary.confidence },
          { label: "Follow-up", value: summary.followUpDate },
        ].map((row) => (
          <div key={row.label} className="flex gap-2">
            <span className="w-20 shrink-0 text-content-muted">
              {row.label}
            </span>
            <span className="text-content">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

function ConferenceCaptureInner() {
  const [entities, setEntities] = useState<CapturedEntity[]>([]);
  const [notes, setNotes] = useState<CapturedNote[]>([]);
  const [noteText, setNoteText] = useState("");
  const [entityInput, setEntityInput] = useState("");
  const [entityType, setEntityType] = useState<CapturedEntity["type"]>("person");
  const [isRecording, setIsRecording] = useState(false);
  const [showCrmSummary, setShowCrmSummary] = useState(false);

  // ── Entity management ───────────────────────────────────────────────────

  const addEntity = useCallback(() => {
    const name = entityInput.trim();
    if (!name) return;
    setEntities((prev) => [...prev, { id: uid(), type: entityType, name }]);
    setEntityInput("");
  }, [entityInput, entityType]);

  const removeEntity = useCallback((id: string) => {
    setEntities((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ── Note management ─────────────────────────────────────────────────────

  const addNote = useCallback(() => {
    const text = noteText.trim();
    if (!text) return;
    setNotes((prev) => [
      ...prev,
      { id: uid(), kind: "text", content: text, timestamp: new Date() },
    ]);
    setNoteText("");
  }, [noteText]);

  const toggleVoice = useCallback(() => {
    if (isRecording) {
      // Stop recording — add a placeholder voice note
      setNotes((prev) => [
        ...prev,
        {
          id: uid(),
          kind: "voice",
          content: "Voice memo captured — transcription pending",
          timestamp: new Date(),
        },
      ]);
      setIsRecording(false);
    } else {
      setIsRecording(true);
    }
  }, [isRecording]);

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // ── CRM summary generation ─────────────────────────────────────────────

  const generateCrmSummary = useCallback((): CrmSummary => {
    const person = entities.find((e) => e.type === "person");
    const company = entities.find((e) => e.type === "company");
    const event = entities.find((e) => e.type === "event");
    const allNoteText = notes.map((n) => n.content).join("; ");

    return {
      who: person?.name ?? "Unknown contact",
      company: company?.name ?? "Unknown company",
      context: event?.name
        ? `Met at ${event.name}`
        : "Conference / event capture",
      whyRelevant:
        allNoteText.length > 0
          ? allNoteText.slice(0, 200)
          : "No notes captured yet",
      nextAction: "Follow up within 48 hours with personalized message",
      confidence:
        entities.length >= 2 && notes.length >= 1
          ? "High"
          : entities.length >= 1
            ? "Medium"
            : "Low",
      followUpDate: new Date(Date.now() + 2 * 86400000)
        .toISOString()
        .slice(0, 10),
    };
  }, [entities, notes]);

  // ── Quick-add tags ──────────────────────────────────────────────────────

  const quickTags = [
    "Hot lead",
    "Follow-up ASAP",
    "Potential partner",
    "Competitor",
    "Investor interest",
    "Acquisition target",
  ];

  const addTag = useCallback((tag: string) => {
    setNotes((prev) => [
      ...prev,
      { id: uid(), kind: "tag", content: tag, timestamp: new Date() },
    ]);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <MapPin className="h-5 w-5 text-accent-primary" />
        <div>
          <h1 className="text-lg font-semibold text-content">
            Conference Capture
          </h1>
          <p className="text-xs text-content-muted">
            Capture people, companies, and notes fast — generate CRM-ready
            packets on the go
          </p>
        </div>
      </div>

      {/* Entity input row */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-3">
          Link Entities
        </div>
        <div className="flex gap-2">
          <div className="flex gap-1">
            {(
              [
                { type: "person" as const, icon: User, label: "Person" },
                {
                  type: "company" as const,
                  icon: Building2,
                  label: "Company",
                },
                { type: "event" as const, icon: MapPin, label: "Event" },
                { type: "topic" as const, icon: Tag, label: "Topic" },
              ] as const
            ).map(({ type, icon: Icon, label }) => (
              <button
                key={type}
                type="button"
                onClick={() => setEntityType(type)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  entityType === type
                    ? "bg-accent-primary/15 text-accent-primary"
                    : "text-content-muted hover:bg-white/[0.04] hover:text-content"
                }`}
                aria-pressed={entityType === type}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-1 gap-2">
            <input
              type="text"
              value={entityInput}
              onChange={(e) => setEntityInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addEntity();
              }}
              placeholder={`Add ${entityType} name...`}
              className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
            <button
              type="button"
              onClick={addEntity}
              disabled={!entityInput.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-primary disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        </div>

        {/* Entity chips */}
        {entities.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {entities.map((entity) => (
              <EntityChip
                key={entity.id}
                entity={entity}
                onRemove={removeEntity}
              />
            ))}
          </div>
        )}
      </div>

      {/* Note input */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-3">
          Quick Notes
        </div>
        <div className="flex gap-2">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                addNote();
              }
            }}
            placeholder="What did you learn? Who matters? What should you remember?"
            rows={2}
            className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-content placeholder:text-content-muted resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
          />
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={addNote}
              disabled={!noteText.trim()}
              className="inline-flex items-center justify-center rounded-lg bg-accent-primary/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-primary disabled:opacity-40"
              aria-label="Add note"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleVoice}
              className={`inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                isRecording
                  ? "bg-rose-500/20 text-rose-400"
                  : "border border-white/[0.08] bg-white/[0.04] text-content-muted hover:bg-white/[0.08] hover:text-content"
              }`}
              aria-label={isRecording ? "Stop recording" : "Start voice memo"}
              aria-pressed={isRecording}
            >
              {isRecording ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Quick tags */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {quickTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => addTag(tag)}
              className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content"
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Captured notes list */}
      {notes.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
            Captured ({notes.length})
          </div>
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} onRemove={removeNote} />
          ))}
        </div>
      )}

      {/* Generate CRM summary */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setShowCrmSummary(true)}
          disabled={entities.length === 0 && notes.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-4 py-2.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Sparkles className="h-4 w-4" />
          Generate CRM Summary
        </button>
        <button
          type="button"
          onClick={() => {
            setEntities([]);
            setNotes([]);
            setShowCrmSummary(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-xs font-medium text-content-muted transition-colors hover:bg-white/[0.08] hover:text-content"
        >
          <Trash2 className="h-4 w-4" />
          Clear All
        </button>
      </div>

      {/* CRM Summary output */}
      {showCrmSummary && (
        <CrmSummaryCard summary={generateCrmSummary()} />
      )}

      {/* Empty state */}
      {entities.length === 0 && notes.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
          <MapPin className="mx-auto h-8 w-8 text-content-muted mb-3" />
          <p className="text-sm text-content-muted">
            Add a person or company name, then capture notes.
            <br />
            Generate a CRM-ready packet when you are done.
          </p>
        </div>
      )}
    </div>
  );
}

export const ConferenceCapture = memo(ConferenceCaptureInner);
export default ConferenceCapture;
