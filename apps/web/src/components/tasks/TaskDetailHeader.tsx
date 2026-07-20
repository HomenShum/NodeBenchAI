import { useMemo } from "react";
import MetaPills from "@/shared/components/MetaPills";
import { taskToPills } from "../../lib/metaPillMappers";
import { shapeTaskForPills } from "../../lib/tasks";

export function TaskDetailHeader({ task }: { task: any }) {
  const shaped = shapeTaskForPills(task);
  const { title, dueAt, project, link, updatedAt, priority, details } = shaped;
  const pills = useMemo(
    () => taskToPills({ title, dueAt, project, link, updatedAt, priority, details }),
    [title, dueAt, project, link, updatedAt, priority, details]
  );
  return (
    <header className="space-y-2">
      <h1 className="text-lg font-semibold">{title}</h1>
      <MetaPills pills={pills} max={5} typePillClassName="border-sky-300 text-sky-700 bg-sky-100 dark:border-sky-800 dark:text-sky-200 dark:bg-sky-900/40" />
    </header>
  );
}
