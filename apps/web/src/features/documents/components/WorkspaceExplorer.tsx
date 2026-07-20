/**
 * WorkspaceExplorer — Agent workspace file browser for the Docs surface.
 *
 * Shows workspace folders (skills, rules, tasks, research, notes, media)
 * with file lists, task board, and research citation panel.
 * Data comes from ~/.nodebench/workspace/ via the MCP server API.
 */

import { memo, useState, useEffect, useCallback, useMemo } from "react";
import {
  FolderOpen, FileText, Image, Video, Music, FileCode, FileSpreadsheet,
  ListTodo, BookOpen, Brain, ScrollText, Mic, Plus, RefreshCw, ExternalLink,
  CheckCircle2, Circle, Clock, AlertTriangle, Tag, ArrowUpRight,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────

interface WorkspaceFile {
  name: string;
  relativePath: string;
  type: string;
  size: string;
  modified: string;
}

interface FolderOverview {
  folder: string;
  fileCount: number;
  totalSize: string;
}

interface Task {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done" | "blocked";
  priority: "high" | "medium" | "low";
  due?: string;
  notes?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

interface ResearchResource {
  id: string;
  title: string;
  url: string;
  source: string;
  notes?: string;
  tags: string[];
  citation?: string;
  savedAt: string;
}

// ── Constants ────────────────────────────────────────────────────────────

const FOLDER_META: Record<string, { icon: typeof FolderOpen; label: string; description: string }> = {
  skills:   { icon: Brain,      label: "Skills",   description: "Agent skill definitions and procedures" },
  rules:    { icon: ScrollText, label: "Rules",    description: "Operating rules and constraints" },
  tasks:    { icon: ListTodo,   label: "Tasks",    description: "Task tracking and action items" },
  research: { icon: BookOpen,   label: "Research", description: "Research artifacts and citations" },
  notes:    { icon: FileText,   label: "Notes",    description: "Session notes and observations" },
  media:    { icon: Image,      label: "Media",    description: "Images, videos, audio, documents" },
};

const FILE_ICONS: Record<string, typeof FileText> = {
  markdown: FileText, text: FileText, json: FileCode, jsonl: FileCode,
  yaml: FileCode, csv: FileSpreadsheet, spreadsheet: FileSpreadsheet,
  image: Image, video: Video, audio: Music, document: FileText,
  code: FileCode, file: FileText,
};

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-500/15 text-red-400 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

const STATUS_ICONS: Record<string, typeof Circle> = {
  todo: Circle, in_progress: Clock, done: CheckCircle2, blocked: AlertTriangle,
};

// ── Main Component ───────────────────────────────────────────────────────

export const WorkspaceExplorer = memo(function WorkspaceExplorer() {
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [folders, setFolders] = useState<FolderOverview[]>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [resources, setResources] = useState<ResearchResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);

  // Fetch workspace overview
  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      // Try the workspace API (reads from ~/.nodebench/workspace/ on the server)
      const resp = await fetch("/api/workspace/list", { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json();
        if (data.ok && data.folders) {
          setFolders(data.folders);
          setLoading(false);
          return;
        }
      }
    } catch { /* API not available — use static fallback */ }

    // Fallback: show folder structure with zero counts
    setFolders(Object.entries(FOLDER_META).map(([key]) => ({
      folder: key,
      fileCount: 0,
      totalSize: "0B",
    })));
    setLoading(false);
  }, []);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  // Fetch files when a folder tab is selected
  useEffect(() => {
    if (!activeFolder || activeFolder === "overview") return;
    (async () => {
      try {
        const resp = await fetch(`/api/workspace/list?folder=${activeFolder}`, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
          const data = await resp.json();
          if (data.ok && data.files) setFiles(data.files);
        }
      } catch { /* API not available */ }
    })();
  }, [activeFolder]);

  const tabs = useMemo(() => [
    { id: "overview", label: "Overview" },
    { id: "tasks", label: "Tasks" },
    { id: "research", label: "Research" },
    ...Object.entries(FOLDER_META)
      .filter(([id]) => id !== "tasks" && id !== "research") // avoid duplicates
      .map(([id, meta]) => ({ id, label: meta.label })),
  ], []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.06] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white/90">Agent Workspace</h1>
            <p className="mt-0.5 text-[13px] text-white/50">
              Files created by agents — skills, rules, tasks, research, and media
            </p>
          </div>
          <button
            onClick={fetchOverview}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-white/60 transition-colors hover:bg-white/[0.08]"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-3 flex gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); if (tab.id !== "overview" && tab.id !== "tasks" && tab.id !== "research") setActiveFolder(tab.id); }}
              className={`shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-white/[0.10] text-white/90"
                  : "text-white/50 hover:bg-white/[0.04] hover:text-white/70"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {activeTab === "overview" && <OverviewPanel folders={folders} onSelectFolder={(f) => { setActiveTab(f); setActiveFolder(f); }} />}
        {activeTab === "tasks" && <TaskBoard tasks={tasks} />}
        {activeTab === "research" && <ResearchPanel resources={resources} />}
        {activeFolder && !["overview", "tasks", "research"].includes(activeTab) && (
          <FolderView folder={activeFolder} files={files} />
        )}
      </div>
    </div>
  );
});

// ── Overview Panel ───────────────────────────────────────────────────────

function OverviewPanel({ folders, onSelectFolder }: { folders: FolderOverview[]; onSelectFolder: (f: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {folders.map(f => {
        const meta = FOLDER_META[f.folder];
        if (!meta) return null;
        const Icon = meta.icon;
        return (
          <button
            key={f.folder}
            onClick={() => onSelectFolder(f.folder)}
            className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-colors hover:bg-white/[0.04] hover:border-white/[0.10]"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#d97757]/10">
              <Icon className="h-4.5 w-4.5 text-[#d97757]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white/80">{meta.label}</span>
                <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] tabular-nums text-white/40">
                  {f.fileCount}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-white/40">{meta.description}</p>
              {f.fileCount > 0 && (
                <p className="mt-1 text-[10px] text-white/30">{f.totalSize}</p>
              )}
            </div>
          </button>
        );
      })}

      {/* Getting started card */}
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-white/[0.10] bg-white/[0.01] p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
          <Plus className="h-4.5 w-4.5 text-white/40" />
        </div>
        <div>
          <span className="text-sm font-medium text-white/60">Getting started</span>
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/40">
            Agents create workspace files automatically during research runs. Use the Ask surface to start an investigation — files appear here.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Task Board ───────────────────────────────────────────────────────────

function TaskBoard({ tasks }: { tasks: Task[] }) {
  const columns = useMemo(() => ({
    todo: tasks.filter(t => t.status === "todo"),
    in_progress: tasks.filter(t => t.status === "in_progress"),
    done: tasks.filter(t => t.status === "done"),
    blocked: tasks.filter(t => t.status === "blocked"),
  }), [tasks]);

  const columnMeta = [
    { key: "todo" as const, label: "To Do", color: "text-white/60" },
    { key: "in_progress" as const, label: "In Progress", color: "text-blue-400" },
    { key: "done" as const, label: "Done", color: "text-emerald-400" },
    { key: "blocked" as const, label: "Blocked", color: "text-red-400" },
  ];

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ListTodo className="h-10 w-10 text-white/20" />
        <h3 className="mt-3 text-sm font-medium text-white/60">No tasks yet</h3>
        <p className="mt-1 max-w-sm text-[12px] text-white/40">
          Agents create tasks automatically during research runs. Start an investigation from the Ask surface to see tasks here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {columnMeta.map(col => (
        <div key={col.key}>
          <div className="flex items-center gap-2 pb-2">
            <span className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${col.color}`}>
              {col.label}
            </span>
            <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] tabular-nums text-white/40">
              {columns[col.key].length}
            </span>
          </div>
          <div className="space-y-2">
            {columns[col.key].map(task => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const StatusIcon = STATUS_ICONS[task.status] ?? Circle;
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-start gap-2">
        <StatusIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
          task.status === "done" ? "text-emerald-400" : task.status === "blocked" ? "text-red-400" : "text-white/40"
        }`} />
        <div className="min-w-0 flex-1">
          <p className={`text-[12px] font-medium ${task.status === "done" ? "text-white/40 line-through" : "text-white/80"}`}>
            {task.title}
          </p>
          {task.notes && <p className="mt-1 text-[11px] text-white/40 line-clamp-2">{task.notes}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${PRIORITY_STYLES[task.priority]}`}>
              {task.priority}
            </span>
            {task.due && (
              <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-white/40">
                {new Date(task.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
            {task.tags?.map(tag => (
              <span key={tag} className="flex items-center gap-0.5 rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-white/30">
                <Tag className="h-2 w-2" />{tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Research Panel ───────────────────────────────────────────────────────

function ResearchPanel({ resources }: { resources: ResearchResource[] }) {
  if (resources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <BookOpen className="h-10 w-10 text-white/20" />
        <h3 className="mt-3 text-sm font-medium text-white/60">No research resources yet</h3>
        <p className="mt-1 max-w-sm text-[12px] text-white/40">
          Agents save research resources with URLs and citations automatically during research runs. Start an investigation to build your bibliography.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/40">
          {resources.length} resource{resources.length !== 1 ? "s" : ""}
        </span>
      </div>
      {resources.map(res => (
        <div key={res.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-start gap-2">
            <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d97757]" />
            <div className="min-w-0 flex-1">
              <a
                href={res.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-medium text-[#d97757] hover:underline"
              >
                {res.title}
                <ArrowUpRight className="ml-1 inline h-2.5 w-2.5" />
              </a>
              <div className="mt-1 flex items-center gap-2">
                <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium text-white/50">
                  {res.source}
                </span>
                <span className="text-[10px] text-white/30">
                  {new Date(res.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
              {res.notes && <p className="mt-1.5 text-[11px] text-white/40">{res.notes}</p>}
              {res.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {res.tags.map(tag => (
                    <span key={tag} className="flex items-center gap-0.5 rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-white/30">
                      <Tag className="h-2 w-2" />{tag}
                    </span>
                  ))}
                </div>
              )}
              {res.citation && (
                <p className="mt-1.5 text-[10px] italic text-white/30">{res.citation}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Folder View ──────────────────────────────────────────────────────────

function FolderView({ folder, files }: { folder: string; files: WorkspaceFile[] }) {
  const meta = FOLDER_META[folder];
  const folderFiles = files.filter(f => f.relativePath.startsWith(folder));

  if (folderFiles.length === 0) {
    const Icon = meta?.icon ?? FolderOpen;
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Icon className="h-10 w-10 text-white/20" />
        <h3 className="mt-3 text-sm font-medium text-white/60">{meta?.label ?? folder} is empty</h3>
        <p className="mt-1 max-w-sm text-[12px] text-white/40">
          Agents create files here automatically during research and analysis runs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {folderFiles.map(file => {
        const Icon = FILE_ICONS[file.type] ?? FileText;
        return (
          <div
            key={file.relativePath}
            className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2 transition-colors hover:bg-white/[0.04]"
          >
            <Icon className="h-4 w-4 shrink-0 text-white/40" />
            <div className="min-w-0 flex-1">
              <span className="text-[12px] font-medium text-white/70">{file.name}</span>
              {file.relativePath !== file.name && (
                <span className="ml-2 text-[10px] text-white/30">{file.relativePath}</span>
              )}
            </div>
            <span className="text-[10px] tabular-nums text-white/30">{file.size}</span>
            <span className="text-[10px] text-white/25">
              {new Date(file.modified).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default WorkspaceExplorer;
