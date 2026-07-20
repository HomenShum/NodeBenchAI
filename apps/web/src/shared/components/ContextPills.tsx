import React from "react";
import { useContextPills } from "@/hooks/contextPills";
import { FileText, Layers3, History, BookOpen, Wrench, Layout } from "lucide-react";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="text-xs tracking-wide text-content-secondary mb-1 flex items-center gap-1">
        <span>{title}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {children}
      </div>
    </div>
  );
}

function Pill({ icon, label, subtle }: { icon?: React.ReactNode; label: string; subtle?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${subtle ? "bg-surface/60" : "bg-[var(--accent-primary-bg)]"} border-edge text-content max-w-[160px] truncate`}>
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function ContextPills({ inline = false }: { inline?: boolean }) {
  const { focused, viewingDocs, previousDocs, contextDocs, toolsMcp, uiInfo } = useContextPills();

  // hide when nothing to show
  const empty = !focused && viewingDocs.length === 0 && previousDocs.length === 0 && contextDocs.length === 0 && !toolsMcp.mcpServerName && !uiInfo;
  if (empty) return null;

  const content = (
    <>
      {/* Focused context */}
      {focused && (
        <Section title="Focused node + surrounding">
          <Pill icon={<Layers3 className="h-3 w-3 text-slate-400" />} label={`Doc ${focused.documentId.slice(0, 6)} · Node ${focused.blockId?.slice(0, 6) || "-"}`} />
          {focused.beforeIds?.slice(0, 2).map((id) => (
            <Pill key={`b-${id}`} subtle icon={<FileText className="h-3 w-3 text-content-secondary" />} label={`Prev ${id.slice(0, 6)}`} />
          ))}
          {focused.afterIds?.slice(0, 2).map((id) => (
            <Pill key={`a-${id}`} subtle icon={<FileText className="h-3 w-3 text-content-secondary" />} label={`Next ${id.slice(0, 6)}`} />
          ))}
        </Section>
      )}

      {/* Viewing docs */}
      {viewingDocs.length > 0 && (
        <Section title="Viewing">
          {viewingDocs.map((d) => (
            <Pill key={d.id} icon={<FileText className="h-3 w-3 text-slate-400" />} label={d.title || d.id} />
          ))}
        </Section>
      )}

      {/* Previously viewed */}
      {previousDocs.length > 0 && (
        <Section title="Previously viewed">
          {previousDocs.slice(0, 6).map((d) => (
            <Pill key={d.id} icon={<History className="h-3 w-3 text-slate-400" />} label={d.title || d.id} />
          ))}
        </Section>
      )}

      {/* Context docs */}
      {contextDocs.length > 0 && (
        <Section title="Context docs">
          {contextDocs.map((d) => (
            <Pill key={d.id} icon={<BookOpen className="h-3 w-3 text-slate-400" />} label={d.title || d.id} />
          ))}
        </Section>
      )}

      {/* Tools & MCPs */}
      {toolsMcp.mcpServerName && (
        <Section title="Tools">
          <Pill icon={<Wrench className="h-3 w-3 text-slate-400" />} label={`${toolsMcp.mcpServerName}${toolsMcp.toolCount ? ` • ${toolsMcp.toolCount} tool${toolsMcp.toolCount !== 1 ? 's' : ''}` : ""}`} />
        </Section>
      )}

      {/* UI-level Interface info */}
      {uiInfo && uiInfo.summary && (
        <Section title="Interface">
          <Pill icon={<Layout className="h-3 w-3 text-slate-400" />} label={uiInfo.summary} />
        </Section>
      )}
    </>
  );

  if (inline) {
    return (
      <div className="bg-surface border border-edge rounded-lg p-3">
        {content}
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-50 max-w-[80vw]">
      <div className="pointer-events-auto bg-surface/95 backdrop-blur-md border border-edge shadow-lg rounded-lg p-3 w-[360px]">
        {content}
      </div>
    </div>
  );
}

export default ContextPills;
