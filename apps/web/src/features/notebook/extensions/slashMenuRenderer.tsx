/**
 * Slash Menu Renderer — floating React menu for the slash command extension.
 *
 * Kit parity: see Notebook.jsx lines 347-373 for SlashMenu component; notebook.css
 * .nb-slash, .nb-slash-item, .is-active, .nb-slash-icon etc.
 */
import { createRoot, type Root } from "react-dom/client";
import { useEffect, useImperativeHandle, useState, forwardRef } from "react";
import { Hash, Sparkles, Layers, BookOpen } from "lucide-react";
import type { SlashItem, SlashRendererHandle } from "./slashCommand";

type SlashMenuProps = {
  items: SlashItem[];
  command: (item: SlashItem) => void;
};

export type SlashMenuRef = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

function iconFor(item: SlashItem) {
  if (item.key === "h2") return Hash;
  if (item.key === "card") return Layers;
  if (item.key === "cite") return BookOpen;
  return Sparkles;
}

export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(
  ({ items, command }, ref) => {
    const [active, setActive] = useState(0);

    useEffect(() => {
      setActive(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "ArrowUp") {
          setActive((prev) => (prev + items.length - 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          setActive((prev) => (prev + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "Enter") {
          const item = items[active];
          if (item) {
            command(item);
            return true;
          }
        }
        if (event.key === "Escape") {
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="nb-slash" role="listbox" aria-label="Slash commands">
          <div className="nb-slash-head">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            <span className="text-xs text-gray-500">No matches</span>
          </div>
        </div>
      );
    }

    return (
      <div className="nb-slash" role="listbox" aria-label="Slash commands">
        <div className="nb-slash-head">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          <span className="text-[11px] text-gray-500 font-mono">
            type to filter…
          </span>
          <span className="ml-auto text-[10px] text-gray-400 font-mono">
            up/down · enter · esc
          </span>
        </div>
        {items.map((item, idx) => {
          const Icon = iconFor(item);
          const isActive = idx === active;
          return (
            <div
              key={item.key}
              role="option"
              aria-selected={isActive}
              className={`nb-slash-item ${isActive ? "is-active" : ""}`}
              onMouseEnter={() => setActive(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                command(item);
              }}
            >
              <span className={`nb-slash-icon ${item.accent ? "is-accent" : ""}`}>
                <Icon className="h-3 w-3" aria-hidden="true" />
              </span>
              <span>{item.label}</span>
              <span className="nb-slash-key">{item.hint}</span>
            </div>
          );
        })}
      </div>
    );
  },
);
SlashMenu.displayName = "SlashMenu";

type ClientRect = { left: number; top: number; bottom: number };

type SuggestionProps = {
  editor: unknown;
  range: unknown;
  query: string;
  text: string;
  items: SlashItem[];
  command: (item: SlashItem) => void;
  decorationNode: Element | null;
  clientRect?: (() => ClientRect | null) | null;
};

export function createSlashRenderer(): SlashRendererHandle {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let refApi: { current: SlashMenuRef | null } = { current: null };

  const mount = (props: SuggestionProps) => {
    if (!container) {
      container = document.createElement("div");
      container.style.position = "absolute";
      container.style.zIndex = "9999";
      container.style.pointerEvents = "auto";
      document.body.appendChild(container);
      root = createRoot(container);
    }
    const setRef = (r: SlashMenuRef | null) => {
      refApi.current = r;
    };
    root?.render(
      <SlashMenu ref={setRef} items={props.items} command={props.command} />,
    );
    position(props);
  };

  const position = (props: SuggestionProps) => {
    if (!container) return;
    const rect = props.clientRect?.();
    if (!rect) return;
    container.style.left = `${rect.left}px`;
    container.style.top = `${rect.bottom + 6}px`;
  };

  const destroy = () => {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
    refApi.current = null;
  };

  return {
    onStart: (props) => mount(props as SuggestionProps),
    onUpdate: (props) => mount(props as SuggestionProps),
    onKeyDown: ({ event }) => {
      if (event.key === "Escape") {
        destroy();
        return true;
      }
      return refApi.current?.onKeyDown(event) ?? false;
    },
    onExit: () => destroy(),
  };
}
