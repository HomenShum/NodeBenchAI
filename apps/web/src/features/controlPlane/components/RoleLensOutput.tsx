/**
 * RoleLensOutput — Renders the same packet differently per persona.
 *
 * Founder lens: focus, who matters, warm paths, competitor truth
 * Investor lens: conviction, non-obvious value, customer proof, hidden risks
 * Banker lens: coverage intel, follow-up angle, financing fit, relationship graph
 * Buyer lens: acquirability, business quality, management dependency, integration risk
 * Operator lens: process-poor but fixable, EBITDA upside, playbook fit
 * Student lens: explainability, context, what to read next
 */

import { memo, useMemo, useState, useCallback } from "react";
import {
  Target,
  TrendingUp,
  Building2,
  Shield,
  Wrench,
  GraduationCap,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Users,
  GitCompare,
  Lightbulb,
  HelpCircle,
  Search,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export type RoleLensId =
  | "founder"
  | "investor"
  | "banker"
  | "buyer"
  | "operator"
  | "student";

export interface LensSection {
  title: string;
  icon: typeof Target;
  items: string[];
}

export interface LensOutput {
  lens: RoleLensId;
  headline: string;
  sections: LensSection[];
  nextAction: string;
  watchFor: string;
}

// ─── Lens-specific rendering logic ──────────────────────────────────────────

function buildFounderLens(entityName: string): LensOutput {
  return {
    lens: "founder",
    headline: `Where to focus and who actually matters for ${entityName}`,
    sections: [
      {
        title: "Who Actually Matters",
        icon: Users,
        items: [
          "Decision-makers in the account, fund, or partner ecosystem — not just the loudest names",
          "Warm paths and center-of-influence routes to the real buyer",
          "Who has real distribution vs who just has attention",
        ],
      },
      {
        title: "Competitor Truth",
        icon: GitCompare,
        items: [
          "Real competitor positioning vs vanity positioning",
          "What investors or bankers will actually care about when they look at you",
          "What changed in your market in the last 3-6 months that shifts your wedge",
        ],
      },
      {
        title: "Focus Signal",
        icon: Target,
        items: [
          "Which 2-3 accounts or partners matter most this quarter",
          "What narrative gap you need to close before your next fundraise or deal",
          "Where your product story is weakest and what evidence would fix it",
        ],
      },
    ],
    nextAction:
      "Close the narrative gap: find the 2 pieces of evidence that make your positioning undeniable",
    watchFor:
      "Competitor moves that change your category definition; investor attention shifts",
  };
}

function buildInvestorLens(entityName: string): LensOutput {
  return {
    lens: "investor",
    headline: `Get conviction faster, or kill the deal faster on ${entityName}`,
    sections: [
      {
        title: "Non-Obvious Value",
        icon: Lightbulb,
        items: [
          "What is non-obvious about this market that the deck does not say",
          "Whether the product wedge is real or just narrative",
          "What customer proof exists beyond the deck and testimonials",
        ],
      },
      {
        title: "Hidden Risks",
        icon: AlertTriangle,
        items: [
          "What hidden risks are not obvious in top-line summaries",
          "What recent changes materially alter the thesis",
          "Whether the team is actually exceptional or just well-presented",
        ],
      },
      {
        title: "Conviction Signal",
        icon: TrendingUp,
        items: [
          "Revenue quality: recurring vs one-off, concentration risk",
          "Market timing: is this early or is the window closing",
          "Competitive moat durability: 2-year vs 5-year horizon",
        ],
      },
    ],
    nextAction:
      "Verify the one claim that would change your conviction the most",
    watchFor:
      "Customer churn signals; founder distraction; market timing shifts",
  };
}

function buildBankerLens(entityName: string): LensOutput {
  return {
    lens: "banker",
    headline: `Move from raw contact to usable coverage intelligence fast on ${entityName}`,
    sections: [
      {
        title: "Coverage Intel",
        icon: Building2,
        items: [
          "Real company snapshot in 2-5 minutes: worth follow-up or not",
          "Founder / management quality clues beyond the pitch",
          "Ownership / investor map: who holds real influence",
        ],
      },
      {
        title: "Relationship Graph",
        icon: Users,
        items: [
          "Prospects, clients, investors, and centers of influence connected to this entity",
          "Who inside the company actually influences a transaction",
          "What angle opens the relationship before a formal process",
        ],
      },
      {
        title: "Financing Fit",
        icon: TrendingUp,
        items: [
          "Strategic fit and product maturity: ready for capital markets or still venture-stage",
          "What makes this business financeable or not",
          "Most relevant strategic buyers / sponsors for this profile",
        ],
      },
    ],
    nextAction:
      "Draft the follow-up angle that ties this entity to your coverage thesis",
    watchFor:
      "Financing window timing; management changes; competitive shifts that alter the banking angle",
  };
}

function buildBuyerLens(entityName: string): LensOutput {
  return {
    lens: "buyer",
    headline: `Become dangerous enough to ask the right questions about ${entityName}`,
    sections: [
      {
        title: "Business Quality",
        icon: Shield,
        items: [
          "How to evaluate whether this business is actually good or just well-marketed",
          "What numbers matter and which ones are vanity metrics",
          "Whether growth is real or owner-dependent",
        ],
      },
      {
        title: "Acquirability",
        icon: Target,
        items: [
          "Whether management can stay post-acquisition",
          "Integration risk: sales-led, founder-led, or system-led business",
          "What the real risks of buying this business are that sellers will not mention",
        ],
      },
      {
        title: "Comparable Deals",
        icon: GitCompare,
        items: [
          "What similar businesses sold for and why",
          "Which niches are worth rolling up and which look good but have no operating leverage",
          "Where operational upside actually exists vs where it is just cost-cutting hope",
        ],
      },
    ],
    nextAction:
      "Build the 5-question diligence checklist that separates real opportunity from seller narrative",
    watchFor:
      "Owner dependency signals; customer concentration; hidden liabilities",
  };
}

function buildOperatorLens(entityName: string): LensOutput {
  return {
    lens: "operator",
    headline: `Spot buyable businesses and operational upside fast in ${entityName}`,
    sections: [
      {
        title: "Process-Poor but Fixable",
        icon: Wrench,
        items: [
          "Whether the business is process-poor but fixable (your sweet spot)",
          "Whether the business is sales-led, founder-led, or system-led",
          "Which operator playbook would improve EBITDA vs just create chaos",
        ],
      },
      {
        title: "Roll-Up Logic",
        icon: Building2,
        items: [
          "Fragmented acquisition targets in this niche",
          "Add-on acquisition logic: does this bolt on or does it require integration overhaul",
          "Whether the niche has enough density for a roll-up thesis",
        ],
      },
      {
        title: "EBITDA Upside",
        icon: TrendingUp,
        items: [
          "Where operational upside actually exists (not just cost-cutting hope)",
          "What the current P&L does not show that matters for your thesis",
          "How to diligence without sounding naive to the seller",
        ],
      },
    ],
    nextAction:
      "Map the 3 operational levers that would move EBITDA within 12 months",
    watchFor:
      "Founder burnout signals; industry consolidation moves; regulatory changes that affect the niche",
  };
}

function buildStudentLens(entityName: string): LensOutput {
  return {
    lens: "student",
    headline: `Understand ${entityName} from first principles — what to read, what to question, what matters`,
    sections: [
      {
        title: "Context Primer",
        icon: BookOpen,
        items: [
          "What this company actually does in plain language",
          "Why this company matters in its industry",
          "What the key terms and jargon mean in this space",
        ],
      },
      {
        title: "What to Question",
        icon: HelpCircle,
        items: [
          "What assumptions the company's story relies on",
          "Where the narrative might not match reality",
          "What experienced people in this space would ask that newcomers would not",
        ],
      },
      {
        title: "What to Read Next",
        icon: GraduationCap,
        items: [
          "The 3-5 most important sources to understand this space deeply",
          "How this company compares to its real competitors (not just the famous ones)",
          "What career paths exist in this industry and what skills matter",
        ],
      },
    ],
    nextAction:
      "Read the top source, then come back and ask one specific follow-up question",
    watchFor:
      "Industry shifts that change the fundamentals; new entrants that redefine the category",
  };
}

// ─── Builder map ────────────────────────────────────────────────────────────

const LENS_BUILDERS: Record<
  RoleLensId,
  (entityName: string) => LensOutput
> = {
  founder: buildFounderLens,
  investor: buildInvestorLens,
  banker: buildBankerLens,
  buyer: buildBuyerLens,
  operator: buildOperatorLens,
  student: buildStudentLens,
};

const LENS_META: Record<
  RoleLensId,
  { label: string; icon: typeof Target; color: string }
> = {
  founder: { label: "Founder", icon: Target, color: "text-blue-400" },
  investor: { label: "Investor", icon: TrendingUp, color: "text-emerald-400" },
  banker: { label: "Banker", icon: Building2, color: "text-amber-400" },
  buyer: { label: "Buyer", icon: Shield, color: "text-purple-400" },
  operator: { label: "Operator", icon: Wrench, color: "text-orange-400" },
  student: { label: "Student", icon: GraduationCap, color: "text-cyan-400" },
};

// ─── Component ──────────────────────────────────────────────────────────────

interface RoleLensOutputProps {
  lens?: RoleLensId;
  entityName?: string;
}

function RoleLensOutputInner({ lens: lensProp, entityName: entityNameProp }: RoleLensOutputProps) {
  const [internalLens, setInternalLens] = useState<RoleLensId>("investor");
  const [internalEntityName, setInternalEntityName] = useState("Anthropic AI");
  const lens = lensProp ?? internalLens;
  const entityName = entityNameProp ?? internalEntityName;
  const output = useMemo(
    () => LENS_BUILDERS[lens](entityName || "this entity"),
    [lens, entityName],
  );
  const meta = LENS_META[lens];

  const handleLensChange = useCallback((newLens: RoleLensId) => {
    setInternalLens(newLens);
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      {/* Header with lens selector */}
      <div className="flex items-center gap-3">
        <Target className="h-5 w-5 text-accent-primary" />
        <div>
          <h1 className="text-lg font-semibold text-content">Role Lens Output</h1>
          <p className="text-xs text-content-muted">
            Same packet, different persona — what each role actually needs to see
          </p>
        </div>
      </div>

      {/* Entity input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" />
        <input
          type="text"
          value={entityName}
          onChange={(e) => setInternalEntityName(e.target.value)}
          placeholder="Enter company or entity name..."
          aria-label="Enter company or entity name"
          className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] pl-9 pr-3 py-2 text-sm text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>

      {/* Lens selector */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.entries(LENS_META) as [RoleLensId, typeof meta][]).map(([id, m]) => (
          <button
            key={id}
            type="button"
            onClick={() => handleLensChange(id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              lens === id
                ? `bg-accent-primary/15 ${m.color}`
                : "border border-white/[0.06] text-content-muted hover:bg-white/[0.04] hover:text-content"
            }`}
            aria-pressed={lens === id}
          >
            <m.icon className="h-3.5 w-3.5" />
            {m.label}
          </button>
        ))}
      </div>

    <div className="space-y-4">
      {/* Lens header */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 mb-2">
          <meta.icon className={`h-4 w-4 ${meta.color}`} />
          <span
            className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${meta.color}`}
          >
            {meta.label} Lens
          </span>
        </div>
        <p className="text-sm font-medium text-content">{output.headline}</p>
      </div>

      {/* Sections */}
      {output.sections.map((section) => (
        <section
          key={section.title}
          className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <section.icon className="h-4 w-4 text-content-muted" />
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
              {section.title}
            </h3>
          </div>
          <ul className="space-y-2.5">
            {section.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-content">
                <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400/60" />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Next action */}
      <div className="rounded-xl border border-accent-primary/15 bg-accent-primary/[0.04] p-4">
        <div className="flex items-center gap-2 mb-2">
          <ArrowRight className="h-4 w-4 text-accent-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
            Next Action
          </span>
        </div>
        <p className="text-sm leading-relaxed text-content">
          {output.nextAction}
        </p>
      </div>

      {/* Watch for */}
      <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400">
            Watch For
          </span>
        </div>
        <p className="text-sm leading-relaxed text-content">
          {output.watchFor}
        </p>
      </div>
    </div>
    </div>
  );
}

export const RoleLensOutput = memo(RoleLensOutputInner);
export default RoleLensOutput;
