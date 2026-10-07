/**
 * LandingScroll — 7-section scrollable marketing/proof page below the search hero.
 *
 * Rendered when `conversation.length === 0 && !isSearching` inside ControlPlaneLanding.
 * Each section fades in on scroll via IntersectionObserver (respects prefers-reduced-motion).
 *
 * Design DNA:
 *   - Glass cards: border-white/[0.06] bg-white/[0.02]
 *   - Terracotta accent: #d97757
 *   - Section headers: text-[11px] font-semibold uppercase tracking-[0.16em]
 *   - Max content width: max-w-3xl centered
 */

import { memo, useCallback, useEffect, useRef } from "react";
import {
  Briefcase,
  Check,
  Database,
  FileText,
  GraduationCap,
  Landmark,
  Minus,
  Scale,
  Search,
  Sparkles,
  Terminal,
  User,
} from "lucide-react";

/* ─── helpers ──────────────────────────────────────────────────────────── */

function SectionBadge({ n }: { n: number }) {
  return (
    <span className="text-[11px] font-mono text-[#d97757]/70 tracking-widest">
      [{n}/8]
    </span>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-content-muted">
      {children}
    </p>
  );
}

/* ─── Scroll-reveal hook ───────────────────────────────────────────────── */

function useScrollReveal() {
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  const setRef = useCallback((index: number) => (el: HTMLElement | null) => {
    sectionRefs.current[index] = el;
  }, []);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (prefersReducedMotion) {
      // Show all sections immediately
      sectionRefs.current.forEach((el) => {
        if (el) el.style.opacity = "1";
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            el.style.transition = "opacity 0.6s ease, transform 0.6s ease";
            el.style.opacity = "1";
            el.style.transform = "translateY(0)";
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    sectionRefs.current.forEach((el) => {
      if (el) {
        el.style.opacity = "0";
        el.style.transform = "translateY(24px)";
        observer.observe(el);
      }
    });

    return () => observer.disconnect();
  }, []);

  return setRef;
}

/* ─── Section 2: Product in One Screen ─────────────────────────────────── */

function ProductShowcase() {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
      {/* Entity header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
            <Sparkles className="h-5 w-5 text-[#d97757]" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Anthropic</h3>
            <p className="text-xs text-content-muted">AI safety company &middot; San Francisco, CA</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
          <Check className="h-3 w-3" /> 92% confidence
        </span>
      </div>

      {/* Signals */}
      <div className="mt-4 space-y-2.5">
        {[
          "Series E at $60B valuation — largest private AI round in 2025",
          "Claude model family dominance in enterprise coding and research",
          "Enterprise API revenue growing 3x year-over-year",
        ].map((signal, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 rounded-lg border border-white/[0.04] bg-white/[0.015] px-3 py-2.5"
          >
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d97757]" />
            <span className="text-sm leading-relaxed text-content">{signal}</span>
          </div>
        ))}
      </div>

      {/* Footer badges */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[11px] text-content-muted">
          <Database className="h-3 w-3" /> 18 sources
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-[#d97757]/30 bg-[#d97757]/10 px-2 py-0.5 text-[11px] font-medium text-[#d97757]">
          Investor lens
        </span>
      </div>
    </div>
  );
}

/* ─── Section 3: 6 Role Lenses ─────────────────────────────────────────── */

const LENSES: {
  icon: typeof Sparkles;
  name: string;
  desc: string;
  example: string;
}[] = [
  {
    icon: Sparkles,
    name: "Founder",
    desc: "Competitive positioning, market gaps, strategic moves",
    example: '"Anthropic is moving upmarket — enterprise API pricing signals B2B focus."',
  },
  {
    icon: Briefcase,
    name: "Investor",
    desc: "Valuation signals, funding velocity, risk factors",
    example: '"Series E at $60B implies 15x revenue multiple — aggressive for current ARR."',
  },
  {
    icon: Landmark,
    name: "Banker",
    desc: "Deal structure, comparable transactions, capital flows",
    example: '"Google\'s $2B convertible note creates preferential liquidation dynamics."',
  },
  {
    icon: User,
    name: "Operator",
    desc: "Integration points, vendor risk, operational dependencies",
    example: '"API rate limits and model deprecation cycles require quarterly migration planning."',
  },
  {
    icon: Scale,
    name: "Legal",
    desc: "Regulatory exposure, IP risk, compliance gaps",
    example: '"EU AI Act compliance gap — no published conformity assessment for Claude 3.5."',
  },
  {
    icon: GraduationCap,
    name: "Researcher",
    desc: "Technical architecture, research trajectory, citation network",
    example: '"Constitutional AI paper cited 2,400 times — signals paradigm-level influence."',
  },
];

function RoleLensGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {LENSES.map((lens) => {
        const Icon = lens.icon;
        return (
          <div
            key={lens.name}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                <Icon className="h-4 w-4 text-[#d97757]" />
              </div>
              <span className="text-sm font-semibold text-white">{lens.name}</span>
            </div>
            <p className="text-[13px] leading-snug text-content-muted">{lens.desc}</p>
            <p className="mt-2 text-[12px] italic leading-snug text-content-muted/70">
              {lens.example}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Section 4: How It Works ──────────────────────────────────────────── */

const STEPS: { icon: typeof Search; title: string; desc: string }[] = [
  {
    icon: Search,
    title: "Search",
    desc: "Type any company, market, or question",
  },
  {
    icon: Database,
    title: "Enrich",
    desc: "18+ sources searched, structured intelligence extracted",
  },
  {
    icon: FileText,
    title: "Decide",
    desc: "Role-shaped insights with citations you can verify",
  },
];

function HowItWorks() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        return (
          <div key={step.title} className="flex flex-col items-center text-center">
            <div className="relative mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
              <Icon className="h-6 w-6 text-[#d97757]" />
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d97757] text-[10px] font-bold text-white">
                {i + 1}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white">{step.title}</h3>
            <p className="mt-1 text-[13px] leading-snug text-content-muted">{step.desc}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Section 5: Comparison Table ──────────────────────────────────────── */

const COMPARISON_ROWS: { feature: string; chatgpt: boolean; perplexity: boolean; nodebench: boolean }[] = [
  { feature: "Entity-specific intelligence", chatgpt: false, perplexity: false, nodebench: true },
  { feature: "Role-shaped output (6 lenses)", chatgpt: false, perplexity: false, nodebench: true },
  { feature: "Source citations with URLs", chatgpt: false, perplexity: true, nodebench: true },
  { feature: "350 MCP tools", chatgpt: false, perplexity: false, nodebench: true },
  { feature: "Local-first, no data leaves your machine", chatgpt: false, perplexity: false, nodebench: true },
  { feature: "Structured signals, not paragraphs", chatgpt: false, perplexity: false, nodebench: true },
];

function ComparisonTable() {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <table className="w-full text-left text-sm" role="table">
        <thead>
          <tr className="border-b border-white/[0.06]">
            <th className="px-4 py-3 text-[12px] font-semibold text-content-muted" scope="col">Feature</th>
            <th className="px-4 py-3 text-center text-[12px] font-semibold text-content-muted" scope="col">ChatGPT</th>
            <th className="px-4 py-3 text-center text-[12px] font-semibold text-content-muted" scope="col">Perplexity</th>
            <th className="px-4 py-3 text-center text-[12px] font-semibold text-content-muted" scope="col">NodeBench</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row, i) => (
            <tr
              key={row.feature}
              className={i < COMPARISON_ROWS.length - 1 ? "border-b border-white/[0.04]" : ""}
            >
              <td className="px-4 py-3 text-[13px] text-content">{row.feature}</td>
              <td className="px-4 py-3 text-center">
                {row.chatgpt ? (
                  <Check className="mx-auto h-4 w-4 text-[#d97757]" aria-label="Yes" />
                ) : (
                  <Minus className="mx-auto h-4 w-4 text-content-muted/40" aria-label="No" />
                )}
              </td>
              <td className="px-4 py-3 text-center">
                {row.perplexity ? (
                  <Check className="mx-auto h-4 w-4 text-[#d97757]" aria-label="Yes" />
                ) : (
                  <Minus className="mx-auto h-4 w-4 text-content-muted/40" aria-label="No" />
                )}
              </td>
              <td className="px-4 py-3 text-center">
                {row.nodebench ? (
                  <Check className="mx-auto h-4 w-4 text-[#d97757]" aria-label="Yes" />
                ) : (
                  <Minus className="mx-auto h-4 w-4 text-content-muted/40" aria-label="No" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Section 6: Real Metrics ──────────────────────────────────────────── */

const STATS: { value: string; label: string }[] = [
  { value: "350", label: "MCP tools across 50 domains" },
  { value: "1,510", label: "tests passing" },
  { value: "103", label: "eval queries in quality corpus" },
  { value: "6", label: "role lenses for context-shaped output" },
];

function MetricsGrid() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {STATS.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center"
        >
          <div className="text-3xl font-bold text-[#d97757]">{stat.value}</div>
          <p className="mt-1 text-[12px] leading-snug text-content-muted">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── Section 7: Who It's For ──────────────────────────────────────────── */

const PERSONAS: { title: string; desc: string }[] = [
  {
    title: "Founder doing diligence",
    desc: "Stop Googling competitors. Get structured competitive intelligence with signals your investors will actually read.",
  },
  {
    title: "Investor screening deals",
    desc: "Run the same diligence checklist on every deal. See what's missing before the partner meeting.",
  },
  {
    title: "Operator monitoring market",
    desc: "Weekly market intelligence without the analyst. Know what changed, what matters, and what to do.",
  },
];

function PersonaCards() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {PERSONAS.map((persona) => (
        <div
          key={persona.title}
          className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5"
        >
          <h3 className="text-sm font-semibold text-white">{persona.title}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-content-muted">{persona.desc}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── Section 8: Get Started ───────────────────────────────────────────── */

function GetStarted({ onScrollToTop }: { onScrollToTop: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6">
      {/* Primary CTA */}
      <button
        type="button"
        onClick={onScrollToTop}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[#d97757] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#d97757]/20 transition-all hover:bg-[#c0654a] hover:shadow-[#d97757]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757] focus-visible:ring-offset-2 focus-visible:ring-offset-[#151413]"
        aria-label="Scroll to search input"
      >
        <Search className="h-4 w-4" />
        Start searching
      </button>

      {/* Install command */}
      <div className="w-full max-w-lg rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-content-muted">
          Or install as MCP server
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-black/30 px-3 py-2.5">
          <Terminal className="h-4 w-4 shrink-0 text-content-muted" />
          <code className="flex-1 overflow-x-auto text-[12px] text-content">
            claude mcp add nodebench -- npx -y nodebench-mcp --preset founder
          </code>
        </div>
      </div>

      {/* Link badges */}
      <div className="flex items-center gap-3">
        <a
          href="https://github.com/nodebench/nodebench-mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12px] text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]"
          aria-label="View NodeBench on GitHub"
        >
          GitHub
        </a>
        <a
          href="https://www.npmjs.com/package/nodebench-mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12px] text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]"
          aria-label="View NodeBench on npm"
        >
          npm
        </a>
      </div>
    </div>
  );
}

/* ─── Main Component ───────────────────────────────────────────────────── */

interface LandingScrollProps {
  /** Ref to the search input — used by "Start searching" CTA to scroll + focus */
  searchInputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
}

export const LandingScroll = memo(function LandingScroll({ searchInputRef }: LandingScrollProps) {
  const setRef = useScrollReveal();

  const handleScrollToTop = useCallback(() => {
    if (searchInputRef?.current) {
      searchInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      // Small delay so scroll completes before focus
      setTimeout(() => searchInputRef.current?.focus(), 400);
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [searchInputRef]);

  const sections: {
    n: number;
    header: string;
    heading: string;
    content: React.ReactNode;
  }[] = [
    {
      n: 2,
      header: "Product in one screen",
      heading: "Entity intelligence in one search",
      content: <ProductShowcase />,
    },
    {
      n: 3,
      header: "Role lenses",
      heading: "Six lenses. Same company. Different intelligence.",
      content: <RoleLensGrid />,
    },
    {
      n: 4,
      header: "How it works",
      heading: "Search. Enrich. Decide.",
      content: <HowItWorks />,
    },
    {
      n: 5,
      header: "Comparison",
      heading: "Not another chatbot.",
      content: <ComparisonTable />,
    },
    {
      n: 6,
      header: "Real metrics",
      heading: "Built and measured, not just shipped.",
      content: <MetricsGrid />,
    },
    {
      n: 7,
      header: "Who it's for",
      heading: "Built for people who need answers, not articles.",
      content: <PersonaCards />,
    },
    {
      n: 8,
      header: "Get started",
      heading: "Start searching. No account needed.",
      content: <GetStarted onScrollToTop={handleScrollToTop} />,
    },
  ];

  return (
    <div className="mt-16 sm:mt-24" role="region" aria-label="Product overview">
      {sections.map((section, i) => (
        <section
          key={section.n}
          ref={setRef(i)}
          className="py-16 sm:py-24"
          aria-labelledby={`landing-section-${section.n}`}
        >
          <div className="mx-auto max-w-3xl px-4">
            <div className="mb-6 flex items-center gap-3">
              <SectionBadge n={section.n} />
              <SectionHeader>{section.header}</SectionHeader>
            </div>
            <h2
              id={`landing-section-${section.n}`}
              className="mb-8 text-2xl font-bold text-white sm:text-3xl"
            >
              {section.heading}
            </h2>
            {section.content}
          </div>
        </section>
      ))}
    </div>
  );
});
