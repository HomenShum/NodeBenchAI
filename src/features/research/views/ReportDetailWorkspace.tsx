/**
 * ReportDetailWorkspace — the recursive Cards workspace for a single report.
 *
 * v1 scope (locked):
 *   - Tabs: Brief | Cards | Map | Sources (Cards default;
 *     labels + icons + count pills aligned with the NodeBench design-system
 *     workspace kit at docs/design/nodebench-ai-design-system/)
 *   - Breadcrumb path always visible
 *   - Max 3 active depth columns
 *   - Pin / Promote-to-root / Compare affordances on every card
 *   - "Return to root" always visible when user has drilled
 *
 * Data contract: shared/research/resourceCards.ts ResourceCard[].
 * The parent wires the data source (Convex query, /v1/resources/expand, or
 * fixture). This component does not talk to the network directly.
 */

import { useCallback, useMemo, useState } from "react";
import { FileText, LayoutGrid, Map as MapIcon, FileStack } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ai-ui/tabs";
import MobileReportSurface from "@/features/research/views/MobileReportSurface";
import { CardInspector } from "@/features/research/components/CardInspector";
import type {
  ResourceCard,
  ResourceUri,
} from "../../../../shared/research/resourceCards";

export type WorkspaceTab = "brief" | "cards" | "map" | "sources";

interface BreadcrumbHop {
  uri: ResourceUri;
  label: string;
}

interface ColumnState {
  uri: ResourceUri;
  cards: ReadonlyArray<ResourceCard>;
}

export interface ReportDetailWorkspaceProps {
  reportTitle: string;
  rootUri: ResourceUri;
  rootLabel: string;
  /** Cards returned by the first expand for rootUri. */
  initialCards: ReadonlyArray<ResourceCard>;
  /** Expand handler wired to /v1/resources/expand or a Convex query. */
  onExpand: (uri: ResourceUri) => Promise<ReadonlyArray<ResourceCard>>;
  onOpenBrief?: () => void;
  onOpenInChat?: (uri: ResourceUri) => void;
  /**
   * Initial tab for the workspace. Used by `/workspace/w/:id?tab=...` so the
   * URL can land directly on Brief / Cards / Map / Sources. Defaults to "cards".
   */
  initialTab?: WorkspaceTab;
}

const MAX_COLUMNS = 3;

export function ReportDetailWorkspace({
  reportTitle,
  rootUri,
  rootLabel,
  initialCards,
  onExpand,
  onOpenBrief,
  onOpenInChat,
  initialTab,
}: ReportDetailWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab ?? "cards");
  const [columns, setColumns] = useState<ColumnState[]>([
    { uri: rootUri, cards: initialCards },
  ]);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbHop[]>([
    { uri: rootUri, label: rootLabel },
  ]);
  const [pinnedUris, setPinnedUris] = useState<ResourceUri[]>([]);
  const [compareTray, setCompareTray] = useState<ResourceUri[]>([]);
  const [inspectedCardUri, setInspectedCardUri] = useState<ResourceUri | null>(
    null,
  );
  const [loadingUri, setLoadingUri] = useState<ResourceUri | null>(null);
  const [errorForUri, setErrorForUri] = useState<
    { uri: ResourceUri; message: string } | null
  >(null);

  const drilled = breadcrumb.length > 1;
  const canGoDeeper = columns.length < MAX_COLUMNS;

  // Derive tab count pills per design spec (ws-tab-count).
  const tabCounts = useMemo(() => {
    let cards = 0;
    const evidence = new Set<string>();
    for (const col of columns) {
      cards += col.cards.length;
      for (const card of col.cards) {
        for (const ref of card.evidenceRefs ?? []) {
          evidence.add(String(ref));
        }
      }
    }
    return { cards, sources: evidence.size };
  }, [columns]);

  const handleExpand = useCallback(
    async (uri: ResourceUri, label: string) => {
      if (!canGoDeeper) {
        // Collapse the oldest non-root column (keep root + last two).
        setColumns((prev) => [prev[0], ...prev.slice(-1)]);
      }
      setLoadingUri(uri);
      setErrorForUri(null);
      try {
        const cards = await onExpand(uri);
        setColumns((prev) => [...prev, { uri, cards }]);
        setBreadcrumb((prev) => [...prev, { uri, label }]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Expand failed";
        setErrorForUri({ uri, message });
      } finally {
        setLoadingUri(null);
      }
    },
    [canGoDeeper, onExpand],
  );

  const handleReturnToRoot = useCallback(() => {
    setColumns((prev) => [prev[0]]);
    setBreadcrumb((prev) => [prev[0]]);
  }, []);

  const handleJumpTo = useCallback(
    (index: number) => {
      setColumns((prev) => prev.slice(0, index + 1));
      setBreadcrumb((prev) => prev.slice(0, index + 1));
    },
    [],
  );

  const togglePinned = useCallback((uri: ResourceUri) => {
    setPinnedUris((prev) =>
      prev.includes(uri) ? prev.filter((p) => p !== uri) : [...prev, uri],
    );
  }, []);

  const toggleCompare = useCallback((uri: ResourceUri) => {
    setCompareTray((prev) =>
      prev.includes(uri) ? prev.filter((p) => p !== uri) : [...prev, uri],
    );
  }, []);

  const handlePromote = useCallback(
    async (uri: ResourceUri, label: string) => {
      setLoadingUri(uri);
      setErrorForUri(null);
      try {
        const cards = await onExpand(uri);
        setColumns([{ uri, cards }]);
        setBreadcrumb([{ uri, label }]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Promote failed";
        setErrorForUri({ uri, message });
      } finally {
        setLoadingUri(null);
      }
    },
    [onExpand],
  );

  const mobileInitialSub: "brief" | "sources" | "notebook" =
    activeTab === "sources" ? "sources" : activeTab === "brief" ? "brief" : "brief";

  return (
    <>
      {/* Mobile-only report surface (Brief/Sources/Notebook sub-tabs) */}
      <MobileReportSurface
        reportTitle={reportTitle}
        initialSub={mobileInitialSub}
      />

      {/* Desktop cards workspace — hidden on mobile */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as WorkspaceTab)}
        data-testid="report-detail-workspace"
        className="hidden md:flex h-full min-h-0 flex-col"
      >
      <WorkspaceHeader
        reportTitle={reportTitle}
        breadcrumb={breadcrumb}
        drilled={drilled}
        onReturnToRoot={handleReturnToRoot}
        onJumpTo={handleJumpTo}
        onOpenBrief={onOpenBrief}
      />

      <TabBar
        activeTab={activeTab}
        cardCount={tabCounts.cards}
        sourceCount={tabCounts.sources}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <TabsContent value="brief" className="mt-0 flex min-h-0 flex-1 overflow-hidden">
          <BriefTab cards={columns[0]?.cards ?? []} />
        </TabsContent>
        <TabsContent value="cards" className="mt-0 flex min-h-0 flex-1 overflow-hidden">
          <div className="flex flex-1 min-h-0 gap-3 overflow-hidden">
            <div className="flex min-w-0 flex-1 overflow-hidden">
              <CardsTab
                columns={columns}
                loadingUri={loadingUri}
                errorForUri={errorForUri}
                pinnedUris={pinnedUris}
                compareTray={compareTray}
                inspectedCardUri={inspectedCardUri}
                onExpand={handleExpand}
                onPromote={handlePromote}
                onInspect={setInspectedCardUri}
                onTogglePin={togglePinned}
                onToggleCompare={toggleCompare}
                onOpenInChat={onOpenInChat}
              />
            </div>
            <div className="hidden lg:flex shrink-0 py-3 pr-3">
              <CardInspector
                card={findCardByUri(columns, inspectedCardUri)}
                onDrill={(uri) => {
                  // Promote-to-root from inspector mirrors kit drill semantics.
                  const target = findCardByUri(columns, uri);
                  const label = target?.title ?? uri;
                  handlePromote(uri, label);
                  setInspectedCardUri(null);
                }}
                onClose={() => setInspectedCardUri(null)}
              />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="map" className="mt-0 flex min-h-0 flex-1 overflow-hidden">
          <MapTab
            cards={columns.flatMap((c) => c.cards)}
            rootUri={columns[0]?.uri ?? rootUri}
          />
        </TabsContent>
        <TabsContent value="sources" className="mt-0 flex min-h-0 flex-1 overflow-hidden">
          <SourcesTab cards={columns.flatMap((c) => c.cards)} />
        </TabsContent>
      </div>

      {compareTray.length > 0 && (
        <CompareTray
          uris={compareTray}
          onClear={() => setCompareTray([])}
        />
      )}
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------------------

function WorkspaceHeader({
  reportTitle,
  breadcrumb,
  drilled,
  onReturnToRoot,
  onJumpTo,
  onOpenBrief,
}: {
  reportTitle: string;
  breadcrumb: ReadonlyArray<BreadcrumbHop>;
  drilled: boolean;
  onReturnToRoot: () => void;
  onJumpTo: (index: number) => void;
  onOpenBrief?: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span className="truncate text-[11px] uppercase tracking-[0.2em] text-white/50">
          {reportTitle}
        </span>
        <span className="text-white/20">·</span>
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-1 overflow-hidden"
        >
          {breadcrumb.map((hop, i) => {
            const isLast = i === breadcrumb.length - 1;
            return (
              <span key={hop.uri} className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onJumpTo(i)}
                  className={`truncate rounded px-1.5 py-0.5 text-xs transition ${
                    isLast
                      ? "bg-[#d97757]/15 text-white"
                      : "text-white/60 hover:bg-white/5 hover:text-white"
                  }`}
                  aria-current={isLast ? "page" : undefined}
                >
                  {hop.label}
                </button>
                {!isLast && <span className="text-white/20">›</span>}
              </span>
            );
          })}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {drilled && (
          <button
            type="button"
            onClick={onReturnToRoot}
            className="rounded border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-white/80 transition hover:bg-white/[0.06]"
          >
            Return to root
          </button>
        )}
        {onOpenBrief && (
          <button
            type="button"
            onClick={onOpenBrief}
            className="rounded border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-white/80 transition hover:bg-white/[0.06]"
          >
            Open brief
          </button>
        )}
      </div>
    </div>
  );
}

type TabDef = {
  id: WorkspaceTab;
  label: string;
  icon: typeof FileText;
  count?: number;
  disabled?: boolean;
};

function TabBar({
  activeTab,
  cardCount,
  sourceCount,
}: {
  activeTab: WorkspaceTab;
  cardCount: number;
  sourceCount: number;
}) {
  // Tab set + icons mirror the NodeBench design-system workspace kit
  // (docs/design/nodebench-ai-design-system/ui_kits/nodebench-workspace/
  //  Report.jsx:14-20). Count pills follow the same kit's `.ws-tab-count` pattern.
  const tabs: TabDef[] = [
    { id: "brief", label: "Brief", icon: FileText },
    { id: "cards", label: "Cards", icon: LayoutGrid, count: cardCount },
    { id: "map", label: "Map", icon: MapIcon },
    { id: "sources", label: "Sources", icon: FileStack, count: sourceCount },
  ];
  return (
    <TabsList
      aria-label="Workspace view"
      className="flex h-auto items-center justify-start gap-1 rounded-none border-b border-white/[0.06] bg-white/[0.01] p-0 px-3"
    >
      {tabs.map((t) => {
        const isActive = activeTab === t.id;
        const IconCmp = t.icon;
        return (
          <TabsTrigger
            key={t.id}
            value={t.id}
            disabled={t.disabled}
            className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:shadow-none ${
              t.disabled
                ? "cursor-not-allowed text-white/25"
                : isActive
                ? "text-white"
                : "text-white/60 hover:text-white"
            }`}
          >
            <IconCmp size={13} aria-hidden />
            <span>{t.label}</span>
            {t.count != null && t.count > 0 && !t.disabled && (
              <span
                className={`ml-0.5 rounded-full px-1.5 py-[1px] text-[10px] font-semibold tabular-nums ${
                  isActive
                    ? "bg-[#d97757]/20 text-[#e59579]"
                    : "bg-white/[0.05] text-white/50"
                }`}
                aria-label={`${t.count} ${t.label.toLowerCase()}`}
              >
                {t.count}
              </span>
            )}
            {t.disabled && (
              <span className="ml-1 rounded bg-white/[0.04] px-1 text-[10px] uppercase tracking-wide text-white/40">
                v2
              </span>
            )}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-0 -bottom-px h-px bg-[#d97757]"
              />
            )}
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}

function CardsTab({
  columns,
  loadingUri,
  errorForUri,
  pinnedUris,
  compareTray,
  inspectedCardUri,
  onExpand,
  onPromote,
  onInspect,
  onTogglePin,
  onToggleCompare,
  onOpenInChat,
}: {
  columns: ReadonlyArray<ColumnState>;
  loadingUri: ResourceUri | null;
  errorForUri: { uri: ResourceUri; message: string } | null;
  pinnedUris: ReadonlyArray<ResourceUri>;
  compareTray: ReadonlyArray<ResourceUri>;
  inspectedCardUri: ResourceUri | null;
  onExpand: (uri: ResourceUri, label: string) => void;
  onPromote: (uri: ResourceUri, label: string) => void;
  onInspect: (uri: ResourceUri | null) => void;
  onTogglePin: (uri: ResourceUri) => void;
  onToggleCompare: (uri: ResourceUri) => void;
  onOpenInChat?: (uri: ResourceUri) => void;
}) {
  return (
    <div className="flex flex-1 gap-3 overflow-x-auto overflow-y-hidden px-3 py-3">
      {columns.map((col, i) => (
        <CardColumn
          key={`${col.uri}-${i}`}
          cards={col.cards}
          columnIndex={i}
          loadingUri={loadingUri}
          errorForUri={errorForUri}
          pinnedUris={pinnedUris}
          compareTray={compareTray}
          inspectedCardUri={inspectedCardUri}
          onExpand={onExpand}
          onPromote={onPromote}
          onInspect={onInspect}
          onTogglePin={onTogglePin}
          onToggleCompare={onToggleCompare}
          onOpenInChat={onOpenInChat}
        />
      ))}
      {columns.length === MAX_COLUMNS && (
        <div className="flex h-full min-w-[180px] items-center justify-center rounded border border-dashed border-white/[0.08] bg-white/[0.01] px-3 text-center text-[11px] text-white/40">
          Max depth reached. Opening a new card will collapse the oldest column.
        </div>
      )}
    </div>
  );
}

function CardColumn({
  cards,
  columnIndex,
  loadingUri,
  errorForUri,
  pinnedUris,
  compareTray,
  inspectedCardUri,
  onExpand,
  onPromote,
  onInspect,
  onTogglePin,
  onToggleCompare,
  onOpenInChat,
}: {
  cards: ReadonlyArray<ResourceCard>;
  columnIndex: number;
  loadingUri: ResourceUri | null;
  errorForUri: { uri: ResourceUri; message: string } | null;
  pinnedUris: ReadonlyArray<ResourceUri>;
  compareTray: ReadonlyArray<ResourceUri>;
  inspectedCardUri: ResourceUri | null;
  onExpand: (uri: ResourceUri, label: string) => void;
  onPromote: (uri: ResourceUri, label: string) => void;
  onInspect: (uri: ResourceUri | null) => void;
  onTogglePin: (uri: ResourceUri) => void;
  onToggleCompare: (uri: ResourceUri) => void;
  onOpenInChat?: (uri: ResourceUri) => void;
}) {
  return (
    <section
      data-testid={`card-column-${columnIndex}`}
      className="flex h-full min-w-[280px] max-w-[340px] flex-1 flex-col gap-2 overflow-y-auto"
    >
      {cards.map((card) => (
        <Card
          key={card.cardId}
          card={card}
          pinned={pinnedUris.includes(card.uri)}
          inCompare={compareTray.includes(card.uri)}
          isLoading={loadingUri === card.uri}
          isInspected={inspectedCardUri === card.uri}
          errorMessage={
            errorForUri?.uri === card.uri ? errorForUri.message : undefined
          }
          onExpand={onExpand}
          onPromote={onPromote}
          onInspect={onInspect}
          onTogglePin={onTogglePin}
          onToggleCompare={onToggleCompare}
          onOpenInChat={onOpenInChat}
        />
      ))}
      {cards.length === 0 && (
        <div className="rounded border border-white/[0.06] bg-white/[0.01] p-4 text-center text-[11px] text-white/40">
          No cards for this expansion.
        </div>
      )}
    </section>
  );
}

function Card({
  card,
  pinned,
  inCompare,
  isLoading,
  isInspected,
  errorMessage,
  onExpand,
  onPromote,
  onInspect,
  onTogglePin,
  onToggleCompare,
  onOpenInChat,
}: {
  card: ResourceCard;
  pinned: boolean;
  inCompare: boolean;
  isLoading: boolean;
  isInspected: boolean;
  errorMessage?: string;
  onExpand: (uri: ResourceUri, label: string) => void;
  onPromote: (uri: ResourceUri, label: string) => void;
  onInspect: (uri: ResourceUri | null) => void;
  onTogglePin: (uri: ResourceUri) => void;
  onToggleCompare: (uri: ResourceUri) => void;
  onOpenInChat?: (uri: ResourceUri) => void;
}) {
  return (
    <article
      data-testid="resource-card"
      data-inspected={isInspected || undefined}
      className={`rounded-lg border p-3 transition ${
        isInspected
          ? "border-[#d97757]/50 bg-[#d97757]/[0.06]"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1]"
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onInspect(isInspected ? null : card.uri)}
          aria-pressed={isInspected}
          aria-label={`${isInspected ? "Close inspector for" : "Inspect"} ${card.title}`}
          className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/70"
        >
          <h3 className="truncate text-sm font-semibold text-white">
            {card.title}
          </h3>
          {card.subtitle && (
            <p className="truncate text-[11px] uppercase tracking-wide text-white/40">
              {card.subtitle}
            </p>
          )}
        </button>
        <span
          className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/60"
          title={`Confidence: ${(card.confidence * 100).toFixed(0)}%`}
        >
          {(card.confidence * 100).toFixed(0)}%
        </span>
      </header>

      {card.chips && card.chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.chips.map((chip, i) => (
            <span
              key={`${chip.label}-${i}`}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                chip.tone === "accent"
                  ? "bg-[#d97757]/15 text-[#d97757]"
                  : chip.tone === "warn"
                  ? "bg-amber-500/10 text-amber-300"
                  : chip.tone === "positive"
                  ? "bg-emerald-500/10 text-emerald-300"
                  : "bg-white/[0.04] text-white/60"
              }`}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}

      {card.summary && (
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-white/70">
          {card.summary}
        </p>
      )}

      {card.keyFacts && card.keyFacts.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-white/60">
          {card.keyFacts.slice(0, 4).map((f, i) => (
            <li key={i} className="flex gap-1.5">
              <span aria-hidden className="text-white/30">
                •
              </span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}

      {errorMessage && (
        <p className="mt-2 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
          {errorMessage}
        </p>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={isLoading}
          onClick={() => onExpand(card.uri, card.title)}
          className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-white/80 transition hover:bg-white/[0.06] disabled:cursor-wait disabled:opacity-60"
          aria-label={`Expand ${card.title} — open one ring deeper`}
        >
          {isLoading ? "Expanding…" : "Expand"}
        </button>
        <button
          type="button"
          onClick={() => onPromote(card.uri, card.title)}
          className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-white/80 transition hover:bg-white/[0.06]"
          aria-label={`Promote ${card.title} to root`}
        >
          Promote
        </button>
        <button
          type="button"
          onClick={() => onTogglePin(card.uri)}
          aria-pressed={pinned}
          className={`rounded border px-2 py-1 text-[11px] transition ${
            pinned
              ? "border-[#d97757]/40 bg-[#d97757]/15 text-[#d97757]"
              : "border-white/[0.08] bg-white/[0.03] text-white/80 hover:bg-white/[0.06]"
          }`}
        >
          {pinned ? "Pinned" : "Pin"}
        </button>
        <button
          type="button"
          onClick={() => onToggleCompare(card.uri)}
          aria-pressed={inCompare}
          className={`rounded border px-2 py-1 text-[11px] transition ${
            inCompare
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
              : "border-white/[0.08] bg-white/[0.03] text-white/80 hover:bg-white/[0.06]"
          }`}
        >
          {inCompare ? "In compare" : "Compare"}
        </button>
        {onOpenInChat && (
          <button
            type="button"
            onClick={() => onOpenInChat(card.uri)}
            className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-white/80 transition hover:bg-white/[0.06]"
          >
            Ask
          </button>
        )}
      </footer>
    </article>
  );
}

// BriefTab — design-aligned executive brief surface.
// Matches docs/design/nodebench-ai-design-system/.../Report.jsx BRIEF artboard:
// kicker + title + subtitle + summary + key-facts. Future polish can add the
// what / so-what / now-what triad and receipts grid once backend provides them.
function BriefTab({ cards }: { cards: ReadonlyArray<ResourceCard> }) {
  const root = cards[0];
  if (!root) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-white/40">
        No brief available for this expansion yet.
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Design kicker — matches .type-kicker: 11px, uppercase, 0.18em tracking. */}
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
        Brief
      </div>
      <h2 className="text-2xl font-bold tracking-tight text-white">
        {root.title}
      </h2>
      {root.subtitle && (
        <p className="mt-1 text-sm text-white/50">{root.subtitle}</p>
      )}
      {root.summary && (
        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-white/80">
          {root.summary}
        </p>
      )}
      {root.keyFacts && root.keyFacts.length > 0 && (
        <div className="mt-6 max-w-2xl">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
            Key facts
          </div>
          <ul className="space-y-2 text-sm text-white/70">
            {root.keyFacts.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="text-[#d97757]">
                  •
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * MapTab — entity-relationship constellation.
 *
 * Pattern: Circular 2-ring constellation with center-rooted layout + labeled
 * edges + kind filter + side panel (Jony-Ive "earned complexity").
 * Prior art: docs/design/nodebench-ai-design-system/ui_kits/nodebench-workspace/
 *   (Map.jsx, map.css, data.js) — the golden-truth SVG kit.
 *
 * Adaptation notes (kit → prod):
 *   - Kit uses window.WS_DATA fixture; prod reads ResourceCard[] + rootUri props.
 *   - Kit relations[id] → prod derives edges from card.nextHops (primary) with
 *     evidenceRefs fallback.
 *   - Kit is light-palette; prod is dark-first so we lift the palette tokens
 *     but dark-mode the canvas/panel chrome.
 *   - Click = recenter; Shift+click = inspect (selects without recentering).
 */
function MapTab({
  cards,
  rootUri,
}: {
  cards: ReadonlyArray<ResourceCard>;
  rootUri: ResourceUri;
}) {
  const [currentRootUri, setCurrentRootUri] = useState<ResourceUri>(rootUri);
  const [selectedUri, setSelectedUri] = useState<ResourceUri>(rootUri);
  const [hoverUri, setHoverUri] = useState<ResourceUri | null>(null);
  const [kindFilter, setKindFilter] = useState<MapNodeKind | "all">("all");

  const graph = useMemo(
    () => buildMapGraph(cards, currentRootUri, rootUri),
    [cards, currentRootUri, rootUri],
  );

  const resolvedSelectedUri =
    graph.nodes.find((n) => n.uri === selectedUri)?.uri ?? graph.rootUri;
  const selected =
    graph.nodes.find((n) => n.uri === resolvedSelectedUri) ?? graph.nodes[0];

  const recenter = useCallback(
    (uri: ResourceUri) => {
      if (!graph.byUri.has(uri)) return;
      setCurrentRootUri(uri);
      setSelectedUri(uri);
    },
    [graph.byUri],
  );
  const selectNode = useCallback(
    (uri: ResourceUri) => {
      if (!graph.byUri.has(uri)) return;
      setSelectedUri(uri);
    },
    [graph.byUri],
  );

  const kindVisible = useCallback(
    (kind: MapNodeKind) => kindFilter === "all" || kind === kindFilter,
    [kindFilter],
  );

  if (graph.nodes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-white/40">
        No map nodes surfaced for this report yet.
      </div>
    );
  }

  const W = 900;
  const H = 620;
  const CX = W / 2;
  const CY = H / 2;
  const R1 = 200;
  const R2 = 285;

  return (
    <div
      className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_340px]"
      style={{
        background:
          "radial-gradient(ellipse at top, rgba(217,119,87,0.04), transparent 60%), transparent",
      }}
    >
      {/* ── Canvas column ── */}
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-white/[0.06] bg-white/[0.02] shadow-[0_1px_2px_rgba(0,0,0,0.25),0_8px_24px_rgba(0,0,0,0.35)]">
        {/* Toolbar */}
        <div className="flex min-h-[42px] flex-shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
              Showing
            </span>
            <div className="inline-flex gap-0.5 rounded-[9px] bg-white/[0.04] p-[3px]">
              {MAP_KINDS.map((k) => {
                const active = kindFilter === k.k;
                return (
                  <button
                    key={k.k}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setKindFilter(k.k)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      active
                        ? "bg-white/[0.08] text-white shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
                        : "text-white/55 hover:text-white/85"
                    }`}
                  >
                    <span
                      className="inline-block h-[7px] w-[7px] flex-shrink-0 rounded-full"
                      style={{ background: k.color }}
                    />
                    {k.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-white/50">
            <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5">
              {graph.nodes.length} nodes
            </span>
            <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5">
              {graph.edges.length} edges
            </span>
            <button
              type="button"
              onClick={() => recenter(rootUri)}
              title="Recenter on report root"
              className="inline-flex items-center gap-1 rounded-[7px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/70 transition-colors hover:border-[#d97757]/60 hover:bg-[#d97757]/10 hover:text-[#e59579]"
            >
              Recenter
            </button>
          </div>
        </div>

        {/* SVG viewport */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            className="block h-full w-full select-none"
            role="img"
            aria-label="Report relationship map"
          >
            <defs>
              <radialGradient id="map-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(217,119,87,0.18)" />
                <stop offset="100%" stopColor="rgba(217,119,87,0)" />
              </radialGradient>
              <pattern id="map-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M24 0 L0 0 0 24" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
              </pattern>
            </defs>

            {/* Background grid + root glow + ring guides */}
            <rect width={W} height={H} fill="url(#map-grid)" />
            <circle cx={CX} cy={CY} r={R1 + 40} fill="url(#map-glow)" />
            <circle cx={CX} cy={CY} r={R1} fill="none" stroke="rgba(255,255,255,0.06)" strokeDasharray="2 5" strokeWidth="1" />
            <circle cx={CX} cy={CY} r={R2} fill="none" stroke="rgba(255,255,255,0.04)" strokeDasharray="2 5" strokeWidth="1" />

            {/* Edges */}
            {graph.edges.map((e, i) => {
              const a = graph.nodes.find((n) => n.uri === e.from);
              const b = graph.nodes.find((n) => n.uri === e.to);
              if (!a || !b) return null;
              const dim = !kindVisible(a.kind) || !kindVisible(b.kind);
              const highlight = hoverUri && (hoverUri === e.from || hoverUri === e.to);
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              const c = mapEdgeColor(e.relationKind);
              return (
                <g key={`${e.from}-${e.to}-${i}`} opacity={dim ? 0.15 : highlight ? 1 : 0.75}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={c}
                    strokeWidth={highlight ? 2.2 : e.primary ? 1.6 : 1.1}
                    strokeLinecap="round"
                    strokeDasharray={e.primary ? "" : "3 4"}
                  />
                  {e.primary && (
                    <g transform={`translate(${mx}, ${my})`}>
                      <rect x={-36} y={-8} width={72} height={16} rx={8} fill="#151413" stroke={c} strokeWidth="1" />
                      <text
                        x={0}
                        y={3}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="600"
                        fontFamily="'JetBrains Mono', monospace"
                        fill={c}
                      >
                        {e.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {graph.nodes.map((n) => {
              const isRoot = n.ring === 0;
              const isSelected = n.uri === resolvedSelectedUri && !isRoot;
              const isHover = n.uri === hoverUri;
              const dim = !kindVisible(n.kind);
              const r = isRoot ? 42 : n.ring === 1 ? 30 : 22;
              const color = mapNodeColor(n.kind);

              return (
                <g
                  key={n.uri}
                  data-testid="resource-card"
                  transform={`translate(${n.x}, ${n.y})`}
                  style={{
                    cursor: "pointer",
                    opacity: dim ? 0.22 : 1,
                    transition: "opacity 200ms",
                  }}
                  onMouseEnter={() => setHoverUri(n.uri)}
                  onMouseLeave={() => setHoverUri(null)}
                  onClick={(ev) => (ev.shiftKey ? selectNode(n.uri) : recenter(n.uri))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      if (ev.shiftKey) selectNode(n.uri);
                      else recenter(n.uri);
                    }
                  }}
                  aria-label={`${n.title} (${n.kind})`}
                >
                  {/* Halo on hover / selected / root */}
                  {(isHover || isSelected || isRoot) && (
                    <circle
                      r={r + 8}
                      fill="none"
                      stroke={isRoot ? "#d97757" : color}
                      strokeWidth={isRoot ? 2.4 : 1.6}
                      strokeOpacity={0.45}
                    />
                  )}

                  <circle r={r} fill={color} />
                  <circle r={r} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />

                  {/* Avatar / initials */}
                  <text
                    y={4}
                    textAnchor="middle"
                    fontSize={isRoot ? 16 : n.ring === 1 ? 12 : 10}
                    fontWeight="700"
                    fontFamily="'JetBrains Mono', monospace"
                    fill="#fffaf0"
                  >
                    {n.initials}
                  </text>

                  {/* Label below */}
                  <g transform={`translate(0, ${r + 18})`}>
                    <text
                      textAnchor="middle"
                      fontSize={isRoot ? 13 : 11.5}
                      fontWeight={isRoot ? 700 : 600}
                      fontFamily="Manrope, Inter, sans-serif"
                      fill="#f8fafc"
                    >
                      {shortMapTitle(n.title)}
                    </text>
                    <text
                      y={14}
                      textAnchor="middle"
                      fontSize={9.5}
                      fontFamily="'JetBrains Mono', monospace"
                      fill="rgba(248,250,252,0.52)"
                      letterSpacing="0.05em"
                    >
                      {n.kind.toUpperCase()}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Helper strip */}
        <div className="flex flex-shrink-0 flex-wrap gap-3.5 border-t border-white/[0.06] bg-white/[0.02] px-3.5 py-2 font-mono text-[10.5px] text-white/40">
          <span>
            <kbd className="rounded border border-white/[0.08] border-b-2 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/60">
              Click
            </kbd>{" "}
            recenter
          </span>
          <span>
            <kbd className="rounded border border-white/[0.08] border-b-2 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/60">
              Shift
            </kbd>
            +
            <kbd className="ml-1 rounded border border-white/[0.08] border-b-2 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/60">
              Click
            </kbd>{" "}
            inspect
          </span>
          <span>Dashed edges = 2nd-degree relation</span>
        </div>
      </section>

      {/* ── Side panel ── */}
      <aside className="flex min-h-0 flex-col gap-3.5 overflow-y-auto rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.25),0_8px_24px_rgba(0,0,0,0.35)]">
        {selected ? (
          <>
            <header className="flex items-center gap-2.5 border-b border-white/[0.06] pb-3.5">
              <div
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg font-mono text-[13px] font-bold text-white"
                style={{ background: mapNodeColor(selected.kind) }}
              >
                {selected.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold tracking-tight text-white">
                  {selected.title}
                </div>
                <div className="mt-0.5 text-[11.5px] text-white/50">
                  {selected.kind} · {selected.confidence}% confidence
                </div>
              </div>
              <span className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/55">
                {selected.kind}
              </span>
            </header>

            <section className="flex flex-col gap-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                Summary
              </div>
              <p className="text-xs leading-5 text-white/65">
                {selected.summary || "No summary surfaced for this node yet."}
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                Connected to
              </div>
              <div className="flex flex-col gap-1">
                {graph.neighborsOf(selected.uri).length === 0 ? (
                  <div className="px-1 py-2.5 text-[11px] italic text-white/40">
                    No connections recorded yet.
                  </div>
                ) : (
                  graph.neighborsOf(selected.uri).map((n) => (
                    <button
                      key={n.uri}
                      type="button"
                      onClick={() => recenter(n.uri)}
                      onMouseEnter={() => setHoverUri(n.uri)}
                      onMouseLeave={() => setHoverUri(null)}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
                    >
                      <span
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[5px] font-mono text-[9.5px] font-bold text-white"
                        style={{ background: mapNodeColor(n.kind) }}
                      >
                        {n.initials}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="truncate text-[12.5px] font-semibold text-white">
                          {n.title}
                        </span>
                        <span
                          className="font-mono text-[10px] font-semibold tracking-wide"
                          style={{ color: mapEdgeColor(n.relationKind) }}
                        >
                          {n.relationLabel}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>
          </>
        ) : (
          <div className="text-sm text-white/40">Select a node to inspect.</div>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map types + helpers
// ---------------------------------------------------------------------------

type MapNodeKind =
  | "company"
  | "person"
  | "product"
  | "event"
  | "topic"
  | "source"
  | "claim"
  | "regulation"
  | "investor"
  | "market";

type MapRelationKind =
  | "peer"
  | "investor"
  | "compete"
  | "reg"
  | "person"
  | "sector";

interface MapNode {
  uri: ResourceUri;
  title: string;
  kind: MapNodeKind;
  summary: string;
  confidence: number;
  initials: string;
  ring: number;
  x: number;
  y: number;
}

interface MapEdge {
  from: ResourceUri;
  to: ResourceUri;
  label: string;
  relationKind: MapRelationKind;
  primary: boolean;
}

interface MapNeighbor {
  uri: ResourceUri;
  title: string;
  kind: MapNodeKind;
  initials: string;
  relationLabel: string;
  relationKind: MapRelationKind;
}

interface MapGraph {
  rootUri: ResourceUri;
  nodes: ReadonlyArray<MapNode>;
  edges: ReadonlyArray<MapEdge>;
  byUri: Map<ResourceUri, ResourceCard>;
  neighborsOf: (uri: ResourceUri) => ReadonlyArray<MapNeighbor>;
}

const MAP_KINDS: ReadonlyArray<{ k: MapNodeKind | "all"; label: string; color: string }> = [
  { k: "all", label: "All", color: "#64748b" },
  { k: "company", label: "Companies", color: "#0f4c81" },
  { k: "investor", label: "Investors", color: "#7a50b8" },
  { k: "person", label: "People", color: "#475569" },
  { k: "topic", label: "Topics", color: "#c77826" },
  { k: "regulation", label: "Regulation", color: "#0e7a5c" },
];

/** Derive one-hop neighbours from a card. Prefer `nextHops`; fall back to
 *  `evidenceRefs`; return an empty list otherwise. */
/**
 * Find a card by URI across all currently-open columns.
 * Used by the CardInspector pane to resolve the inspected URI to a card object.
 * Returns null when no match (e.g. columns were collapsed since inspection).
 */
function findCardByUri(
  columns: ReadonlyArray<ColumnState>,
  uri: ResourceUri | null,
): ResourceCard | null {
  if (!uri) return null;
  for (const col of columns) {
    for (const c of col.cards) {
      if (c.uri === uri) return c;
    }
  }
  return null;
}

function cardEdgesOut(card: ResourceCard | undefined): ReadonlyArray<ResourceUri> {
  if (!card) return [];
  if (card.nextHops && card.nextHops.length > 0) return card.nextHops;
  if (card.evidenceRefs && card.evidenceRefs.length > 0) return card.evidenceRefs;
  return [];
}

function buildMapGraph(
  cards: ReadonlyArray<ResourceCard>,
  currentRootUri: ResourceUri,
  fallbackRootUri: ResourceUri,
): MapGraph {
  const byUri = new Map<ResourceUri, ResourceCard>();
  for (const card of cards) byUri.set(card.uri, card);

  const root = byUri.get(currentRootUri) ?? byUri.get(fallbackRootUri) ?? cards[0];
  if (!root) {
    return {
      rootUri: currentRootUri,
      nodes: [],
      edges: [],
      byUri,
      neighborsOf: () => [],
    };
  }

  // First ring: neighbours of root (capped at 8 for legibility)
  const neighborUrisRaw = cardEdgesOut(root);
  const neighborUris =
    neighborUrisRaw.length > 0
      ? neighborUrisRaw.slice(0, 8)
      : // fallback: other cards in the report
        cards
          .filter((c) => c.uri !== root.uri)
          .slice(0, 8)
          .map((c) => c.uri);

  // Second ring: neighbours-of-neighbours excluding root + first ring (cap 6)
  const secondRingSet = new Set<ResourceUri>();
  neighborUris.forEach((nid) => {
    const nbCard = byUri.get(nid);
    cardEdgesOut(nbCard).forEach((sid) => {
      if (sid !== root.uri && !neighborUris.includes(sid)) {
        secondRingSet.add(sid);
      }
    });
  });
  const secondRing = Array.from(secondRingSet).slice(0, 6);

  // Canvas constants (match kit)
  const W = 900;
  const H = 620;
  const CX = W / 2;
  const CY = H / 2;
  const R1 = 200;
  const R2 = 285;

  const nodes: MapNode[] = [];
  nodes.push(toMapNode(root, 0, CX, CY));

  const N1 = neighborUris.length;
  neighborUris.forEach((uri, i) => {
    const card = byUri.get(uri) ?? makeSyntheticMapCard(uri);
    const angle = (i / Math.max(N1, 1)) * Math.PI * 2 - Math.PI / 2;
    nodes.push(toMapNode(card, 1, CX + Math.cos(angle) * R1, CY + Math.sin(angle) * R1));
  });

  const N2 = secondRing.length;
  secondRing.forEach((uri, i) => {
    const card = byUri.get(uri) ?? makeSyntheticMapCard(uri);
    const angle = (i / Math.max(N2, 1)) * Math.PI * 2 + Math.PI / Math.max(N2, 1);
    nodes.push(toMapNode(card, 2, CX + Math.cos(angle) * R2, CY + Math.sin(angle) * R2));
  });

  const posOf = (uri: ResourceUri) => nodes.find((n) => n.uri === uri);

  const edges: MapEdge[] = [];
  neighborUris.forEach((nid) => {
    if (posOf(nid)) {
      const rel = relationFor(root, byUri.get(nid));
      edges.push({ from: root.uri, to: nid, label: rel.label, relationKind: rel.kind, primary: true });
    }
    const nbCard = byUri.get(nid);
    cardEdgesOut(nbCard).forEach((sid) => {
      if (secondRing.includes(sid) && posOf(sid)) {
        const rel = relationFor(nbCard, byUri.get(sid));
        edges.push({ from: nid, to: sid, label: rel.label, relationKind: rel.kind, primary: false });
      }
    });
  });

  const neighborsOf = (uri: ResourceUri): ReadonlyArray<MapNeighbor> => {
    const seen = new Set<ResourceUri>();
    const out: MapNeighbor[] = [];
    edges.forEach((e) => {
      let otherUri: ResourceUri | null = null;
      if (e.from === uri) otherUri = e.to;
      else if (e.to === uri) otherUri = e.from;
      if (!otherUri || seen.has(otherUri)) return;
      const node = nodes.find((n) => n.uri === otherUri);
      if (!node) return;
      seen.add(otherUri);
      out.push({
        uri: node.uri,
        title: node.title,
        kind: node.kind,
        initials: node.initials,
        relationLabel: e.label,
        relationKind: e.relationKind,
      });
    });
    return out;
  };

  return { rootUri: root.uri, nodes, edges, byUri, neighborsOf };
}

function toMapNode(card: ResourceCard, ring: number, x: number, y: number): MapNode {
  return {
    uri: card.uri,
    title: card.title,
    kind: mapNodeKind(card.kind, card.uri),
    summary: card.summary,
    confidence: Math.round(card.confidence * 100),
    initials: initialsFromTitle(card.title),
    ring,
    x,
    y,
  };
}

function initialsFromTitle(title: string) {
  const parts = title.split(/\s+/).filter(Boolean);
  const initials = parts.map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return initials || title.slice(0, 2).toUpperCase();
}

function makeSyntheticMapCard(uri: ResourceUri): ResourceCard {
  const label = uri.split("/").pop()?.replace(/[-_]+/g, " ") || uri;
  return {
    cardId: `synthetic:${uri}`,
    uri,
    kind: uri.includes("person")
      ? "person_summary"
      : uri.includes("topic")
        ? "topic_summary"
        : "org_summary",
    title: label.replace(/\b\w/g, (char) => char.toUpperCase()),
    summary: "Related resource surfaced as a next hop.",
    confidence: 0.5,
  };
}

function mapNodeKind(kind: ResourceCard["kind"], uri: ResourceUri): MapNodeKind {
  if (kind.includes("person") || uri.includes("person")) return "person";
  if (kind.includes("product") || uri.includes("product")) return "product";
  if (kind.includes("event") || uri.includes("event")) return "event";
  if (kind.includes("topic") || uri.includes("topic")) return "topic";
  if (kind.includes("evidence") || uri.includes("artifact")) return "source";
  if (kind.includes("signal")) return "claim";
  return "company";
}

function mapNodeColor(kind: MapNodeKind) {
  switch (kind) {
    case "company":
      return "#0f4c81";
    case "investor":
      return "#7a50b8";
    case "market":
      return "#c77826";
    case "regulation":
      return "#0e7a5c";
    case "person":
      return "#475569";
    case "product":
      return "#7a50b8";
    case "event":
      return "#0e7a5c";
    case "topic":
      return "#c77826";
    case "source":
      return "#64748b";
    case "claim":
      return "#d97757";
    default:
      return "#64748b";
  }
}

function mapEdgeColor(kind: MapRelationKind) {
  switch (kind) {
    case "investor":
      return "#a88ad4";
    case "compete":
      return "#d97757";
    case "reg":
      return "#22b085";
    case "person":
      return "#94a3b8";
    case "sector":
      return "#e09149";
    default:
      return "#b8b2a5";
  }
}

/** Heuristic relation label derived from the two endpoint cards' kinds.
 *  The kit uses a hand-curated RELATION_LABELS map keyed by id pairs; we
 *  approximate that with a kind-product lookup since prod cards don't carry
 *  relation labels in the schema yet. */
function relationFor(
  from: ResourceCard | undefined,
  to: ResourceCard | undefined,
): { label: string; kind: MapRelationKind } {
  if (!from || !to) return { label: "related", kind: "peer" };
  const a = mapNodeKind(from.kind, from.uri);
  const b = mapNodeKind(to.kind, to.uri);
  const pair = [a, b].sort().join("+");
  if (pair.includes("regulation")) return { label: "regulated by", kind: "reg" };
  if (pair.includes("investor")) return { label: "invests in", kind: "investor" };
  if (pair.includes("market")) return { label: "operates in", kind: "sector" };
  if (pair.includes("person")) return { label: "affiliated", kind: "person" };
  if (a === "company" && b === "company") return { label: "competitor", kind: "compete" };
  if (pair.includes("topic")) return { label: "tagged", kind: "sector" };
  return { label: "related", kind: "peer" };
}

function shortMapTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized.length > 22 ? `${normalized.slice(0, 20).trim()}...` : normalized;
}

function SourcesTab({ cards }: { cards: ReadonlyArray<ResourceCard> }) {
  const evidenceRefs = useMemo(
    () =>
      Array.from(
        new Set(
          cards
            .flatMap((c) => c.evidenceRefs ?? [])
            .map((ref) => String(ref)),
        ),
      ),
    [cards],
  );
  if (evidenceRefs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-white/40">
        No evidence surfaced for this expansion yet.
      </div>
    );
  }
  return (
    <ul className="flex-1 overflow-y-auto p-4 text-sm text-white/70">
      {evidenceRefs.map((ref) => (
        <li
          key={ref}
          className="truncate border-b border-white/[0.04] py-2 font-mono text-xs text-white/60"
        >
          {ref}
        </li>
      ))}
    </ul>
  );
}

function CompareTray({
  uris,
  onClear,
}: {
  uris: ReadonlyArray<ResourceUri>;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <span className="text-[11px] uppercase tracking-[0.2em] text-white/40">
        Compare tray ({uris.length})
      </span>
      <div className="flex items-center gap-2">
        <span className="truncate text-xs text-white/60">
          {uris.slice(-3).join(" · ")}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-white/70 transition hover:bg-white/[0.06]"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
