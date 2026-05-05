/**
 * ShortcutsOverlay — global keyboard cheatsheet, opened with `?` or via the command palette.
 *
 * Listens for both the `?` keypress (when not in an input) and the custom
 * `rd:shortcuts:open` event dispatched from the command palette.
 */

import { useEffect, useState } from "react";

interface ShortcutGroup {
  label: string;
  rows: Array<{ keys: string[]; description: string }>;
}

const GROUPS: ShortcutGroup[] = [
  {
    label: "Global",
    rows: [
      { keys: ["⌘", "K"], description: "Open command palette" },
      { keys: ["?"], description: "Show this overlay" },
      { keys: ["⌘", "\\"], description: "Toggle writing focus mode" },
      { keys: ["Esc"], description: "Close any palette / popover · stop generating in chat" },
    ],
  },
  {
    label: "Navigation",
    rows: [
      { keys: ["G", "H"], description: "Home" },
      { keys: ["G", "R"], description: "Reports" },
      { keys: ["G", "C"], description: "Chat" },
      { keys: ["G", "I"], description: "Inbox" },
      { keys: ["G", "M"], description: "Me · Personal Context" },
    ],
  },
  {
    label: "Inbox",
    rows: [
      { keys: ["j"], description: "Next item" },
      { keys: ["k"], description: "Previous item" },
      { keys: ["a"], description: "Accept" },
      { keys: ["r"], description: "Reject" },
      { keys: ["e"], description: "Edit" },
      { keys: ["m"], description: "Move" },
    ],
  },
  {
    label: "Chat composer",
    rows: [
      { keys: ["/"], description: "Slash commands palette (at line start)" },
      { keys: ["@"], description: "Mention an entity" },
      { keys: ["Enter"], description: "Send · runs research saves to Reports" },
      { keys: ["Shift", "Enter"], description: "Newline" },
      { keys: ["⌘", "Enter"], description: "Send (also)" },
    ],
  },
  {
    label: "Notebook editor",
    rows: [
      { keys: ["/"], description: "Block insert menu (at empty paragraph)" },
      { keys: ["⌘", "B"], description: "Bold" },
      { keys: ["⌘", "I"], description: "Italic" },
      { keys: ["⌘", "Z"], description: "Undo" },
      { keys: ["⌘", "⇧", "Z"], description: "Redo" },
    ],
  },
];

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (e.key === "?" && !inField && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onCustom = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("rd:shortcuts:open", onCustom);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("rd:shortcuts:open", onCustom);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="rd-shortcuts__backdrop" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setOpen(false)}>
      <div className="rd-shortcuts" onClick={(e) => e.stopPropagation()}>
        <header className="rd-shortcuts__head">
          <h2>Keyboard shortcuts</h2>
          <button className="rd-shortcuts__close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </header>
        <div className="rd-shortcuts__grid">
          {GROUPS.map((g) => (
            <section key={g.label} className="rd-shortcuts__group">
              <div className="rd-shortcuts__group-label">{g.label}</div>
              <div className="rd-shortcuts__rows">
                {g.rows.map((r, i) => (
                  <div key={i} className="rd-shortcuts__row">
                    <span className="rd-shortcuts__keys">
                      {r.keys.map((k, j) => (
                        <kbd key={j}>{k}</kbd>
                      ))}
                    </span>
                    <span className="rd-shortcuts__desc">{r.description}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
