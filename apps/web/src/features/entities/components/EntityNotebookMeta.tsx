import type { ReactNode } from "react";
import {
  Clock3,
  FileSearch,
  GitBranch,
  ListTree,
} from "lucide-react";
import type { EntityNoteDocument } from "@/features/entities/lib/entityNoteDocument";

type EntityNotebookMetaProps = {
  document?: EntityNoteDocument | null;
  onOpenEntity?: (slug: string) => void;
  className?: string;
};

type NotebookMemoryLink = {
  _id?: string;
  blockId?: string;
  entitySlug: string;
  relation: "primary" | "mention";
  entityName?: string;
};

type NotebookSourceLink = {
  _id?: string;
  blockId?: string;
  evidenceId: string;
  label: string;
  type?: string;
};

function formatRelative(ts: number) {
  const minutes = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="nb-panel-inset p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
        {icon}
        <span>{title}</span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function EntityNotebookMeta({
  document,
  onOpenEntity,
  className,
}: EntityNotebookMetaProps) {
  const outline =
    document?.outline?.length
      ? document.outline
      : (document?.blocks ?? [])
          .filter((block) => block.type === "heading" && block.text.trim())
          .map((block) => ({
            blockId: block.blockId,
            title: block.text,
            order: block.order,
            depth: block.depth,
          }));
  const notebookMemoryLinks: NotebookMemoryLink[] = document?.entityLinks?.length
    ? document.entityLinks
    : (document?.blocks ?? []).flatMap((block) =>
        (block.entityRefs ?? []).map((entitySlug) => ({
          entitySlug,
          relation: "mention" as const,
          blockId: block.blockId,
        })),
      );
  const linkedMemories = notebookMemoryLinks
    .filter((link) => link.relation === "mention")
    .filter(
      (link, index, list) => list.findIndex((candidate) => candidate.entitySlug === link.entitySlug) === index,
    );
  const notebookSourceLinks: NotebookSourceLink[] = document?.sourceLinks?.length
    ? document.sourceLinks
    : (document?.blocks ?? []).flatMap((block) =>
        (block.sourceRefs ?? []).map((sourceRef, index) => ({
          evidenceId: `${block.blockId}-${index}-${sourceRef}`,
          label: sourceRef,
          blockId: block.blockId,
        })),
      );
  const linkedSources = notebookSourceLinks.filter(
    (link, index, list) => list.findIndex((candidate) => candidate.evidenceId === link.evidenceId) === index,
  );
  const events = document?.events ?? [];

  return (
    <div className={`grid gap-4 md:grid-cols-2 ${className ?? ""}`.trim()}>
      <Section title="Notebook outline" icon={<ListTree className="h-3.5 w-3.5" />}>
        {outline.length ? (
          <div className="space-y-2">
            {outline.slice(0, 6).map((item) => (
              <div
                key={item.blockId}
                className="rounded-2xl bg-[rgba(15,23,42,0.03)] px-3 py-2 text-sm text-content dark:bg-white/[0.04]"
                style={{ paddingLeft: `${12 + (item.depth ?? 0) * 10}px` }}
              >
                {item.title}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-6 text-content-muted">
            Headings in the notebook become a stable outline here so large memories stay navigable.
          </p>
        )}
      </Section>

      <Section title="Linked memories" icon={<GitBranch className="h-3.5 w-3.5" />}>
        {linkedMemories.length ? (
          <div className="flex flex-wrap gap-2">
            {linkedMemories.slice(0, 8).map((link) =>
              onOpenEntity ? (
                <button
                  key={link._id ?? `${link.entitySlug}-${link.blockId ?? "document"}`}
                  type="button"
                  onClick={() => onOpenEntity(link.entitySlug)}
                  className="nb-chip px-3 py-1.5 text-[11px]"
                >
                  {link.entityName ?? link.entitySlug}
                </button>
              ) : (
                <span
                  key={link._id ?? `${link.entitySlug}-${link.blockId ?? "document"}`}
                  className="nb-chip px-3 py-1.5 text-[11px]"
                >
                  {link.entityName ?? link.entitySlug}
                </span>
              ),
            )}
          </div>
        ) : (
          <p className="text-sm leading-6 text-content-muted">
            Use <code className="rounded bg-[rgba(15,23,42,0.04)] px-1.5 py-0.5 text-[12px] dark:bg-white/[0.06]">[[Entity Name]]</code> in notes to create cross-memory links.
          </p>
        )}
      </Section>

      <Section title="Linked sources" icon={<FileSearch className="h-3.5 w-3.5" />}>
        {linkedSources.length ? (
          <div className="space-y-2">
            {linkedSources.slice(0, 6).map((link) => (
              <div
                key={link._id ?? `${link.evidenceId}-${link.blockId ?? "document"}`}
                className="rounded-2xl bg-[rgba(15,23,42,0.03)] px-3 py-2 dark:bg-white/[0.04]"
              >
                <div className="text-sm font-medium text-content">{link.label}</div>
                <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-content-muted">
                  {link.type ?? "source"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-6 text-content-muted">
            References like <code className="rounded bg-[rgba(15,23,42,0.04)] px-1.5 py-0.5 text-[12px] dark:bg-white/[0.06]">[source:Acme memo]</code> map notebook blocks back to stored evidence.
          </p>
        )}
      </Section>

      <Section title="Notebook activity" icon={<Clock3 className="h-3.5 w-3.5" />}>
        {events.length ? (
          <div className="space-y-2">
            {events.slice(0, 6).map((event) => (
              <div
                key={event._id ?? `${event.type}-${event.createdAt}`}
                className="rounded-2xl bg-[rgba(15,23,42,0.03)] px-3 py-2 dark:bg-white/[0.04]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-content">{event.label}</div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-content-muted">
                    {formatRelative(event.createdAt)}
                  </div>
                </div>
                {event.summary ? (
                  <p className="mt-1 text-sm leading-6 text-content-muted">{event.summary}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-6 text-content-muted">
            Notebook edits, imports, and snapshots are logged here so the memory surface stays auditable over time.
          </p>
        )}
      </Section>
    </div>
  );
}

export default EntityNotebookMeta;
