import type { Pill } from "../ui/metaPillMappers";

export type ShapedTask = {
  title?: string;
  dueAt?: string; // keep as ISO/string for current mapper
  project?: string;
  link?: string;
  updatedAt?: string | number | Date;
  priority?: 'low' | 'med' | 'high' | 'urgent' | number;
  details?: string;
};

// Normalize a variety of task object shapes into the fields used for pill mapping
export function shapeTaskForPills(t: any): ShapedTask {
  return {
    title: t?.title ?? t?.name ?? t?.summary,
    dueAt: t?.dueAt ?? t?.due_date ?? t?.due ?? t?.dueDate,
    project: t?.project ?? t?.projectName ?? t?.meta?.project ?? t?.meta?.projectName,
    link: t?.link ?? t?.url ?? t?.meta?.link,
    updatedAt: t?.updatedAt ?? t?.updated ?? t?.modifiedAt ?? t?.meta?.updated,
    priority: t?.priority ?? t?.prio ?? t?.meta?.priority,
    details: t?.details ?? t?.note ?? t?.description ?? t?.subtitle ?? t?.meta?.details,
  };
}

// In tight rows, ensure highest-signal pills appear earlier.
// Order: type, when, details, project, link, updated. Optionally truncate to `max`.
export function reorderTaskPillsForTightRows(pills: Pill[], max?: number): Pill[] {
  const desired: ReadonlyArray<Pill["kind"]> = [
    "type",
    "when",
    "details",
    "project",
    "link",
    "updated",
  ];
  const rank = (k: Pill["kind"]) => {
    const i = desired.indexOf(k);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  const sorted = [...pills].sort((a, b) => rank(a.kind) - rank(b.kind));
  return typeof max === "number" ? sorted.slice(0, Math.max(1, max)) : sorted;
}

// Convenience: build and reorder pills for tight rows in one step
export function taskPillsForTightRow(
  shaped: ShapedTask,
  mapFn: (t: ShapedTask) => Pill[],
  max = 4,
) {
  return reorderTaskPillsForTightRows(mapFn(shaped), max);
}
