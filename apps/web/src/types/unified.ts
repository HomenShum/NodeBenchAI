export type WorkItemType = "doc" | "task";

export interface UnifiedItem {
  id: string;
  type: WorkItemType;
  title: string;
  isFavorite?: boolean;
  status?: "todo" | "in_progress" | "done" | "blocked" | "active" | "archived";
  priority?: "low" | "medium" | "high" | "urgent";
  dueDate?: number | null;
  updatedAt: number;
  createdAt: number;
  projectId?: string | null;
  tags?: string[];
  // Linking for tasks
  sourceDocId?: string | null;
  sourceBlockId?: string | null;
}
