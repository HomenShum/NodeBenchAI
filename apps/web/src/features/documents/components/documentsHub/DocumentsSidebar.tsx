import { Plus, Sparkles, FileText, Grid3X3, Edit3 } from "lucide-react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { sanitizeDocumentTitle } from "@/lib/displayText";
import { TaskRowGlobal } from "./rows";

interface DocumentsSidebarProps {
  recentTasks: any[] | undefined;
  recentDocuments: any[] | undefined;
  density: "comfortable" | "compact";
  loggedInUser: any;
  onAddTask: () => void;
  onSelectTask: (id: Id<"userEvents">) => void;
  onUpdateTaskStatus: (
    taskId: Id<"userEvents">,
    status: "todo" | "in_progress" | "done" | "blocked",
  ) => Promise<void> | void;
  onSelectDocument: (id: Id<"documents">) => void;
  onCreateDocument: (kind: "text" | "calendar") => Promise<void> | void;
  isCompiling: boolean;
  onCompileAaplModel: () => void;
}

export function DocumentsSidebar({
  recentTasks,
  recentDocuments,
  density,
  loggedInUser,
  onAddTask,
  onSelectTask,
  onUpdateTaskStatus,
  onSelectDocument,
  onCreateDocument,
  isCompiling,
  onCompileAaplModel,
}: DocumentsSidebarProps) {
  const compileButtonClass = isCompiling
    ? "text-xs px-3 py-2 rounded-md transition-colors col-span-2 bg-surface-secondary text-content-muted border border-edge cursor-not-allowed"
    : "text-xs px-3 py-2 rounded-md transition-colors col-span-2 bg-surface-secondary text-content border border-edge hover:bg-surface-hover";

  return (
    <div className="lg:col-span-1 space-y-8">
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-content flex items-center gap-2">
            <Edit3 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            Activity
          </h2>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAddTask}
              className="btn-primary-sm flex items-center gap-2 text-sm"
              disabled={!loggedInUser}
              title={!loggedInUser ? "Please sign in to create tasks" : undefined}
            >
              <Plus className="h-4 w-4" /> New Task
            </button>
          </div>
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent mb-6"></div>

        <div className="space-y-3">
          {(recentTasks?.length ?? 0) === 0 ? (
            <div className="bg-surface-secondary border border-edge rounded-lg p-6 text-center">
              <p className="text-content-secondary mb-3">No recent tasks</p>

              <button
                type="button"
                onClick={onAddTask}
                className="btn-primary-sm"
                disabled={!loggedInUser}
              >
                Create your first task
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {recentTasks?.map((task: any) => (
                <TaskRowGlobal
                  key={task._id}
                  t={task}
                  density={density}
                  onSelect={(id) => onSelectTask(id as Id<"userEvents">)}
                  onChangeStatus={(id, status) =>
                    onUpdateTaskStatus(
                      id as Id<"userEvents">,
                      status as "todo" | "in_progress" | "done" | "blocked",
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          Highlights
        </h2>

        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent mb-4"></div>

        <ul className="space-y-2 text-sm text-content-secondary">
          <li>• Review today and plan next actions.</li>
          <li>• Check Calendar for this week's schedule.</li>
          <li>• Use Kanban to organize tasks by status.</li>
        </ul>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
          <FileText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          Recent Documents
        </h2>

        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent mb-4"></div>

        {(recentDocuments?.length ?? 0) === 0 ? (
          <p className="text-sm text-content-secondary">No recent documents</p>
        ) : (
          <ul className="space-y-2 pb-24 lg:pb-12">
            {recentDocuments?.slice(0, 5).map((doc: any) => (
              <li key={doc._id}>
                <button
                  type="button"
                  className="w-full text-left text-sm px-3 py-2 rounded-md border border-edge bg-surface-secondary hover:bg-surface-hover text-content transition-colors"
                  onClick={() => onSelectDocument(doc._id as Id<"documents">)}
                  title={sanitizeDocumentTitle(doc.title, "Untitled")}
                >
                  <span className="line-clamp-1">{sanitizeDocumentTitle(doc.title, "Untitled")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
          <Grid3X3 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          Tools
        </h2>

        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent mb-4"></div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onCreateDocument("text")}
            className="btn-primary-sm px-3 py-2"
          >
            New Doc
          </button>

          <button
            type="button"
            onClick={() => onCreateDocument("calendar")}
            className="text-xs px-3 py-2 bg-surface text-content border border-edge rounded-md hover:bg-surface-hover transition-colors"
          >
            Calendar
          </button>

          <button
            type="button"
            onClick={onCompileAaplModel}
            disabled={isCompiling}
            className={compileButtonClass}
          >
            {isCompiling ? "Compiling…" : "Compile AAPL Model"}
          </button>
        </div>
      </div>
    </div>
  );
}
