/**
 * SlashPalette — the `/` command popover inside the notebook.
 *
 * Ships with four commands:
 *   /ai            → queue an AI generation (wires to agent harness — Phase 5)
 *   /search        → run a web search (pull sources)
 *   /deepresearch  → multi-step deep research
 *   @              → mention an entity (Phase 6 wires the entity autocomplete)
 *
 * This is the palette UI only. Each command's handler lives in the parent
 * (EntityNotebookLive) and is routed through `onCommand`.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export type SlashCommandId = "ai" | "search" | "deepresearch" | "mention";

export type SlashCommand = {
  id: SlashCommandId;
  label: string;
  description: string;
  icon: string;
  prompt?: string;
};

const COMMANDS: SlashCommand[] = [
  {
    id: "ai",
    label: "Generate",
    description: "write blocks from prompt",
    icon: "/ai",
  },
  {
    id: "search",
    label: "Web search",
    description: "pull fresh sources",
    icon: "/search",
  },
  {
    id: "deepresearch",
    label: "Deep research",
    description: "multi-step investigation",
    icon: "/deepresearch",
  },
  {
    id: "mention",
    label: "Mention entity",
    description: "link to another page",
    icon: "@",
  },
];

type Props = {
  onCommand: (command: SlashCommand) => void;
  onClose: () => void;
};

export function SlashPalette({ onCommand, onClose }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = COMMANDS.filter(
    (c) =>
      c.label.toLowerCase().includes(query.toLowerCase()) ||
      c.icon.toLowerCase().includes(query.toLowerCase()) ||
      c.description.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIndex]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((idx) => Math.min(idx + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((idx) => Math.max(idx - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const command = filtered[activeIndex];
      if (command) {
        onCommand({ ...command, prompt: query });
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-1 w-[340px] rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg dark:border-white/10 dark:bg-[#1a1a1b]"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <input
        type="text"
        autoFocus
        placeholder="Type a command…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        className="mb-1 w-full rounded-md border border-gray-100 bg-transparent px-2.5 py-1 text-sm text-gray-900 outline-none focus:border-gray-200 dark:border-white/[0.06] dark:text-gray-100 dark:focus:border-white/20"
      />
      {filtered.length === 0 ? (
        <div className="px-2.5 py-2 text-xs text-gray-500">No commands match.</div>
      ) : (
        filtered.map((cmd, idx) => (
          <button
            key={cmd.id}
            type="button"
            onMouseEnter={() => setActiveIndex(idx)}
            onClick={() => onCommand({ ...cmd, prompt: query })}
            className={`flex w-full items-center gap-3 rounded px-2.5 py-1.5 text-sm transition-colors ${
              idx === activeIndex
                ? "bg-gray-100 dark:bg-white/[0.05]"
                : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
            }`}
          >
            <span className="w-14 font-mono text-[11px] text-[var(--accent-primary)]">{cmd.icon}</span>
            <span className="flex-1 text-left text-gray-900 dark:text-gray-100">{cmd.label}</span>
            <span className="text-[11px] text-gray-500">{cmd.description}</span>
          </button>
        ))
      )}
    </div>
  );
}

export default SlashPalette;
