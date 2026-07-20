import type { UnifiedItem } from "@/types/unified";
import type { Id } from "../../convex/_generated/dataModel";

export const docToUnified = (doc: any) => ({
  id: String(doc._id),
  type: "doc" as const,
  title: doc.title || "Untitled Document",
  isFavorite: !!doc.isFavorite,
  status: doc.status ?? "active",
  priority: doc.priority ?? undefined,
  dueDate: doc.dueDate ?? null,
  updatedAt: (doc.lastModified ?? doc._creationTime) || 0,
  createdAt: doc._creationTime || 0,
  projectId: doc.projectId ?? null,
  tags: doc.tags ?? [],
});

export const taskToUnified = (t: any) => ({
  id: String(t._id),
  type: "task" as const,
  title: t.title || "(Untitled task)",
  isFavorite: !!t.isFavorite,
  status: t.status,
  priority: t.priority ?? "low",
  dueDate: t.dueDate ?? null,
  updatedAt: (t.updatedAt ?? t._creationTime) || 0,
  createdAt: t._creationTime || 0,
  projectId: t.projectId ?? null,
  tags: t.tags ?? [],
  sourceDocId: t.sourceDocId ?? null,
  sourceBlockId: t.sourceBlockId ?? null,
});
