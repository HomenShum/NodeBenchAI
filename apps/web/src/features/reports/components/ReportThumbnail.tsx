// ReportThumbnail — inline SVG preview thumbs ported 1:1 from the NodeBench web kit.
// Kit source: docs/design/nodebench-ai-design-system/ui_kits/nodebench-web/ReportCard.jsx (lines 6-121)
//
// Renders a tiny inline SVG "dashboard" that signals the report's shape at a glance.
// Six kinds: diligence (KV pairs + risk card), bars (bar chart), table (rows+status),
// line (trend line), memo (document/brief), matrix (scatter/competitor map).

import { type CSSProperties, type ReactNode } from "react";

export type ReportThumbnailKind =
  | "diligence"
  | "bars"
  | "table"
  | "line"
  | "memo"
  | "matrix";

const THUMBNAILS: Record<ReportThumbnailKind, ReactNode> = {
  // DISCO — diligence debrief: kv pairs + risk bar
  diligence: (
    <svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <defs>
        <linearGradient id="nb-thumb-dgrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFF3EC" />
          <stop offset="1" stopColor="#FBE5D6" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#nb-thumb-dgrad)" />
      {/* Header mini */}
      <rect x="20" y="18" width="90" height="8" rx="2" fill="#AD5F45" opacity=".9" />
      <rect x="20" y="30" width="140" height="5" rx="2" fill="#AD5F45" opacity=".35" />
      {/* KV pairs left */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i} transform={`translate(20, ${54 + i * 20})`}>
          <rect width="50" height="5" rx="2" fill="#6B7280" opacity=".5" />
          <rect x="60" width="80" height="6" rx="2" fill="#111827" opacity=".7" />
        </g>
      ))}
      {/* Risk card right */}
      <rect x="190" y="54" width="110" height="100" rx="8" fill="#fff" stroke="#E5D1C0" />
      <rect x="202" y="66" width="44" height="5" rx="2" fill="#B45309" opacity=".8" />
      <rect x="202" y="78" width="85" height="7" rx="2" fill="#111827" opacity=".72" />
      <rect x="202" y="92" width="85" height="5" rx="2" fill="#6B7280" opacity=".45" />
      <rect x="202" y="102" width="85" height="5" rx="2" fill="#6B7280" opacity=".45" />
      <rect x="202" y="112" width="60" height="5" rx="2" fill="#6B7280" opacity=".45" />
      <rect x="202" y="130" width="76" height="10" rx="5" fill="#D97757" opacity=".85" />
    </svg>
  ),

  // Mercor — hiring velocity: bar chart of roles
  bars: (
    <svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <rect width="320" height="180" fill="#F3F4F6" />
      <rect x="20" y="18" width="120" height="8" rx="2" fill="#111827" opacity=".82" />
      <rect x="20" y="30" width="180" height="5" rx="2" fill="#6B7280" opacity=".5" />
      {/* Axes */}
      <line x1="30" y1="150" x2="300" y2="150" stroke="#D1D5DB" />
      {[18, 32, 28, 44, 38, 56, 48].map((h, i) => (
        <rect
          key={i}
          x={40 + i * 38}
          y={150 - h * 1.6}
          width="24"
          height={h * 1.6}
          rx="3"
          fill={i === 5 ? "#D97757" : "#5E6AD2"}
          opacity={i === 5 ? 1 : 0.55}
        />
      ))}
      {/* Legend */}
      <circle cx="30" cy="165" r="3" fill="#5E6AD2" opacity=".55" />
      <rect x="38" y="162" width="38" height="5" rx="2" fill="#6B7280" opacity=".5" />
      <circle cx="90" cy="165" r="3" fill="#D97757" />
      <rect x="98" y="162" width="30" height="5" rx="2" fill="#6B7280" opacity=".5" />
    </svg>
  ),

  // Cognition — benchmark postmortem: table-ish
  table: (
    <svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <rect width="320" height="180" fill="#FAFAFA" />
      <rect x="20" y="18" width="110" height="8" rx="2" fill="#111827" opacity=".82" />
      <rect x="140" y="18" width="42" height="10" rx="5" fill="#B45309" opacity=".15" stroke="#B45309" strokeOpacity=".3" />
      <rect x="146" y="21" width="30" height="4" rx="2" fill="#B45309" opacity=".8" />
      {/* table header */}
      <rect x="20" y="48" width="280" height="16" rx="3" fill="#E5E7EB" />
      {[20, 105, 175, 235].map((x, i) => (
        <rect key={i} x={x + 6} y="54" width={i === 0 ? 40 : 40} height="4" rx="2" fill="#374151" opacity=".75" />
      ))}
      {/* table rows */}
      {[0, 1, 2, 3, 4].map((r) => (
        <g key={r} transform={`translate(0, ${68 + r * 18})`}>
          <rect x="20" y="0" width="280" height="16" rx="3" fill={r % 2 ? "#F3F4F6" : "#fff"} stroke="#E5E7EB" />
          <rect x="26" y="6" width="72" height="4" rx="2" fill="#111827" opacity=".7" />
          <rect x="111" y="6" width="56" height="4" rx="2" fill="#6B7280" opacity=".55" />
          <rect x="181" y="6" width="48" height="4" rx="2" fill="#6B7280" opacity=".55" />
          <rect
            x="241"
            y="4"
            width="24"
            height="8"
            rx="4"
            fill={r < 2 ? "#047857" : r === 2 ? "#B45309" : "#9CA3AF"}
            opacity={r < 2 ? 0.85 : r === 2 ? 0.75 : 0.45}
          />
        </g>
      ))}
    </svg>
  ),

  // Turing — contract spend YoY: line chart
  line: (
    <svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <rect width="320" height="180" fill="#FFFDF7" />
      <rect x="20" y="18" width="140" height="8" rx="2" fill="#111827" opacity=".82" />
      <rect x="20" y="30" width="60" height="5" rx="2" fill="#047857" opacity=".75" />
      <line x1="30" y1="150" x2="300" y2="150" stroke="#E5E7EB" />
      <line x1="30" y1="110" x2="300" y2="110" stroke="#E5E7EB" strokeDasharray="2 3" />
      <line x1="30" y1="70" x2="300" y2="70" stroke="#E5E7EB" strokeDasharray="2 3" />
      <path
        d="M 30 138 L 75 128 L 120 118 L 165 102 L 210 84 L 255 62 L 300 48"
        fill="none"
        stroke="#D97757"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M 30 138 L 75 128 L 120 118 L 165 102 L 210 84 L 255 62 L 300 48 L 300 150 L 30 150 Z"
        fill="#D97757"
        opacity=".12"
      />
      {[30, 75, 120, 165, 210, 255, 300].map((x, i) => (
        <circle key={i} cx={x} cy={[138, 128, 118, 102, 84, 62, 48][i]} r="3" fill="#D97757" />
      ))}
    </svg>
  ),

  // generic competitor matrix
  matrix: (
    <svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <rect width="320" height="180" fill="#F3F4F6" />
      <rect x="20" y="18" width="110" height="8" rx="2" fill="#111827" opacity=".82" />
      <rect x="20" y="50" width="280" height="112" rx="6" fill="#fff" stroke="#E5E7EB" />
      <line x1="20" y1="106" x2="300" y2="106" stroke="#E5E7EB" strokeDasharray="2 3" />
      <line x1="160" y1="50" x2="160" y2="162" stroke="#E5E7EB" strokeDasharray="2 3" />
      <circle cx="105" cy="80" r="10" fill="#5E6AD2" opacity=".75" />
      <circle cx="215" cy="70" r="14" fill="#D97757" />
      <circle cx="240" cy="128" r="8" fill="#9CA3AF" opacity=".7" />
      <circle cx="80" cy="140" r="6" fill="#9CA3AF" opacity=".5" />
      <circle cx="180" cy="110" r="7" fill="#047857" opacity=".7" />
    </svg>
  ),

  // brief / memo
  memo: (
    <svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <rect width="320" height="180" fill="#FBF8F2" />
      <rect x="20" y="18" width="80" height="8" rx="2" fill="#111827" opacity=".82" />
      <rect x="20" y="30" width="140" height="5" rx="2" fill="#AD5F45" opacity=".6" />
      {Array.from({ length: 9 }).map((_, i) => (
        <rect
          key={i}
          x="20"
          y={52 + i * 12}
          width={i % 3 === 2 ? 180 : 280}
          height="5"
          rx="2"
          fill="#6B7280"
          opacity={i % 4 === 0 ? 0.7 : 0.35}
        />
      ))}
    </svg>
  ),
};

export interface ReportThumbnailProps {
  kind: ReportThumbnailKind;
  className?: string;
  style?: CSSProperties;
  /** Accessible label for screen readers; default "Report preview". */
  ariaLabel?: string;
}

/**
 * ReportThumbnail — renders one of 6 inline SVG preview thumbs.
 * The SVG uses preserveAspectRatio="xMidYMid slice" and fills its wrapper,
 * so the caller controls the aspect ratio via className (e.g. "aspect-[16/10]").
 */
export function ReportThumbnail({
  kind,
  className,
  style,
  ariaLabel = "Report preview",
}: ReportThumbnailProps) {
  const thumb = THUMBNAILS[kind] ?? THUMBNAILS.memo;
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ overflow: "hidden", ...style }}
    >
      {thumb}
    </div>
  );
}

/**
 * Heuristic kind picker from entity fields.
 *
 * Priority:
 * 1. Explicit latestReportType values ("diligence", "bars", "table", "line", "memo", "matrix") pass through.
 * 2. latestReportType keyword match (benchmark/postmortem → table, trend/spend → line, etc.).
 * 3. entityType (company/organization → diligence, person → memo, market → matrix, metric → bars).
 * 4. Fallback → "memo".
 */
export function pickReportThumbnailKind(input: {
  entityType?: string;
  latestReportType?: string;
  slug?: string;
}): ReportThumbnailKind {
  const reportType = (input.latestReportType ?? "").toLowerCase().trim();
  const entityType = (input.entityType ?? "").toLowerCase().trim();

  // 1. Direct match on kind name
  if (
    reportType === "diligence" ||
    reportType === "bars" ||
    reportType === "table" ||
    reportType === "line" ||
    reportType === "memo" ||
    reportType === "matrix"
  ) {
    return reportType as ReportThumbnailKind;
  }

  // 2. Keyword heuristics on report type
  if (reportType) {
    if (/(diligence|disco|risk|debrief)/.test(reportType)) return "diligence";
    if (/(benchmark|postmortem|compare|scorecard|table)/.test(reportType)) return "table";
    if (/(trend|spend|growth|yoy|timeline|line)/.test(reportType)) return "line";
    if (/(hiring|velocity|metric|bar|count)/.test(reportType)) return "bars";
    if (/(competitor|matrix|positioning|landscape|map)/.test(reportType)) return "matrix";
    if (/(memo|brief|framework|policy|summary|note)/.test(reportType)) return "memo";
  }

  // 3. Entity-type fallback
  if (/(company|organization|startup|business)/.test(entityType)) return "diligence";
  if (/(competitor|market|segment|industry)/.test(entityType)) return "matrix";
  if (/(metric|kpi|benchmark)/.test(entityType)) return "bars";
  if (/(trend|signal|timeline)/.test(entityType)) return "line";
  if (/(person|contact|founder|people)/.test(entityType)) return "memo";

  return "memo";
}

export default ReportThumbnail;
