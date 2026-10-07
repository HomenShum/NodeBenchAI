/**
 * PricingPage — 4-tier pricing with comparison table, FAQ, glass card styling.
 */

import { memo, useCallback, useState } from "react";
import { ArrowRight, Check, Minus, Sparkles } from "lucide-react";
import { useRevealOnMount } from "@/hooks/useRevealOnMount";
import { buildCockpitPath } from "@/lib/registry/viewRegistry";

/* ------------------------------------------------------------------ */
/*  Tier data                                                          */
/* ------------------------------------------------------------------ */

const TIERS = [
  {
    name: "Free",
    subtitle: "Try it now",
    price: "$0",
    period: "",
    description: "Search any company, get an intelligence packet. No signup required.",
    cta: "Start searching",
    href: buildCockpitPath({ surfaceId: "ask" }),
    highlighted: false,
    features: [
      "5 deep diligence searches per day",
      "6 role lenses (founder, investor, banker, CEO, legal, student)",
      "People, timeline, financials, market, products, risks",
      "Gap remediation with actionable steps",
      "SEO audit and missing presence detection",
    ],
  },
  {
    name: "Pro",
    subtitle: "For founders",
    price: "$29",
    period: "/mo",
    description: "Unlimited searches, export packets, company truth memory, and MCP integration.",
    cta: "Start Pro trial",
    href: "#",
    highlighted: true,
    badge: "Most popular",
    features: [
      "Unlimited deep diligence searches",
      "Export: PDF, markdown, Slack one-pager, credit memo",
      "Subconscious memory (12 company truth blocks)",
      "Knowledge graph with contradiction detection",
      "MCP integration (350+ tools in Claude Code)",
      "Weekly founder reset and delegation packets",
      "Priority Gemini 3.1 Pro for synthesis",
    ],
  },
  {
    name: "Team",
    subtitle: "For teams",
    price: "$99",
    period: "/seat/mo",
    description: "Shared company truth, team packets, role-based access, and collaborative workspace.",
    cta: "Start Team trial",
    href: "#",
    highlighted: false,
    features: [
      "Everything in Pro",
      "Shared company truth across team members",
      "Collaborative decision memos and packets",
      "Role-based access (founder, analyst, advisor views)",
      "Team activity feed and delegation tracking",
      "Investor and banker readiness scoring",
      "Vertical diligence packs (SaaS, fintech, healthcare)",
    ],
  },
  {
    name: "Enterprise",
    subtitle: "Custom",
    price: "Custom",
    period: "",
    description: "Self-hosted, SSO, audit logs, custom integrations, and dedicated support.",
    cta: "Talk to us",
    href: "mailto:homen@nodebenchai.com",
    highlighted: false,
    features: [
      "Everything in Team",
      "Self-hosted deployment option",
      "SSO and audit log export",
      "Custom MCP tool development",
      "Dedicated Convex instance",
      "SLA and priority support",
      "Custom entity enrichment sources",
    ],
  },
] as const;

/* ------------------------------------------------------------------ */
/*  Comparison table                                                   */
/* ------------------------------------------------------------------ */

type CellValue = string | boolean;

interface ComparisonRow {
  label: string;
  free: CellValue;
  pro: CellValue;
  team: CellValue;
  enterprise: CellValue;
}

const COMPARISON: ComparisonRow[] = [
  { label: "Deep diligence searches", free: "5/day", pro: "Unlimited", team: "Unlimited", enterprise: "Unlimited" },
  { label: "Research branches", free: "6", pro: "6", team: "6", enterprise: "6 + custom" },
  { label: "Chain depth per branch", free: "3 levels", pro: "3 levels", team: "3 levels", enterprise: "5 levels" },
  { label: "Role lenses", free: "6", pro: "6", team: "6 + custom", enterprise: "Unlimited" },
  { label: "Gap remediation", free: true, pro: true, team: true, enterprise: true },
  { label: "SEO audit", free: true, pro: true, team: true, enterprise: true },
  { label: "Export (PDF, markdown, memo)", free: false, pro: true, team: true, enterprise: true },
  { label: "Subconscious memory", free: false, pro: "12 blocks", team: "Shared", enterprise: "Shared + custom" },
  { label: "Knowledge graph", free: false, pro: true, team: true, enterprise: true },
  { label: "MCP integration (350+ tools)", free: false, pro: true, team: true, enterprise: true },
  { label: "Claude Code plugin + nudges", free: false, pro: true, team: true, enterprise: true },
  { label: "Codex delegation bridge", free: false, pro: true, team: true, enterprise: true },
  { label: "Team shared context", free: false, pro: false, team: true, enterprise: true },
  { label: "SSO and audit logs", free: false, pro: false, team: false, enterprise: true },
];

const TIER_KEYS = ["free", "pro", "team", "enterprise"] as const;
const TIER_LABELS = ["Free", "Pro", "Team", "Enterprise"] as const;

/* ------------------------------------------------------------------ */
/*  FAQ                                                                */
/* ------------------------------------------------------------------ */

const FAQ = [
  {
    q: "What can I do for free?",
    a: "Search any company and get a full deep diligence packet: people, timeline, financials, competitive landscape, products, and risk flags. 5 searches per day, 6 role lenses, gap remediation included. No signup required.",
  },
  {
    q: "What does Pro unlock?",
    a: "Unlimited searches, exportable packets (PDF, markdown, Slack one-pager, credit memo), subconscious memory that persists company truth across sessions, MCP integration with 350+ tools in Claude Code, and priority Gemini 3.1 Pro for deeper synthesis.",
  },
  {
    q: "How does the MCP integration work?",
    a: "Run 'claude mcp add nodebench -- npx -y nodebench-mcp --preset founder' in Claude Code. You get 350+ tools, autonomous nudges during coding, and the Claude Code plugin with /nodebench:search, /nodebench:diligence, and /nodebench:remediate commands.",
  },
  {
    q: "What is the subconscious memory?",
    a: "12 typed memory blocks (company identity, current wedge, contradictions, priorities, etc.) that persist across sessions. When you start a new Claude Code session, NodeBench whispers relevant company truth so you never lose context.",
  },
  {
    q: "Can I use NodeBench on my own company?",
    a: "Yes. Self-search enrichment injects your local context (codebase, docs, README) for honest self-assessment. Our own self-search found SEO gaps, brand confusion, and missing presence — then we fixed them. The product proves itself.",
  },
] as const;

/* ------------------------------------------------------------------ */
/*  Comparison cell renderer                                           */
/* ------------------------------------------------------------------ */

function ComparisonCell({ value }: { value: CellValue }) {
  if (value === true) {
    return <Check className="mx-auto h-4 w-4 text-emerald-400" aria-label="Included" />;
  }
  if (value === false) {
    return <Minus className="mx-auto h-4 w-4 text-content-muted/40" aria-label="Not included" />;
  }
  return <span>{value}</span>;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export const PricingPage = memo(function PricingPage() {
  const { ref: revealRef, isVisible, instant } = useRevealOnMount();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const stagger = useCallback(
    (delay: string): React.CSSProperties => ({
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? "none" : "translateY(8px)",
      transition: instant ? "none" : "opacity 0.3s ease-out, transform 0.3s ease-out",
      transitionDelay: instant ? "0s" : delay,
    }),
    [isVisible, instant],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div ref={revealRef} className="mx-auto max-w-6xl px-6 py-16">
        {/* Header */}
        <div style={stagger("0s")} className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-content">Pricing</h1>
          <p className="mt-3 text-base text-content-secondary">
            Start with clarity. Unlock the next stage only when the founder workflow is ready for it.
          </p>
        </div>

        {/* ---- Tier cards ---- */}
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier, i) => (
            <div
              key={tier.name}
              style={stagger(`${0.1 + i * 0.08}s`)}
              className={`relative flex flex-col rounded-2xl border p-6 transition-all duration-300 ${
                tier.highlighted
                  ? "border-[#d97757]/40 bg-[#d97757]/[0.04] shadow-[0_0_32px_rgba(217,119,87,0.08)]"
                  : "border-white/[0.08] bg-white/[0.02]"
              }`}
            >
              {tier.highlighted && "badge" in tier && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#d97757] px-3 py-1 text-[11px] font-semibold text-white shadow-sm">
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    {tier.badge}
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h2 className="text-lg font-semibold text-content">{tier.name}</h2>
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.2em] text-content-muted">
                  {tier.subtitle}
                </p>
                <p className="mt-2 text-[13px] text-content-muted">{tier.description}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold tabular-nums text-content">{tier.price}</span>
                  {tier.period && (
                    <span className="text-sm text-content-muted">{tier.period}</span>
                  )}
                </div>
              </div>

              <ul className="mb-8 flex-1 space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-content-secondary">
                    <Check
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        tier.highlighted ? "text-[#d97757]" : "text-emerald-400"
                      }`}
                      aria-hidden="true"
                    />
                    {feature}
                  </li>
                ))}
              </ul>

              <a
                href={tier.href}
                className={`flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
                  tier.highlighted
                    ? "bg-[#d97757] text-white shadow-lg shadow-[#d97757]/20 hover:bg-[#c96a4d]"
                    : "border border-white/[0.12] text-content hover:bg-white/[0.04]"
                }`}
              >
                {tier.cta}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          ))}
        </div>

        {/* ---- Comparison table ---- */}
        <div style={stagger("0.5s")} className="mt-20">
          <h2 className="text-center text-2xl font-bold text-content">Compare plans</h2>
          <div className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.02]">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="px-5 py-4 text-left text-[11px] uppercase tracking-[0.2em] text-content-muted">
                    Feature
                  </th>
                  {TIER_LABELS.map((label, idx) => (
                    <th
                      key={label}
                      className={`px-5 py-4 text-center text-[11px] uppercase tracking-[0.2em] ${
                        idx === 1 ? "text-[#d97757]" : "text-content-muted"
                      }`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, ri) => (
                  <tr
                    key={row.label}
                    className={ri < COMPARISON.length - 1 ? "border-b border-white/[0.04]" : ""}
                  >
                    <td className="px-5 py-3 text-content-secondary">{row.label}</td>
                    {TIER_KEYS.map((key) => (
                      <td key={key} className="px-5 py-3 text-center text-content-secondary">
                        <ComparisonCell value={row[key]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>

        {/* ---- FAQ ---- */}
        <div style={stagger("0.6s")} className="mt-20">
          <h2 className="text-center text-2xl font-bold text-content">Frequently asked questions</h2>
          <div className="mx-auto mt-8 max-w-2xl space-y-2">
            {FAQ.map((item, i) => (
              <div
                key={i}
                className="rounded-xl border border-white/[0.08] bg-white/[0.02] transition-colors hover:bg-white/[0.03]"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                  aria-expanded={openFaq === i}
                >
                  <span className="text-sm font-medium text-content">{item.q}</span>
                  <span
                    className="ml-4 shrink-0 text-content-muted transition-transform duration-200"
                    style={{ transform: openFaq === i ? "rotate(45deg)" : "rotate(0deg)" }}
                  >
                    +
                  </span>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4 text-sm leading-relaxed text-content-secondary">
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

export default PricingPage;
