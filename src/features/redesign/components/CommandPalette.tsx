/**
 * CommandPalette — global ⌘K / Ctrl+K spotlight.
 *
 * Pattern: Linear / Raycast / Cursor. One keyboard shortcut to navigate, run a command,
 * or jump to an entity. Lives at the redesign layout level so every surface gets it.
 *
 * V1 commands are static (navigation + common actions). When the inbox aggregator + style
 * profile tables ship, this can read live entities + saved searches via useQuery.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

interface PaletteCommand {
  id: string;
  group: "navigate" | "create" | "action" | "entity";
  label: string;
  hint?: string;
  shortcut?: string;
  run: () => void;
  keywords?: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Optional extra commands injected by surface that opened it. */
  extra?: PaletteCommand[];
}

export function CommandPalette({ open, onClose, extra = [] }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const baseCommands: PaletteCommand[] = useMemo(() => [
    { id: "go-home", group: "navigate", label: "Go to Home", shortcut: "G H", run: () => navigate("/redesign"), keywords: "dashboard pulse" },
    { id: "go-reports", group: "navigate", label: "Go to Reports", shortcut: "G R", run: () => navigate("/redesign/reports"), keywords: "library memory" },
    { id: "go-chat", group: "navigate", label: "Go to Chat", shortcut: "G C", run: () => navigate("/redesign/chat"), keywords: "ask question converse" },
    { id: "go-inbox", group: "navigate", label: "Go to Inbox", shortcut: "G I", run: () => navigate("/redesign/inbox"), keywords: "review queue accept" },
    { id: "go-me", group: "navigate", label: "Go to Me · Personal Context", shortcut: "G M", run: () => navigate("/redesign/me"), keywords: "user.md profile preferences" },
    { id: "go-workspace", group: "navigate", label: "Open Workspace", run: () => navigate("/redesign/workspace"), keywords: "graph map sources" },

    { id: "new-report", group: "create", label: "New report", hint: "Run diligence on a new entity", run: () => navigate("/redesign/chat?intent=new-report"), keywords: "create research" },
    { id: "new-batch", group: "create", label: "Run on a list", hint: "Spin up a batch across a universe", run: () => navigate("/redesign/chat?intent=batch"), keywords: "universe bulk" },
    { id: "new-capture", group: "create", label: "Quick capture", hint: "Drop an idea into Inbox · captures", run: () => navigate("/redesign/inbox?lane=captures&intent=new"), keywords: "note paste" },

    { id: "act-shortcuts", group: "action", label: "Show all keyboard shortcuts", shortcut: "?", run: () => { window.dispatchEvent(new CustomEvent("rd:shortcuts:open")); }, keywords: "help kbd" },
    { id: "act-toggle-theme", group: "action", label: "Toggle dark / light mode", run: () => { document.documentElement.classList.toggle("dark"); }, keywords: "theme appearance" },
    { id: "act-focus-mode", group: "action", label: "Toggle writing focus mode", shortcut: "⌘\\", run: () => { document.body.setAttribute("data-redesign-focus-mode", document.body.getAttribute("data-redesign-focus-mode") === "on" ? "off" : "on"); }, keywords: "zen distraction" },

    { id: "ent-orbital",  group: "entity", label: "Orbital Labs",  hint: "Voice-agent eval · Series Seed",  run: () => navigate("/redesign/reports/rep_orbital") },
    { id: "ent-anthropic", group: "entity", label: "Anthropic",     hint: "MCP host extensions · Q3",        run: () => navigate("/redesign/reports/rep_anthropic") },
    { id: "ent-mode",      group: "entity", label: "Mode Analytics", hint: "Voice + healthcare prior",       run: () => navigate("/redesign/reports/rep_orbital") },
  ], [navigate]);

  const all = useMemo(() => [...baseCommands, ...extra], [baseCommands, extra]);

  const filtered = useMemo(() => {
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      (c.hint ?? "").toLowerCase().includes(q) ||
      (c.keywords ?? "").toLowerCase().includes(q),
    );
  }, [all, query]);

  // Reset active index when filter changes
  useEffect(() => { setActive(0); }, [query]);

  // Focus input on open + reset query
  useEffect(() => {
    if (open) {
      setQuery("");
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Keyboard: Esc / Up / Down / Enter
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[active];
        if (cmd) { cmd.run(); onClose(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active, onClose]);

  if (!open) return null;

  // Group filtered commands
  const groups: Record<string, PaletteCommand[]> = { navigate: [], create: [], action: [], entity: [] };
  for (const c of filtered) groups[c.group].push(c);
  const GROUP_LABEL: Record<string, string> = { navigate: "Navigate", create: "Create", action: "Action", entity: "Entity" };

  let cursor = 0;
  return (
    <div className="rd-cmdk__backdrop" role="dialog" aria-modal="true" aria-label="Command palette" onClick={onClose}>
      <div className="rd-cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="rd-cmdk__head">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, entities, and shortcuts…"
            aria-label="Command palette search"
            spellCheck={false}
          />
          <span className="rd-cmdk__esc" aria-label="Close">Esc</span>
        </div>
        <div className="rd-cmdk__list" role="listbox">
          {filtered.length === 0 && (
            <div className="rd-cmdk__empty">No commands match "{query}"</div>
          )}
          {(["navigate","create","action","entity"] as const).map((g) => {
            if (groups[g].length === 0) return null;
            return (
              <div key={g} className="rd-cmdk__group">
                <div className="rd-cmdk__group-label">{GROUP_LABEL[g]}</div>
                {groups[g].map((c) => {
                  const idx = cursor++;
                  const isActive = idx === active;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive || undefined}
                      className="rd-cmdk__row"
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => { c.run(); onClose(); }}
                    >
                      <span className="rd-cmdk__row-label">{c.label}</span>
                      {c.hint && <span className="rd-cmdk__row-hint">{c.hint}</span>}
                      {c.shortcut && (
                        <span className="rd-cmdk__row-kbd">
                          {c.shortcut.split(" ").map((k, i) => <kbd key={i}>{k}</kbd>)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

/** Hook: wires Cmd+K / Ctrl+K to open the palette. Returns { open, setOpen }. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      // / opens palette when not typing in a field
      if (e.key === "k" && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // No-op — Cmd+K is the canonical trigger. Letter "k" is reserved for fuzzy navigation later.
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}
