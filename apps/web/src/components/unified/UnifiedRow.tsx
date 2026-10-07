import { useState } from "react";
import { Star, FileText, MoreHorizontal, Edit3, Share2, Trash2 } from "lucide-react";
import type { UnifiedItem } from "@/types/unified";

export function UnifiedRow({
  item,
  isSelected,
  onOpen,
  onToggleFavorite,
  onToggleDone,
  formatTimeAgo,
  formatDue,
  onRename,
  onArchive,
  onShare,
  ariaSelected,
}: {
  item: UnifiedItem;
  isSelected: boolean;
  onOpen: (item: UnifiedItem, event?: any) => void;
  onToggleFavorite: (item: UnifiedItem) => void;
  onToggleDone: (item: UnifiedItem) => void; // no-op for docs
  formatTimeAgo: (ts: number) => string;
  formatDue: (ts: number) => string;
  onRename?: (item: UnifiedItem) => void;
  onArchive?: (item: UnifiedItem) => void;
  onShare?: (item: UnifiedItem) => void;
  ariaSelected?: boolean;
}) {
  const isTask = item.type === "task";
  const overdue = isTask && item.dueDate && item.status !== "done" && item.dueDate < Date.now();

  return (
    <div
      className={`sidebar-item group relative flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer transition-all duration-200 mx-1.5
        ${isSelected
          ? 'bg-surface-hover text-content font-medium'
          : 'hover:bg-surface-hover text-content-secondary hover:text-content'}
      `}
      onClick={(e) => onOpen(item, e)}
      role="option"
      aria-selected={ariaSelected ?? isSelected}
    >
      {/* Active indicator - left border accent */}
      {isSelected && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 bg-[var(--accent-primary)] rounded-full"
          aria-hidden="true"
        />
      )}

      {/* Icon/Checkbox */}
      {isTask ? (
        <input
          type="checkbox"
          checked={item.status === "done"}
          onChange={(e) => { e.stopPropagation(); onToggleDone(item); }}
          className="h-4 w-4 accent-[rgb(79, 70, 229)] cursor-pointer flex-shrink-0"
          title={item.status === 'done' ? 'Mark as todo' : 'Mark as done'}
        />
      ) : (
        <FileText className="h-4 w-4 flex-shrink-0 text-content-secondary" />
      )}

      {/* Overdue indicator */}
      {overdue && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" title="Overdue" />}

      {/* Title */}
      <span className="flex-1 truncate font-medium">{item.title}</span>

      {/* Right-side metadata */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isTask && item.dueDate && (
          <span className="text-xs text-content-secondary opacity-0 group-hover:opacity-100 transition-opacity">
            {formatDue(item.dueDate)}
          </span>
        )}
        <span className="text-xs text-content-secondary opacity-0 group-hover:opacity-100 transition-opacity">
          {formatTimeAgo(item.updatedAt)}
        </span>

        {/* Favorite button */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(item); }}
          className={`p-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200 rounded hover:bg-surface-secondary ${item.isFavorite ? 'opacity-100 text-yellow-500' : 'text-content-secondary hover:text-content'}`}
          title={item.isFavorite ? 'Unpin' : 'Pin'}
          aria-label={item.isFavorite ? 'Unpin' : 'Pin'}
        >
          <Star className={`h-3.5 w-3.5 ${item.isFavorite ? 'fill-current' : ''}`} />
        </button>

        {/* Kebab menu for documents */}
        {!isTask && (
          <div className="relative">
            <MenuButton item={item} onRename={onRename} onArchive={onArchive} onShare={onShare} />
          </div>
        )}
      </div>
    </div>
  );
}

function MenuButton({
  item,
  onRename,
  onArchive,
  onShare,
}: {
  item: UnifiedItem;
  onRename?: (item: UnifiedItem) => void;
  onArchive?: (item: UnifiedItem) => void;
  onShare?: (item: UnifiedItem) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const close = () => setIsOpen(false);

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen((v) => !v); }}
        className="p-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200 rounded hover:bg-surface-secondary text-content-secondary hover:text-content"
        title="More"
        aria-label="More"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {isOpen && (
        <div
          className="absolute right-0 mt-1 bg-surface rounded-lg shadow-lg border border-edge z-20 p-1.5 min-w-[120px]"
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={close}
        >
          <div className="flex flex-col gap-0.5">
            <button
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-content-secondary hover:bg-surface-hover hover:text-content transition-colors text-left w-full"
              title="Rename"
              aria-label="Rename"
              onClick={() => { onRename?.(item); close(); }}
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span>Rename</span>
            </button>
            <button
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-content-secondary hover:bg-surface-hover hover:text-content transition-colors text-left w-full"
              title="Share"
              aria-label="Share"
              onClick={() => { onShare?.(item); close(); }}
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>Share</span>
            </button>
            <div className="border-t border-edge my-0.5"></div>
            <button
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-red-600 hover:bg-red-50 transition-colors text-left w-full"
              title="Delete"
              aria-label="Delete"
              onClick={() => { onArchive?.(item); close(); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
