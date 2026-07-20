import { ChevronRight } from "lucide-react";
import type { ViewBreadcrumbItem } from "@/lib/registry/viewBreadcrumbs";

interface ViewBreadcrumbsProps {
  items: ViewBreadcrumbItem[];
  onNavigate: (item: ViewBreadcrumbItem) => void;
}

export function ViewBreadcrumbs({ items, onNavigate }: ViewBreadcrumbsProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 overflow-x-auto text-[11px] text-content-muted">
      {items.map((item, index) => (
        <div key={item.id} className="flex shrink-0 items-center gap-1">
          {index > 0 && <ChevronRight className="h-3 w-3 opacity-50" aria-hidden="true" />}
          {item.isCurrent ? (
            <span className="rounded px-1.5 py-0.5 font-medium text-content-secondary">{item.label}</span>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate(item)}
              className="rounded px-1.5 py-0.5 transition-colors hover:bg-surface-hover hover:text-content"
            >
              {item.label}
            </button>
          )}
        </div>
      ))}
    </nav>
  );
}

export default ViewBreadcrumbs;
