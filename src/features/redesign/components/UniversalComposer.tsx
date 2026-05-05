/**
 * UniversalComposer — single input that handles ask / capture / paste / upload / record.
 *
 * Feel: ChatGPT / Claude chat composer.
 *   - The textarea is the focal point inside a single rounded card.
 *   - Top row: context chip (left) + model/tier dropdown (right).
 *   - Bottom row: `+` tools menu (left) · mic (left) · keyboard hint · circular send (right).
 *   - Tools / paid-tier hints / estimates live behind the dropdown popover, not as a 4-pill row.
 *
 * Spec: "no provider names in UI" — the dropdown shows tiers (Auto / Quick / Deep / Compare),
 * not model names. Provider names appear only in the trace.
 *
 * Submit: Enter sends. Shift+Enter inserts newline. ⌘↵ also sends.
 */

import { useState, useRef, useEffect } from "react";

export type RouterTier = "auto" | "answer" | "deep" | "compare";

export interface RouterTierOption {
  id: RouterTier;
  label: string;
  hint: string;
  estimateMs: number;
  paidCall: boolean;
}

export const DEFAULT_TIERS: RouterTierOption[] = [
  { id: "auto",    label: "Auto",                hint: "Memory-first · NodeBench picks the right engine",  estimateMs: 1800,  paidCall: false },
  { id: "answer",  label: "Quick answer",        hint: "Fast pass · cached sources only",                  estimateMs: 800,   paidCall: false },
  { id: "deep",    label: "Deep dive",           hint: "Refresh sources · paid call may be required",      estimateMs: 7500,  paidCall: true  },
  { id: "compare", label: "Compare across list", hint: "Run on every entity in this view",                 estimateMs: 12000, paidCall: true  },
];

export type ComposerMode = "chat" | "research";

export interface BatchTarget {
  universeId: string;
  universeName: string;
  entityCount: number;
}

interface UniversalComposerProps {
  contextLabel: string;
  onContextChange?: () => void;
  /** Fired when "Run on a list →" is chosen with a target universe + the prompt. */
  onRunOnList?: (text: string, tier: RouterTier, target: BatchTarget) => void;
  /** Available universes for the batch picker. */
  batchTargets?: BatchTarget[];
  /**
   * Default submit (Enter, ⌘↵, or "Run research" button). Mode = "research" by default.
   * Mirrors live nodebenchai.com — research saves to Reports; chat is ephemeral.
   */
  onSubmit?: (text: string, tier: RouterTier, mode: ComposerMode) => void;
  /**
   * Optional separate handler for "Chat now" — a lighter, ephemeral inline thread.
   * If omitted, the Chat-now button hides and only Run-research shows.
   */
  onChatNow?: (text: string, tier: RouterTier) => void;
  placeholder?: string;
  hideAttachments?: boolean;
  tier?: RouterTier;
  onTierChange?: (tier: RouterTier) => void;
  tiers?: RouterTierOption[];
  /**
   * Show the live runtime-promises ribbon under the composer:
   *   "Continues if the phone locks · Saves to Reports · Export to Notes, Notion, Linear, CSV"
   * Defaults true on Home, false elsewhere.
   */
  showRuntimeRibbon?: boolean;
  /** When true, the Run-research button becomes a Stop button (interrupt streaming). */
  streaming?: boolean;
  /** Called when user clicks Stop (or presses Esc while streaming). */
  onStop?: () => void;
  /** Entity suggestions for @ mention autocomplete. */
  entitySuggestions?: Array<{ slug: string; label: string; kind?: string }>;
}

/** Slash commands surfaced in the in-composer palette (typed `/` at line start). */
const SLASH_COMMANDS: Array<{ id: string; label: string; hint: string; insert: string }> = [
  { id: "diligence",   label: "/diligence",    hint: "Run a banker-style diligence pass on an entity",     insert: "/diligence " },
  { id: "compare",     label: "/compare",      hint: "Compare two or more entities side by side",          insert: "/compare " },
  { id: "checksource", label: "/check-source", hint: "Verify a claim against the source list",             insert: "/check-source " },
  { id: "summarize",   label: "/summarize",    hint: "Summarize the last N items in this thread",          insert: "/summarize " },
  { id: "runlist",     label: "/run-on-list",  hint: "Run the prompt across a saved universe",             insert: "/run-on-list " },
  { id: "tearsheet",   label: "/tear-sheet",   hint: "Generate a one-pager for an entity",                 insert: "/tear-sheet " },
];

export function UniversalComposer({
  contextLabel,
  onContextChange,
  onSubmit,
  onChatNow,
  onRunOnList,
  batchTargets = [],
  placeholder = "Ask anything — a company, a market, or a question...",
  hideAttachments,
  tier: tierProp,
  onTierChange,
  tiers = DEFAULT_TIERS,
  showRuntimeRibbon = false,
  streaming = false,
  onStop,
  entitySuggestions = [
    { slug: "orbital", label: "Orbital Labs", kind: "company" },
    { slug: "anthropic", label: "Anthropic", kind: "company" },
    { slug: "mode", label: "Mode Analytics", kind: "company" },
    { slug: "alex", label: "Alex Chen", kind: "person" },
    { slug: "ship_demo", label: "Ship Demo Day", kind: "event" },
    { slug: "voice_eval", label: "Voice-agent evaluation", kind: "topic" },
  ],
}: UniversalComposerProps) {
  const [batchOpen, setBatchOpen] = useState(false);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [tierInternal, setTierInternal] = useState<RouterTier>("auto");
  const [tierMenuOpen, setTierMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; size: number; kind: string }>>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const tier = tierProp ?? tierInternal;
  const setTier = (t: RouterTier) => {
    if (tierProp === undefined) setTierInternal(t);
    onTierChange?.(t);
    setTierMenuOpen(false);
  };
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const tierBtnRef = useRef<HTMLButtonElement | null>(null);
  const toolsBtnRef = useRef<HTMLButtonElement | null>(null);
  const activeTier = tiers.find((t) => t.id === tier) ?? tiers[0];

  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = "auto";
    taRef.current.style.height = `${Math.min(taRef.current.scrollHeight, 240)}px`;
  }, [text]);

  // Click-outside dismiss for popovers
  useEffect(() => {
    if (!tierMenuOpen && !toolsMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (tierMenuOpen && tierBtnRef.current && t && !tierBtnRef.current.parentElement?.contains(t)) {
        setTierMenuOpen(false);
      }
      if (toolsMenuOpen && toolsBtnRef.current && t && !toolsBtnRef.current.parentElement?.contains(t)) {
        setToolsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [tierMenuOpen, toolsMenuOpen]);

  // Esc dismisses any open popover
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTierMenuOpen(false);
        setToolsMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const handleSubmit = (mode: ComposerMode = "research") => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (mode === "chat" && onChatNow) {
      onChatNow(trimmed, tier);
    } else {
      onSubmit?.(trimmed, tier, mode);
    }
    setText("");
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Esc while streaming → stop generation (highest priority)
    if (e.key === "Escape" && streaming && onStop) {
      e.preventDefault();
      onStop();
      return;
    }
    // Esc closes any composer popover
    if (e.key === "Escape") {
      setSlashOpen(false);
      setMentionOpen(false);
      return;
    }
    // Slash command palette: open when "/" typed at start of line
    if (e.key === "/" && (text === "" || text.endsWith("\n"))) {
      // Let the "/" land, then open palette
      window.setTimeout(() => setSlashOpen(true), 0);
    }
    // @ mention: track caret position and surface entity picker
    if (e.key === "@") {
      window.setTimeout(() => { setMentionOpen(true); setMentionQuery(""); }, 0);
    }
    if (e.key === "Enter" && !e.shiftKey && !slashOpen && !mentionOpen) {
      e.preventDefault();
      handleSubmit("research");
    }
  };

  const handleTextChange = (next: string) => {
    setText(next);
    // Maintain mention state by reading the chars after the last unmatched "@"
    const at = next.lastIndexOf("@");
    if (at >= 0 && /^[\w-]*$/.test(next.slice(at + 1))) {
      setMentionOpen(true);
      setMentionQuery(next.slice(at + 1).toLowerCase());
    } else if (mentionOpen) {
      setMentionOpen(false);
    }
    // Maintain slash state — close once user types beyond a recognizable command
    if (slashOpen && !next.startsWith("/")) setSlashOpen(false);
  };

  const insertAtCaret = (insertText: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const next = text.slice(0, start) + insertText + text.slice(end);
    setText(next);
    window.setTimeout(() => {
      ta.focus();
      const pos = start + insertText.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  const pickSlash = (cmd: typeof SLASH_COMMANDS[number]) => {
    setText(cmd.insert);
    setSlashOpen(false);
    window.setTimeout(() => taRef.current?.focus(), 0);
  };

  const pickMention = (entity: typeof entitySuggestions[number]) => {
    const at = text.lastIndexOf("@");
    if (at < 0) return;
    setText(text.slice(0, at) + `[[${entity.label}]] ` + text.slice(at + 1 + mentionQuery.length));
    setMentionOpen(false);
    setMentionQuery("");
    window.setTimeout(() => taRef.current?.focus(), 0);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items.filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter((f): f is File => f != null);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const addFiles = (files: File[]) => {
    const next = files.map((f) => ({
      id: `${Date.now()}_${f.name}`,
      name: f.name,
      size: f.size,
      kind: f.type.startsWith("image/") ? "image" : f.type.includes("pdf") ? "pdf" : "file",
    }));
    setAttachments((prev) => [...prev, ...next]);
  };

  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id));

  const filteredEntities = entitySuggestions.filter((e) =>
    !mentionQuery || e.slug.toLowerCase().includes(mentionQuery) || e.label.toLowerCase().includes(mentionQuery),
  ).slice(0, 6);

  return (
    <div
      className="rd-card"
      style={{
        position: "relative",
        padding: "10px 12px 8px",
        background: "var(--rd-panel)",
        borderColor: "var(--rd-line-strong)",
        borderRadius: "var(--rd-r-lg)",
        boxShadow: "var(--rd-shadow-md)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        transition: "border-color 150ms ease, box-shadow 150ms ease",
      }}
    >
      {/* Top row — context chip · tier picker */}
      <div className="rd-row--between" style={{ gap: 8 }}>
        <button
          type="button"
          onClick={onContextChange}
          aria-label="Change context"
          className="rd-btn"
          style={{
            padding: "3px 9px",
            fontSize: 11,
            fontWeight: 590,
            background: "var(--rd-accent-tint)",
            color: "var(--rd-accent-strong)",
            border: "1px solid var(--rd-accent-ring)",
            borderRadius: "var(--rd-r-pill)",
            gap: 5,
            minWidth: 0,
          }}
        >
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span style={{
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240,
          }}>{contextLabel}</span>
          <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        <div style={{ position: "relative" }}>
          <button
            ref={tierBtnRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={tierMenuOpen}
            onClick={() => setTierMenuOpen((o) => !o)}
            className="rd-btn rd-btn--quiet"
            style={{
              padding: "4px 9px",
              fontSize: 11.5,
              fontWeight: 590,
              borderRadius: "var(--rd-r-pill)",
              border: "1px solid var(--rd-line-strong)",
              background: "var(--rd-panel)",
              color: "var(--rd-ink)",
              gap: 5,
            }}
          >
            <TierGlyph id={tier} />
            <span>{activeTier.label}</span>
            {activeTier.paidCall && <PaidBadge active={false} />}
            <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {tierMenuOpen && (
            <div
              role="listbox"
              aria-label="Response tier"
              style={{
                position: "absolute",
                bottom: "calc(100% + 6px)",
                right: 0,
                minWidth: 300,
                padding: 4,
                background: "var(--rd-panel-elevated)",
                border: "1px solid var(--rd-line-strong)",
                borderRadius: 12,
                boxShadow: "var(--rd-shadow-lg)",
                zIndex: 30,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div className="rd-eyebrow" style={{ padding: "8px 10px 4px", fontSize: 9.5 }}>
                Response tier
              </div>
              {tiers.map((t) => {
                const active = t.id === tier;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => setTier(t.id)}
                    className="rd-btn"
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: active ? "var(--rd-accent-tint)" : "transparent",
                      border: "1px solid transparent",
                      color: "var(--rd-ink)",
                      width: "100%",
                      gap: 10,
                      textAlign: "left",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      justifyContent: "flex-start",
                    }}
                  >
                    <div className="rd-row--between" style={{ width: "100%", gap: 8 }}>
                      <div className="rd-row" style={{ gap: 6 }}>
                        <TierGlyph id={t.id} />
                        <span style={{
                          fontSize: 13,
                          fontWeight: 590,
                          color: active ? "var(--rd-accent-strong)" : "var(--rd-ink-strong)",
                        }}>{t.label}</span>
                        {t.paidCall && <PaidBadge active={active} />}
                      </div>
                      <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>
                        ~{formatEstimate(t.estimateMs)}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 11.5,
                      color: active ? "var(--rd-ink-mute)" : "var(--rd-ink-soft)",
                      lineHeight: 1.4,
                    }}>{t.hint}</span>
                  </button>
                );
              })}
              <div style={{
                borderTop: "1px solid var(--rd-line-faint)",
                padding: "8px 10px",
                marginTop: 4,
              }}>
                <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>
                  Provider names appear in the trace, not here.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Textarea — focal */}
      <div
        style={{ position: "relative" }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (files.length > 0) addFiles(files);
        }}
      >
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={1}
          style={{
            width: "100%",
            minHeight: 44,
            maxHeight: 240,
            resize: "none",
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--rd-ink)",
            font: "inherit",
            fontSize: 14.5,
            lineHeight: 1.5,
            padding: "8px 4px 4px",
          }}
        />

        {/* Slash command palette — opens when text starts with / */}
        {slashOpen && (
          <div className="rd-composer-palette" role="listbox" aria-label="Commands">
            <div className="rd-composer-palette__head">Commands</div>
            {SLASH_COMMANDS.filter((c) => c.label.startsWith(text.split(/\s/)[0] ?? "")).map((cmd) => (
              <button
                key={cmd.id}
                type="button"
                role="option"
                className="rd-composer-palette__row"
                onClick={() => pickSlash(cmd)}
              >
                <span className="rd-composer-palette__label">{cmd.label}</span>
                <span className="rd-composer-palette__hint">{cmd.hint}</span>
              </button>
            ))}
          </div>
        )}

        {/* @ mention entity picker */}
        {mentionOpen && filteredEntities.length > 0 && (
          <div className="rd-composer-palette" role="listbox" aria-label="Mention entity">
            <div className="rd-composer-palette__head">Mention an entity</div>
            {filteredEntities.map((e) => (
              <button
                key={e.slug}
                type="button"
                role="option"
                className="rd-composer-palette__row"
                onClick={() => pickMention(e)}
              >
                <span className="rd-composer-palette__label">{e.label}</span>
                <span className="rd-composer-palette__hint">{e.kind ?? "entity"} · @{e.slug}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Attachment chip strip — visible when files were pasted or dropped */}
      {attachments.length > 0 && (
        <div className="rd-composer-attachments" role="list" aria-label="Attached files">
          {attachments.map((a) => (
            <span key={a.id} className="rd-composer-attachment" role="listitem">
              <span className="rd-composer-attachment__icon" aria-hidden="true">
                {a.kind === "image" ? "🖼" : a.kind === "pdf" ? "📄" : "📎"}
              </span>
              <span className="rd-composer-attachment__name">{a.name}</span>
              <span className="rd-composer-attachment__size">{(a.size / 1024).toFixed(0)}KB</span>
              <button
                type="button"
                className="rd-composer-attachment__close"
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.name}`}
              >×</button>
            </span>
          ))}
        </div>
      )}

      {/* Bottom row — tools + send */}
      <div className="rd-row--between" style={{ gap: 8 }}>
        <div className="rd-row" style={{ gap: 4 }}>
          {!hideAttachments && (
            <>
              <div style={{ position: "relative" }}>
                <button
                  ref={toolsBtnRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={toolsMenuOpen}
                  aria-label="Add"
                  title="Attach, paste, or upload"
                  onClick={() => setToolsMenuOpen((o) => !o)}
                  className="rd-btn rd-btn--quiet"
                  style={{
                    width: 32, height: 32, padding: 0, borderRadius: "50%",
                    border: "1px solid var(--rd-line)",
                    background: toolsMenuOpen ? "var(--rd-muted)" : "var(--rd-panel)",
                    color: "var(--rd-ink-mute)",
                  }}
                >
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>

                {toolsMenuOpen && (
                  <div
                    role="menu"
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 6px)",
                      left: 0,
                      minWidth: 220,
                      padding: 4,
                      background: "var(--rd-panel-elevated)",
                      border: "1px solid var(--rd-line-strong)",
                      borderRadius: 12,
                      boxShadow: "var(--rd-shadow-lg)",
                      zIndex: 30,
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                    }}
                  >
                    {[
                      { label: "Upload file", hint: "PDF, image, audio, doc", d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" },
                      { label: "Paste from clipboard", hint: "Ctrl+V", d: "M16 3h-3a2 2 0 0 0-4 0H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" },
                      { label: "Capture screen", hint: "Choose region", d: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" },
                      { label: "Open watchlist", hint: "Add to monitor", d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
                    ].map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        role="menuitem"
                        onClick={() => setToolsMenuOpen(false)}
                        className="rd-btn rd-btn--quiet"
                        style={{
                          width: "100%", justifyContent: "flex-start",
                          padding: "8px 10px", borderRadius: 8, gap: 10,
                        }}
                      >
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d={t.d} />
                        </svg>
                        <span style={{ flex: 1, textAlign: "left" }}>
                          <span style={{ display: "block", fontSize: 12.5, color: "var(--rd-ink-strong)", fontWeight: 510 }}>{t.label}</span>
                          <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>{t.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                aria-label={recording ? "Stop recording" : "Voice capture"}
                title={recording ? "Click to stop" : "Hold or click to record"}
                onClick={() => setRecording((r) => !r)}
                className="rd-btn rd-btn--quiet"
                style={{
                  width: 32, height: 32, padding: 0, borderRadius: "50%",
                  border: "1px solid var(--rd-line)",
                  background: recording ? "var(--rd-accent-soft)" : "var(--rd-panel)",
                  color: recording ? "var(--rd-accent-strong)" : "var(--rd-ink-mute)",
                }}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                </svg>
              </button>
            </>
          )}
          <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)", marginLeft: 6 }}>
            {recording ? "Listening…" : "⌘↵ Run research · Shift↵ newline"}
          </span>
        </div>

        <div className="rd-row" style={{ gap: 6 }}>
          {onChatNow && (
            <button
              type="button"
              onClick={() => handleSubmit("chat")}
              disabled={!text.trim()}
              aria-label="Chat now"
              title="Chat now — ephemeral inline thread, not saved to Reports"
              className="rd-btn rd-btn--quiet rd-btn--sm"
              style={{
                opacity: text.trim() ? 1 : 0.55,
                cursor: text.trim() ? "pointer" : "not-allowed",
                gap: 6,
              }}
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              Chat now
            </button>
          )}
          {streaming && onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generation"
              title="Stop generation (Esc)"
              className="rd-btn rd-btn--sm"
              style={{
                gap: 6,
                background: "var(--rd-amber)",
                borderColor: "var(--rd-amber)",
                color: "#fff",
              }}
            >
              <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSubmit("research")}
              disabled={!text.trim()}
              aria-label="Run research"
              title="Run research (Enter) — saves to Reports"
              className="rd-btn rd-btn--primary rd-btn--sm"
              style={{
                opacity: text.trim() ? 1 : 0.6,
                cursor: text.trim() ? "pointer" : "not-allowed",
                gap: 6,
              }}
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12l5-9 5 9-5 9-5-9zM12 3l5 9-5 9M22 12l-5-9-5 9 5 9 5-9z" />
              </svg>
              Run research
            </button>
          )}
          {onRunOnList && batchTargets.length > 0 && (
            <button
              type="button"
              onClick={() => setBatchOpen((v) => !v)}
              disabled={!text.trim()}
              aria-label="Run on a list"
              aria-expanded={batchOpen}
              title="Multiply this prompt across an entity universe"
              className="rd-btn rd-btn--quiet rd-btn--sm"
              style={{
                opacity: text.trim() ? 1 : 0.6,
                cursor: text.trim() ? "pointer" : "not-allowed",
                gap: 4,
              }}
            >
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h13M3 12h13M3 18h13" />
                <circle cx="20" cy="6" r="1.5" /><circle cx="20" cy="12" r="1.5" /><circle cx="20" cy="18" r="1.5" />
              </svg>
              Run on a list
            </button>
          )}
        </div>
      </div>

      {batchOpen && onRunOnList && batchTargets.length > 0 && (
        <div
          role="menu"
          aria-label="Choose universe"
          style={{
            border: "1px solid var(--rd-line-strong)",
            borderRadius: 10,
            background: "var(--rd-panel-elevated)",
            padding: 6,
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            boxShadow: "var(--rd-shadow-md)",
          }}
        >
          <div className="rd-eyebrow" style={{ padding: "6px 8px 4px" }}>
            Run this prompt across…
          </div>
          {batchTargets.map((t) => (
            <button
              key={t.universeId}
              role="menuitem"
              className="rd-btn rd-btn--quiet"
              style={{
                width: "100%", justifyContent: "space-between",
                padding: "8px 10px", borderRadius: 6,
              }}
              onClick={() => {
                if (text.trim()) {
                  onRunOnList(text.trim(), tier, t);
                  setText("");
                  setBatchOpen(false);
                }
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                <span style={{ fontSize: 12.5, color: "var(--rd-ink-strong)", fontWeight: 510 }}>{t.universeName}</span>
              </span>
              <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>
                {t.entityCount} entities
              </span>
            </button>
          ))}
          <div style={{ borderTop: "1px solid var(--rd-line-faint)", padding: "8px 10px", marginTop: 4 }}>
            <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>
              Sample 3 first · then run full batch · cancel anytime
            </span>
          </div>
        </div>
      )}

      {showRuntimeRibbon && (
        <div
          className="rd-row"
          aria-label="Runtime promises"
          style={{
            gap: 6,
            paddingTop: 8,
            borderTop: "1px solid var(--rd-line-faint)",
            flexWrap: "wrap",
          }}
        >
          {[
            { d: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2", label: "Continues if the phone locks" },
            { d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8", label: "Saves to Reports" },
            { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3", label: "Export to Notes, Notion, Linear, CSV" },
          ].map((p) => (
            <span
              key={p.label}
              className="rd-pill"
              style={{
                background: "transparent",
                fontWeight: 510,
                gap: 6,
                padding: "3px 10px",
              }}
            >
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={p.d} />
              </svg>
              {p.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatEstimate(ms: number): string {
  if (ms < 1500) return `${ms}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

function PaidBadge({ active }: { active: boolean }) {
  return (
    <span
      aria-label="May use a paid call"
      title="May use a paid call — approval required if budget hits zero"
      className="rd-mono"
      style={{
        fontSize: 9.5,
        padding: "1px 5px",
        borderRadius: 4,
        background: active ? "var(--rd-amber-bg)" : "var(--rd-paper-warm)",
        color: active ? "var(--rd-amber)" : "var(--rd-ink-soft)",
        border: `1px solid ${active ? "var(--rd-amber)" : "var(--rd-line)"}`,
        fontWeight: 700,
      }}
    >$</span>
  );
}

function TierGlyph({ id }: { id: RouterTier }) {
  const map: Record<RouterTier, string> = {
    auto:    "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4",
    answer:  "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
    deep:    "M11 21a8 8 0 1 0-8-8 8 8 0 0 0 8 8zM21 21l-4.35-4.35",
    compare: "M3 6h13M3 12h13M3 18h13M21 6h0M21 12h0M21 18h0",
  };
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={map[id]} />
    </svg>
  );
}
