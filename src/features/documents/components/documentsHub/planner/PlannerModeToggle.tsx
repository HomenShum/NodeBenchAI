import { ListTodo, KanbanSquare, CalendarDays } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ai-ui/tabs";

export type PlannerMode = "list" | "kanban" | "weekly";

export interface PlannerModeToggleProps {
  mode: PlannerMode;
  onChange: (mode: PlannerMode) => void;
}

export function PlannerModeToggle({ mode, onChange }: PlannerModeToggleProps) {
  return (
    <Tabs value={mode} onValueChange={(value) => onChange(value as PlannerMode)}>
      <TabsList
        className="h-auto overflow-hidden rounded-lg border border-edge bg-surface p-0"
        aria-label="Planner view selector"
      >
        <TabsTrigger
          value="list"
          className="flex items-center gap-2 rounded-none px-3 py-2 text-sm text-content-secondary shadow-none hover:bg-surface-hover hover:text-content data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
          title="Tasks View"
          aria-keyshortcuts="1"
          id="planner-tab-list"
        >
          <ListTodo className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Tasks View</span>
        </TabsTrigger>

        <TabsTrigger
          value="kanban"
          className="flex items-center gap-2 rounded-none px-3 py-2 text-sm text-content-secondary shadow-none hover:bg-surface-hover hover:text-content data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
          title="Kanban view"
          aria-keyshortcuts="2"
          id="planner-tab-kanban"
        >
          <KanbanSquare className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Kanban</span>
        </TabsTrigger>

        <TabsTrigger
          value="weekly"
          className="flex items-center gap-2 rounded-none px-3 py-2 text-sm text-content-secondary shadow-none hover:bg-surface-hover hover:text-content data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
          title="Weekly view"
          aria-keyshortcuts="3"
          id="planner-tab-weekly"
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Weekly</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
