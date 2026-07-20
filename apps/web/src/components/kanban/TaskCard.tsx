import { useMemo } from "react";
import MetaPills from "@/shared/components/MetaPills";
import { taskToPills } from "../../lib/metaPillMappers";
import { shapeTaskForPills, reorderTaskPillsForTightRows } from "../../lib/tasks";
import type { Doc } from "../../../convex/_generated/dataModel";

export default function TaskCard({ task }: { task: Doc<any> }) {
  const shaped = shapeTaskForPills(task);
  const { title, dueAt, project, link, updatedAt, priority, details } = shaped;
  const pills = useMemo(
    () => reorderTaskPillsForTightRows(taskToPills({ title, dueAt, project, link, updatedAt, priority, details })),
    [title, dueAt, project, link, updatedAt, priority, details]
  );
  return (
    <div className="kanban-card">
      <div className="font-medium truncate">{title}</div>
      <MetaPills
        pills={pills}
        max={4}
        typePillClassName="border-sky-300 text-sky-700 bg-sky-100 dark:border-sky-800 dark:text-sky-200 dark:bg-sky-900/40"
      />
    </div>
  );
}
