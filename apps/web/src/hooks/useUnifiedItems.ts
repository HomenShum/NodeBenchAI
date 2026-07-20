import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { docToUnified, taskToUnified } from "@/adapters/unifiedAdapters";
import type { UnifiedItem } from "@/types/unified";

type SortKey = "updated" | "created" | "title" | "due" | "priority";
type SortOrder = "asc" | "desc";
type GroupBy = "smart" | "project" | "type" | "status" | "dueBucket" | "favorites";

export function useUnifiedItems(opts: {
  filterText?: string;
  sortBy?: SortKey;
  sortOrder?: SortOrder;
  groupBy?: GroupBy;
  openIds?: string[];              // keep existing behavior
}) {
  const { filterText = "", sortBy = "updated", sortOrder = "desc", groupBy = "smart", openIds = [] } = opts;
  const docs = useQuery(api.domains.documents.documents.getSidebarWithOptions, { sortBy: "updated", sortOrder: "desc" });
  const tasks = useQuery(api.domains.tasks.userEvents.listTasksByUpdatedDesc, { limit: 200 });

  const { items, groups } = useMemo(() => {
    if (!docs || !tasks) return { items: undefined, groups: undefined };
    const d = (docs as any[]).map(docToUnified);
    const t = (tasks as any[]).map(taskToUnified);
    let all = [...d, ...t];

    // Filter
    const ft = filterText.trim().toLowerCase();
    if (ft) {
      all = all.filter(i => i.title.toLowerCase().includes(ft) || (i.tags ?? []).some(tag => tag.toLowerCase().includes(ft)));
    }

    // Sort
    const dir = sortOrder === "asc" ? 1 : -1;
    const prRank: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 4 };
    all.sort((a, b) => {
      const A = a, B = b;
      switch (sortBy) {
        case "title": return (A.title.localeCompare(B.title)) * dir;
        case "created": return ((A.createdAt ?? 0) - (B.createdAt ?? 0)) * dir;
        case "due": {
          const ad = A.dueDate ?? Number.MAX_SAFE_INTEGER;
          const bd = B.dueDate ?? Number.MAX_SAFE_INTEGER;
          return (ad - bd) * dir;
        }
        case "priority": {
          const ap = prRank[A.priority ?? "low"] || 0;
          const bp = prRank[B.priority ?? "low"] || 0;
          if (ap !== bp) return (ap - bp) * dir;
          return ((A.updatedAt ?? 0) - (B.updatedAt ?? 0)) * dir;
        }
        case "updated":
        default: return ((A.updatedAt ?? 0) - (B.updatedAt ?? 0)) * dir;
      }
    });

    // Group
    const groups: Record<string, UnifiedItem[]> = {};
    const put = (k: string, it: UnifiedItem) => {
      groups[k] ??= [];
      groups[k].push(it);
    };

    const now = Date.now();
    const oneDay = 86400000;

    const dueBucket = (ts?: number | null) => {
      if (!ts) return "No Due Date";
      if (ts < now - oneDay) return "Overdue";
      if (ts < now + oneDay) return "Today";
      if (ts < now + 7 * oneDay) return "This Week";
      return "Later";
    };

    for (const it of all) {
      switch (groupBy) {
        case "type": put(it.type === "doc" ? "Documents" : "Tasks", it); break;
        case "status": put(it.status ?? "unknown", it); break;
        case "dueBucket": put(dueBucket(it.dueDate), it); break;
        case "project": put(it.projectId ? `Project:${it.projectId}` : "No Project", it); break;
        case "favorites": put(it.isFavorite ? "Pinned" : "Others", it); break;
        case "smart":
        default: {
          // Your existing "Pinned / Recent / This Week / Older"
          const recentCut = now - oneDay;
          const weekCut = now - 7 * oneDay;
          if (it.isFavorite) put("Pinned", it);
          else if (it.updatedAt > recentCut) put("Recent", it);
          else if (it.updatedAt > weekCut) put("This Week", it);
          else put("Older", it);
        }
      }
    }

    // Keep your "in-grid/openIds" as a synthetic group if needed
    if (openIds.length) {
      const openSet = new Set(openIds.map(String));
      const inGrid = all.filter(i => openSet.has(String(i.id)));
      if (inGrid.length) groups["In Grid"] = inGrid;
    }

    return { items: all.length ? all : [], groups };
  }, [docs, tasks, filterText, sortBy, sortOrder, groupBy, openIds]);

  return { items, groups };
}
