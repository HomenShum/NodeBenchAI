/**
 * ApiDocsPage — Interactive browseable MCP tool catalog ("Swagger for MCP").
 *
 * Left sidebar: category list with tool counts (clickable filter).
 * Right content: tool cards with name, description, input fields, complexity/phase badges.
 * Top search bar filters by tool name.
 */

import React, { useState, useMemo } from "react";
import { Search, ChevronRight, Layers, Zap, BookOpen, Code2, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import {
  TOOL_CATALOG,
  CATALOG_CATEGORIES,
  CATEGORY_LABELS,
  FULL_REGISTRY_COUNTS,
  TOTAL_TOOLS,
  type ToolCatalogEntry,
} from "../lib/toolCatalog";

// ── Complexity badge colors ──────────────────────────────────────────────────

const COMPLEXITY_STYLES: Record<string, string> = {
  low: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  high: "bg-rose-500/15 text-rose-400 border-rose-500/20",
};

const PHASE_STYLES: Record<string, string> = {
  research: "bg-blue-500/15 text-blue-400",
  implement: "bg-purple-500/15 text-purple-400",
  test: "bg-yellow-500/15 text-yellow-400",
  verify: "bg-cyan-500/15 text-cyan-400",
  ship: "bg-green-500/15 text-green-400",
  meta: "bg-slate-500/15 text-slate-400",
  utility: "bg-gray-500/15 text-gray-400",
};

// ── Tool Card ────────────────────────────────────────────────────────────────

function ToolCard({ tool }: { tool: ToolCatalogEntry }) {
  return (
    <div className="rounded-xl border border-edge/50 bg-surface/60 backdrop-blur-sm p-4 hover:border-edge hover:bg-surface/80 transition-all duration-200 group">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-content font-mono group-hover:text-primary transition-colors">
          {tool.name}
        </h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${COMPLEXITY_STYLES[tool.complexity]}`}>
            {tool.complexity}
          </span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${PHASE_STYLES[tool.phase]}`}>
            {tool.phase}
          </span>
        </div>
      </div>

      {/* Category pill */}
      <div className="mb-2">
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary/80">
          {CATEGORY_LABELS[tool.category] ?? tool.category}
        </span>
      </div>

      {/* Description */}
      <p className="text-xs text-content-secondary leading-relaxed mb-3">
        {tool.description}
      </p>

      {/* Input fields */}
      {tool.inputFields && tool.inputFields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tool.inputFields.map((field) => (
            <span
              key={field}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-secondary text-content-muted border border-edge/30"
            >
              {field}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Category sidebar item ────────────────────────────────────────────────────

function CategoryItem({
  category,
  count,
  fullCount,
  isActive,
  onClick,
}: {
  category: string;
  count: number;
  fullCount: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all duration-150 flex items-center justify-between group ${
        isActive
          ? "bg-primary/10 text-primary border border-primary/20"
          : "text-content-secondary hover:bg-surface-hover hover:text-content border border-transparent"
      }`}
    >
      <span className="font-medium truncate">
        {CATEGORY_LABELS[category] ?? category}
      </span>
      <span className={`text-[10px] tabular-nums shrink-0 ml-2 ${isActive ? "text-primary" : "text-content-muted"}`}>
        {count}/{fullCount}
      </span>
    </button>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function ApiDocsPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Filter tools by search + category
  const filtered = useMemo(() => {
    let result = TOOL_CATALOG;
    if (activeCategory) {
      result = result.filter((t) => t.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q),
      );
    }
    return result;
  }, [search, activeCategory]);

  // Category counts (from filtered catalog entries)
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of TOOL_CATALOG) {
      counts[t.category] = (counts[t.category] || 0) + 1;
    }
    return counts;
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-5 border-b border-edge/50">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-content">API Reference</h1>
            <p className="text-xs text-content-secondary">
              {TOTAL_TOOLS} MCP tools across {Object.keys(FULL_REGISTRY_COUNTS).length} categories
            </p>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative mt-4 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-content-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools by name, description, or category..."
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-edge/50 bg-surface/60 backdrop-blur-sm text-content placeholder:text-content-muted focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
          />
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar — category list */}
        <aside className="w-56 shrink-0 border-r border-edge/30 overflow-y-auto p-3 space-y-1 hidden md:block">
          {/* All tools button */}
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 flex items-center justify-between ${
              activeCategory === null
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-content-secondary hover:bg-surface-hover hover:text-content border border-transparent"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              All Tools
            </span>
            <span className="text-[10px] tabular-nums">{TOOL_CATALOG.length}</span>
          </button>

          <div className="h-px bg-edge/30 my-2" />

          {CATALOG_CATEGORIES.map((cat) => (
            <CategoryItem
              key={cat}
              category={cat}
              count={categoryCounts[cat] || 0}
              fullCount={FULL_REGISTRY_COUNTS[cat] || 0}
              isActive={activeCategory === cat}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            />
          ))}

          {/* Link to full developers page */}
          <div className="h-px bg-edge/30 my-2" />
          <Link
            to="/developers"
            className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-content-muted hover:text-primary transition-colors rounded-lg hover:bg-surface-hover"
          >
            <ExternalLink className="h-3 w-3" />
            View all {TOTAL_TOOLS} tools
          </Link>
        </aside>

        {/* Right content — tool cards */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* Mobile category selector */}
          <div className="md:hidden mb-4">
            <select
              value={activeCategory ?? ""}
              onChange={(e) => setActiveCategory(e.target.value || null)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-edge/50 bg-surface text-content"
            >
              <option value="">All Categories ({TOOL_CATALOG.length})</option>
              {CATALOG_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat] ?? cat} ({categoryCounts[cat] || 0})
                </option>
              ))}
            </select>
          </div>

          {/* Results count */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-content-muted">
              Showing {filtered.length} of {TOOL_CATALOG.length} cataloged tools
              {activeCategory && (
                <span>
                  {" "}in <span className="text-primary font-medium">{CATEGORY_LABELS[activeCategory] ?? activeCategory}</span>
                </span>
              )}
            </p>
            {activeCategory && (
              <button
                type="button"
                onClick={() => setActiveCategory(null)}
                className="text-[11px] text-content-muted hover:text-content transition-colors"
              >
                Clear filter
              </button>
            )}
          </div>

          {/* Tool grid */}
          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filtered.map((tool) => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-content-muted">
              <Code2 className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No tools match your search</p>
              <p className="text-xs mt-1">Try a different keyword or clear the category filter</p>
            </div>
          )}

          {/* Footer CTA */}
          <div className="mt-8 p-4 rounded-xl border border-edge/30 bg-surface/40 backdrop-blur-sm text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-content">
                This catalog shows {TOOL_CATALOG.length} of {TOTAL_TOOLS} total tools
              </span>
            </div>
            <p className="text-xs text-content-secondary mb-3">
              The full registry includes {Object.keys(FULL_REGISTRY_COUNTS).length} categories covering
              deep simulation, research, verification, agent orchestration, security, and more.
            </p>
            <Link
              to="/developers"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              View all {TOTAL_TOOLS} tools
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}

export default ApiDocsPage;
