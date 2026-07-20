/**
 * EntityCompare — Side-by-side comparison of two entities with role-based framing.
 *
 * Primary use cases:
 * - company vs competitor
 * - founder vs founder
 * - prospect vs prospect
 * - target acquisition A vs B
 * - portfolio company vs new lead
 *
 * Each column shows: what it is, who matters, what changed, strengths, risks,
 * and role-specific fit (banker / VC / acquirer / founder).
 */

import { memo, useState, useCallback } from "react";
import {
  GitCompare,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowRight,
  Search,
  Building2,
  User,
  BarChart3,
  Shield,
  Target,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type RoleLens = "founder" | "investor" | "banker" | "buyer" | "operator";

interface EntityProfile {
  name: string;
  type: "company" | "founder" | "product";
  summary: string;
  confidence: number; // 0-100
  strengths: string[];
  risks: string[];
  keyPeople: string[];
  recentChange: string | null;
  roleFit: Record<
    RoleLens,
    { score: number; label: string; detail: string }
  >;
}

interface ComparisonResult {
  winner: "left" | "right" | "tie" | null;
  deltas: {
    label: string;
    left: string | number;
    right: string | number;
    direction: "left" | "right" | "tie";
  }[];
  recommendation: string;
}

// ─── Demo data ───────────────────────────────────────────────────────────────

const DEMO_LEFT: EntityProfile = {
  name: "Anthropic",
  type: "company",
  summary:
    "AI safety company building reliable, interpretable, and steerable AI systems. Known for Claude and constitutional AI research.",
  confidence: 82,
  strengths: [
    "Strong safety brand differentiation",
    "Claude model family gaining enterprise traction",
    "Deep research bench (constitutional AI)",
    "Amazon strategic partnership",
  ],
  risks: [
    "Revenue concentration in enterprise API",
    "Dependent on cloud partner infrastructure",
    "Safety messaging may limit speed-to-market",
  ],
  keyPeople: ["Dario Amodei (CEO)", "Daniela Amodei (President)"],
  recentChange: "Claude 3.5 Sonnet release — enterprise adoption accelerating",
  roleFit: {
    founder: {
      score: 72,
      label: "Strong partner",
      detail: "Potential API partner for product differentiation",
    },
    investor: {
      score: 78,
      label: "High conviction",
      detail: "Safety-first positioning is a durable moat",
    },
    banker: {
      score: 65,
      label: "Emerging coverage",
      detail: "Enterprise API revenue growing but still early",
    },
    buyer: {
      score: 40,
      label: "Not acquirable",
      detail: "Valuation too high for traditional acquisition",
    },
    operator: {
      score: 70,
      label: "Model supplier",
      detail: "Good API vendor for AI-powered workflows",
    },
  },
};

const DEMO_RIGHT: EntityProfile = {
  name: "OpenAI",
  type: "company",
  summary:
    "AI research lab and product company. Known for GPT models, ChatGPT, and DALL-E. Largest consumer AI product globally.",
  confidence: 90,
  strengths: [
    "Dominant consumer brand (ChatGPT)",
    "Largest revenue scale in AI category",
    "Microsoft strategic partnership + distribution",
    "Broadest model capability range",
  ],
  risks: [
    "Governance instability (board events)",
    "Mission tension between safety and speed",
    "Consumer churn risk as competition rises",
  ],
  keyPeople: ["Sam Altman (CEO)", "Mira Murati (CTO)"],
  recentChange:
    "GPT-4o launch — multimodal consumer product expansion",
  roleFit: {
    founder: {
      score: 68,
      label: "Competitive threat",
      detail: "Dominant distribution makes partnership less favorable",
    },
    investor: {
      score: 85,
      label: "Category leader",
      detail: "Revenue scale and growth justify premium valuation",
    },
    banker: {
      score: 80,
      label: "Tier-1 coverage",
      detail: "Largest AI company by revenue — top priority",
    },
    buyer: {
      score: 20,
      label: "Not acquirable",
      detail: "Valuation and structure prevent acquisition",
    },
    operator: {
      score: 75,
      label: "Primary vendor",
      detail: "Most capable model family for general use",
    },
  },
};

// ─── Subcomponents ───────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const color =
    value >= 75
      ? "bg-emerald-500"
      : value >= 50
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs font-mono text-content-muted">{value}%</span>
    </div>
  );
}

function RoleFitBadge({
  lens,
  fit,
  isActive,
  onClick,
}: {
  lens: RoleLens;
  fit: { score: number; label: string; detail: string };
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-all ${
        isActive
          ? "border-accent-primary/30 bg-accent-primary/[0.06]"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-content-muted">
          {lens}
        </span>
        <span className="text-sm font-bold text-content">{fit.score}</span>
      </div>
      <div className="text-xs font-medium text-content">{fit.label}</div>
      <p className="mt-1 text-[11px] text-content-muted leading-relaxed">
        {fit.detail}
      </p>
    </button>
  );
}

function EntityColumn({
  entity,
  activeLens,
  onLensSelect,
  side,
}: {
  entity: EntityProfile;
  activeLens: RoleLens;
  onLensSelect: (lens: RoleLens) => void;
  side: "left" | "right";
}) {
  const fit = entity.roleFit[activeLens];
  const borderClass =
    side === "left"
      ? "border-white/[0.06] bg-white/[0.02]"
      : "border-accent-primary/10 bg-accent-primary/[0.02]";

  return (
    <div className={`rounded-xl border ${borderClass} p-4 space-y-4`}>
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          {entity.type === "company" ? (
            <Building2 className="h-4 w-4 text-content-muted" />
          ) : (
            <User className="h-4 w-4 text-content-muted" />
          )}
          <h3 className="text-sm font-semibold text-content">
            {entity.name}
          </h3>
        </div>
        <p className="text-xs text-content-muted leading-relaxed">
          {entity.summary}
        </p>
      </div>

      {/* Confidence */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-content-muted mb-1">
          Confidence
        </div>
        <ConfidenceBar value={entity.confidence} />
      </div>

      {/* Recent change */}
      {entity.recentChange && (
        <div className="rounded-lg border border-amber-500/10 bg-amber-500/[0.04] p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-amber-400 mb-1">
            What Changed
          </div>
          <p className="text-xs text-content">{entity.recentChange}</p>
        </div>
      )}

      {/* Strengths */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-content-muted mb-2">
          Strengths
        </div>
        <ul className="space-y-1.5">
          {entity.strengths.map((s) => (
            <li key={s} className="flex items-start gap-2 text-xs text-content">
              <CheckCircle className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
              {s}
            </li>
          ))}
        </ul>
      </div>

      {/* Risks */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-content-muted mb-2">
          Risks
        </div>
        <ul className="space-y-1.5">
          {entity.risks.map((r) => (
            <li key={r} className="flex items-start gap-2 text-xs text-content">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
              {r}
            </li>
          ))}
        </ul>
      </div>

      {/* Key people */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-content-muted mb-2">
          Key People
        </div>
        <div className="flex flex-wrap gap-1.5">
          {entity.keyPeople.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[11px] text-content-secondary"
            >
              <User className="h-2.5 w-2.5" />
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* Role lens fit */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-content-muted mb-2">
          Role Fit
        </div>
        <div className="grid gap-2 grid-cols-2">
          {(Object.entries(entity.roleFit) as [RoleLens, typeof fit][]).map(
            ([lens, lensFit]) => (
              <RoleFitBadge
                key={lens}
                lens={lens}
                fit={lensFit}
                isActive={activeLens === lens}
                onClick={() => onLensSelect(lens)}
              />
            ),
          )}
        </div>
      </div>

      {/* Active lens detail */}
      <div className="rounded-lg border border-accent-primary/15 bg-accent-primary/[0.04] p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-[0.14em] text-accent-primary">
            {activeLens} view
          </span>
          <span className="text-lg font-bold text-content">
            {fit.score}
          </span>
        </div>
        <div className="text-xs font-medium text-content">{fit.label}</div>
        <p className="mt-1 text-[11px] text-content-muted">
          {fit.detail}
        </p>
      </div>
    </div>
  );
}

// ─── Comparison logic ────────────────────────────────────────────────────────

function computeComparison(
  left: EntityProfile,
  right: EntityProfile,
  lens: RoleLens,
): ComparisonResult {
  const leftScore = left.roleFit[lens].score;
  const rightScore = right.roleFit[lens].score;

  const deltas: ComparisonResult["deltas"] = [
    {
      label: "Confidence",
      left: left.confidence,
      right: right.confidence,
      direction:
        left.confidence > right.confidence
          ? "left"
          : right.confidence > left.confidence
            ? "right"
            : "tie",
    },
    {
      label: `${lens} fit`,
      left: leftScore,
      right: rightScore,
      direction:
        leftScore > rightScore ? "left" : rightScore > leftScore ? "right" : "tie",
    },
    {
      label: "Strengths",
      left: left.strengths.length,
      right: right.strengths.length,
      direction:
        left.strengths.length > right.strengths.length
          ? "left"
          : right.strengths.length > left.strengths.length
            ? "right"
            : "tie",
    },
    {
      label: "Risks",
      left: left.risks.length,
      right: right.risks.length,
      direction:
        left.risks.length < right.risks.length
          ? "left"
          : right.risks.length < left.risks.length
            ? "right"
            : "tie",
    },
  ];

  const winner =
    leftScore > rightScore + 10
      ? "left"
      : rightScore > leftScore + 10
        ? "right"
        : Math.abs(leftScore - rightScore) <= 10
          ? "tie"
          : null;

  const recommendation =
    winner === "left"
      ? `${left.name} is the stronger choice from a ${lens} perspective, but watch ${right.name}'s ${right.recentChange ?? "recent moves"}.`
      : winner === "right"
        ? `${right.name} leads from the ${lens} angle. ${left.name} may still be relevant for ${left.roleFit[lens].label.toLowerCase()}.`
        : `Both score similarly for ${lens}. Differentiate on specific context: ${left.roleFit[lens].detail} vs ${right.roleFit[lens].detail}.`;

  return { winner, deltas, recommendation };
}

// ─── Main Component ─────────────────────────────────────────────────────────

function EntityCompareInner() {
  const [leftEntity] = useState<EntityProfile>(DEMO_LEFT);
  const [rightEntity] = useState<EntityProfile>(DEMO_RIGHT);
  const [activeLens, setActiveLens] = useState<RoleLens>("investor");
  const [leftSearch, setLeftSearch] = useState("");
  const [rightSearch, setRightSearch] = useState("");

  const comparison = useCallback(
    () => computeComparison(leftEntity, rightEntity, activeLens),
    [leftEntity, rightEntity, activeLens],
  )();

  const lenses: { id: RoleLens; icon: typeof Target; label: string }[] = [
    { id: "founder", icon: Target, label: "Founder" },
    { id: "investor", icon: BarChart3, label: "Investor" },
    { id: "banker", icon: Building2, label: "Banker" },
    { id: "buyer", icon: Shield, label: "Buyer" },
    { id: "operator", icon: TrendingUp, label: "Operator" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <GitCompare className="h-5 w-5 text-accent-primary" />
        <div>
          <h1 className="text-lg font-semibold text-content">
            Entity Compare
          </h1>
          <p className="text-xs text-content-muted">
            Side-by-side diligence with role-specific framing
          </p>
        </div>
      </div>

      {/* Role lens selector */}
      <div className="flex gap-1.5">
        {lenses.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveLens(id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              activeLens === id
                ? "bg-accent-primary/15 text-accent-primary"
                : "border border-white/[0.06] text-content-muted hover:bg-white/[0.04] hover:text-content"
            }`}
            aria-pressed={activeLens === id}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Search inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" />
          <input
            type="text"
            value={leftSearch}
            onChange={(e) => setLeftSearch(e.target.value)}
            placeholder="Search entity A..."
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] pl-9 pr-3 py-2 text-sm text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
          />
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" />
          <input
            type="text"
            value={rightSearch}
            onChange={(e) => setRightSearch(e.target.value)}
            placeholder="Search entity B..."
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] pl-9 pr-3 py-2 text-sm text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
          />
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-2 gap-3">
        <EntityColumn
          entity={leftEntity}
          activeLens={activeLens}
          onLensSelect={setActiveLens}
          side="left"
        />
        <EntityColumn
          entity={rightEntity}
          activeLens={activeLens}
          onLensSelect={setActiveLens}
          side="right"
        />
      </div>

      {/* Delta summary */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-3">
          Comparison Matrix ({activeLens} lens)
        </div>
        <div className="space-y-2">
          {comparison.deltas.map((delta) => (
            <div
              key={delta.label}
              className="flex items-center gap-3 text-xs"
            >
              <span className="w-24 text-content-muted">{delta.label}</span>
              <span
                className={`w-12 text-right font-mono ${
                  delta.direction === "left"
                    ? "text-emerald-400 font-semibold"
                    : "text-content-muted"
                }`}
              >
                {delta.left}
              </span>
              <span className="text-content-muted">vs</span>
              <span
                className={`w-12 font-mono ${
                  delta.direction === "right"
                    ? "text-emerald-400 font-semibold"
                    : "text-content-muted"
                }`}
              >
                {delta.right}
              </span>
              <span className="ml-auto">
                {delta.direction === "left" ? (
                  <TrendingUp className="h-3 w-3 text-emerald-400" />
                ) : delta.direction === "right" ? (
                  <TrendingDown className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Minus className="h-3 w-3 text-content-muted" />
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recommendation */}
      <div className="rounded-xl border border-accent-primary/15 bg-accent-primary/[0.04] p-4">
        <div className="flex items-center gap-2 mb-2">
          <ArrowRight className="h-4 w-4 text-accent-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
            Recommendation
          </span>
        </div>
        <p className="text-sm leading-relaxed text-content">
          {comparison.recommendation}
        </p>
      </div>

      {/* Demo notice */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-[10px] text-amber-400">
        Demo comparison: Anthropic vs OpenAI. Search two entities above to
        compare real diligence packets.
      </div>
    </div>
  );
}

export const EntityCompare = memo(EntityCompareInner);
export default EntityCompare;
