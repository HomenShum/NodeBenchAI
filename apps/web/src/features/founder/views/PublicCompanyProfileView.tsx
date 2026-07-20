/**
 * PublicCompanyProfileView — Public company intelligence page at /company/:slug
 *
 * Unauthenticated, no cockpit chrome, print-ready, shareable.
 * Follows the ShareableMemoView pattern exactly.
 *
 * Data source: localStorage company data + Convex (when available) + demo fallback.
 * OG tags injected dynamically for social sharing.
 */

import { memo, useEffect, useMemo, useState, useCallback } from "react";
// slug parsed from window.location.pathname (rendered outside React Router)
import {
  Building2,
  Copy,
  Check,
  ExternalLink,
  Globe,
  Linkedin,
  Printer,
  Share2,
  Sparkles,
  Target,
  TrendingUp,
  AlertTriangle,
  Shield,
  Users,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────

interface CompanyProfileData {
  slug: string;
  name: string;
  mission: string;
  wedge: string;
  companyState: string;
  identityConfidence: number;
  signals: Array<{
    title: string;
    content: string;
    sourceType: string;
    importance: number;
  }>;
  risks: string[];
  comparables: Array<{
    name: string;
    relationship: string;
    description: string;
  }>;
  decisions: Array<{
    title: string;
    status: string;
    rationale: string;
  }>;
  updatedAt: string;
}

// ── Demo Company ─────────────────────────────────────────────────────────

const DEMO_COMPANY: CompanyProfileData = {
  slug: "demo",
  name: "NodeBench",
  mission: "Operating intelligence for agent-native businesses",
  wedge: "Entity intelligence + causal memory + decision packets — the layer above raw memory infrastructure",
  companyState: "operating",
  identityConfidence: 0.88,
  signals: [
    { title: "MCP adoption accelerating", content: "304 tools across 59 domains, hackathon + delta presets shipped", sourceType: "product", importance: 0.9 },
    { title: "Competitor landscape shifting", content: "Supermemory raised $3M for universal memory substrate. NodeBench positioned above as operating intelligence layer.", sourceType: "market", importance: 0.85 },
    { title: "Search-first entry validated", content: "The Home intake and role-lens entry flow continue to show strong engagement patterns.", sourceType: "product", importance: 0.8 },
    { title: "Distribution layer launching", content: "Public company profiles, shareable memos, embeddable widgets in development", sourceType: "product", importance: 0.75 },
  ],
  risks: [
    "Memory substrate becoming table stakes — need to differentiate on causal intelligence",
    "Live data pipeline not yet production-ready — demo fixtures still primary",
    "Distribution layer early — shareable artifacts need OG images and analytics",
  ],
  comparables: [
    { name: "Supermemory", relationship: "Adjacent — memory substrate", description: "Universal memory with MCP connectors. We sit above as the intelligence layer." },
    { name: "Perplexity", relationship: "Adjacent — search", description: "General search + synthesis. We own entity-specific deep analysis." },
    { name: "PitchBook", relationship: "Competitor — financial data", description: "Deep financial data coverage. We own MCP-native + real-time intelligence." },
  ],
  decisions: [
    { title: "Position above memory, not as memory", status: "accepted", rationale: "Memory is commoditizing. Operating intelligence is the durable moat." },
    { title: "Hackathon-first distribution strategy", status: "accepted", rationale: "Hackathon teams have urgency + willingness to try new tools. Pairs with retention.sh." },
  ],
  updatedAt: new Date().toISOString(),
};

// ── OG Meta Tags ─────────────────────────────────────────────────────────

function CompanyMetaTags({ company }: { company: CompanyProfileData }) {
  useEffect(() => {
    const setMeta = (property: string, content: string) => {
      let tag = document.querySelector(`meta[property="${property}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("property", property);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };

    const title = `${company.name} — Company Intelligence | NodeBench`;
    document.title = title;
    setMeta("og:title", title);
    setMeta("og:description", company.mission);
    setMeta("og:type", "profile");
    setMeta("og:url", window.location.href);
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", title);
    setMeta("twitter:description", company.wedge);
  }, [company]);

  return null;
}

// ── Share Bar ────────────────────────────────────────────────────────────

function ShareBar({ company }: { company: CompanyProfileData }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = window.location.href;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const tweetText = `${company.name}: ${company.mission} — via @nodebenchai`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(window.location.href)}`;
  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.href)}`;

  return (
    <div className="company-profile-no-print flex items-center gap-2">
      <button
        onClick={handleCopy}
        aria-label="Copy link to clipboard"
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/50 transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-accent-primary"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied!" : "Copy link"}
      </button>
      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on Twitter"
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/50 transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-accent-primary"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Twitter
      </a>
      <a
        href={linkedinUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on LinkedIn"
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/50 transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-accent-primary"
      >
        <Linkedin className="h-3.5 w-3.5" />
        LinkedIn
      </a>
      <button
        onClick={() => window.print()}
        aria-label="Print company profile"
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/50 transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-accent-primary"
      >
        <Printer className="h-3.5 w-3.5" />
        Print
      </button>
    </div>
  );
}

// ── Confidence Badge ─────────────────────────────────────────────────────

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "text-emerald-400 bg-emerald-500/10" :
    pct >= 60 ? "text-cyan-400 bg-cyan-500/10" :
    pct >= 40 ? "text-amber-400 bg-amber-500/10" :
    "text-red-400 bg-red-500/10";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] tabular-nums font-medium", color)}>
      {pct}% confidence
    </span>
  );
}

// ── Main View ────────────────────────────────────────────────────────────

function PublicCompanyProfileViewInner() {
  // Parse slug from pathname directly since we're outside React Router's <Route>
  const slug = useMemo(() => {
    const path = window.location.pathname.replace(/^\/company\//, "").replace(/\/$/, "");
    return path || "demo";
  }, []);

  // Load company from localStorage or use demo
  const company = useMemo(() => {
    if (slug === "demo" || !slug) return DEMO_COMPANY;

    // Try localStorage
    try {
      const stored = localStorage.getItem("nodebench-company-profiles");
      if (stored) {
        const profiles = JSON.parse(stored) as Record<string, CompanyProfileData>;
        if (profiles[slug]) return profiles[slug];
      }
    } catch { /* fallback to demo */ }

    // Check if we have company data from analysis
    try {
      const analysisCompany = localStorage.getItem("nodebench-analysis-company");
      if (analysisCompany) {
        const parsed = JSON.parse(analysisCompany);
        if (parsed.name?.toLowerCase().replace(/\s+/g, "-") === slug) {
          return {
            ...DEMO_COMPANY,
            slug,
            name: parsed.name || slug,
            mission: parsed.mission || DEMO_COMPANY.mission,
            wedge: parsed.wedge || DEMO_COMPANY.wedge,
          };
        }
      }
    } catch { /* fallback */ }

    return { ...DEMO_COMPANY, slug: slug || "demo", name: slug?.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Demo Company" };
  }, [slug]);

  if (!company) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#151413] text-white">
        <div className="text-center">
          <Building2 className="mx-auto h-12 w-12 text-white/20" />
          <h1 className="mt-4 text-lg font-medium">Company not found</h1>
          <a href="/" className="mt-2 inline-block text-accent-primary hover:underline">Go to NodeBench</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#151413] text-white">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-accent-primary focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <CompanyMetaTags company={company} />

      {/* Header */}
      <header className="border-b border-white/[0.08] px-6 py-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/10">
                  <Building2 className="h-5 w-5 text-accent-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold">{company.name}</h1>
                  <p className="text-xs text-white/40">{company.mission}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[10px] capitalize text-white/50">
                  {company.companyState}
                </span>
                <ConfidenceBadge value={company.identityConfidence} />
              </div>
            </div>
            <ShareBar company={company} />
          </div>

          {/* Wedge */}
          <div className="mt-4 rounded-lg border border-accent-primary/20 bg-accent-primary/[0.04] p-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-accent-primary" />
              <span className="text-[11px] uppercase tracking-[0.2em] text-accent-primary/60">Core Focus</span>
            </div>
            <p className="mt-2 text-sm text-white/60">{company.wedge}</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main id="main-content" className="px-6 py-6" tabIndex={-1}>
        <div className="mx-auto max-w-3xl space-y-6">

          {/* Signals */}
          <section>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent-primary" />
              <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/40">Key Signals</h2>
              <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] tabular-nums text-accent-primary">
                {company.signals.length}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {company.signals.map((s, i) => (
                <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                  <div className="flex items-start justify-between">
                    <h3 className="text-xs font-medium text-white/70">{s.title}</h3>
                    <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] tabular-nums text-white/35">
                      {Math.round(s.importance * 100)}%
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/40">{s.content}</p>
                  <span className="mt-2 inline-block rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] capitalize text-white/25">
                    {s.sourceType}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Risks */}
          {company.risks.length > 0 && (
            <section>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-red-400" />
                <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/40">Risks</h2>
              </div>
              <div className="mt-3 space-y-2">
                {company.risks.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg border border-red-500/10 bg-red-500/[0.02] p-3">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400/60" />
                    <p className="text-[11px] text-white/50">{r}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Comparables */}
          {company.comparables.length > 0 && (
            <section>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-400" />
                <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/40">Competitive Landscape</h2>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {company.comparables.map((c, i) => (
                  <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <h3 className="text-xs font-medium text-white/70">{c.name}</h3>
                    <span className="mt-1 inline-block rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] text-blue-400">
                      {c.relationship}
                    </span>
                    <p className="mt-2 text-[10px] leading-relaxed text-white/35">{c.description}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Decisions */}
          {company.decisions.length > 0 && (
            <section>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
                <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/40">Recent Decisions</h2>
              </div>
              <div className="mt-3 space-y-2">
                {company.decisions.map((d, i) => (
                  <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-medium text-white/70">{d.title}</h3>
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                        d.status === "accepted" ? "bg-emerald-500/10 text-emerald-400" :
                        d.status === "rejected" ? "bg-red-500/10 text-red-400" :
                        "bg-amber-500/10 text-amber-400",
                      )}>
                        {d.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-white/40">{d.rationale}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="company-profile-no-print border-t border-white/[0.08] px-6 py-6">
        <div className="mx-auto max-w-3xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent-primary" />
            <span className="text-[11px] text-white/30">Powered by <a href="https://nodebenchai.com" className="text-accent-primary hover:underline">NodeBench Delta</a></span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://nodebenchai.com"
              className="flex items-center gap-1.5 rounded-lg bg-accent-primary/10 px-3 py-1.5 text-[11px] text-accent-primary transition-colors hover:bg-accent-primary/20"
            >
              Try NodeBench <ArrowRight className="h-3 w-3" />
            </a>
            <span className="text-[9px] text-white/20">
              Updated {new Date(company.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </footer>

      {/* Print styles */}
      <style>{`
        @media print {
          .company-profile-no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          * { color: black !important; border-color: #ddd !important; background: white !important; }
        }
      `}</style>
    </div>
  );
}

const PublicCompanyProfileView = memo(PublicCompanyProfileViewInner);
export default PublicCompanyProfileView;
