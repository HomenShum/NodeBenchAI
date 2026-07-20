/**
 * AboutPage — Public /about page for SEO, trust, and discoverability.
 * Addresses the remediation gap: "No public /about page with founder bio."
 */

import { memo } from "react";
import { ArrowRight, Github, Globe, Package, Shield, Users, Zap } from "lucide-react";
// MCP package version displayed on the About page. Update when publishing a new release.
const mcpVersion = "3.1.5";
import { buildCockpitPath } from "@/lib/registry/viewRegistry";

export const AboutPage = memo(function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 lg:py-16">
      {/* Hero */}
      <h1 className="text-3xl font-bold tracking-tight text-content sm:text-4xl">
        About <span className="text-[#d97757]">NodeBench AI</span>
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-content-secondary">
        Entity intelligence for founders, investors, and bankers.
        Search any company and get a banker-grade diligence packet with people,
        timeline, financials, competitive landscape, and risk flags — shaped for your role.
      </p>

      {/* What NodeBench Does */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold text-content">What NodeBench AI Does</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card
            icon={Zap}
            title="Deep Diligence"
            body="6 parallel research branches chain up to 3 levels deep. People, timeline, financials, market, products, risks — all in 60-90 seconds."
          />
          <Card
            icon={Shield}
            title="Gap Remediation"
            body="Every risk comes with actionable steps, effort estimates, and expected outcomes. Not just diagnosis — prescription."
          />
          <Card
            icon={Users}
            title="6 Role Lenses"
            body="Same company, different perspective. Founder, investor, banker, CEO, legal, or student — each lens shapes the intelligence differently."
          />
          <Card
            icon={Package}
            title="350+ MCP Tools"
            body="Connect via Claude Code, Cursor, or Windsurf. Progressive discovery starts with 15 tools and expands as needed."
          />
        </div>
      </section>

      {/* Founder */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold text-content">Founder</h2>
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#d97757]/10 text-xl font-bold text-[#d97757]">
              HS
            </div>
            <div>
              <div className="text-lg font-semibold text-content">Homen Shum</div>
              <div className="text-sm text-content-secondary">Founder & CEO</div>
              <p className="mt-2 text-sm leading-relaxed text-content-muted">
                Builder-analyst hybrid with a background in banking and finance (middle market,
                business banking) combined with data engineering and agentic AI.
                Previously built financial data pipelines and analytics systems.
                NodeBench started from the insight that VCs, accelerators, and banks
                judge startups on hidden criteria they never share — and that AI agents
                need structured company truth to make good decisions.
              </p>
              <div className="mt-3 flex gap-3">
                <a
                  href="https://github.com/HomenShum"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-content-muted transition-colors hover:text-content-secondary"
                >
                  <Github className="h-3.5 w-3.5" />
                  GitHub
                </a>
                <a
                  href="https://www.linkedin.com/in/homenshum/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-content-muted transition-colors hover:text-content-secondary"
                >
                  <Users className="h-3.5 w-3.5" />
                  LinkedIn
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Technology */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold text-content">Technology</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <TechRow label="Frontend" value="React + Vite + TypeScript + Tailwind CSS" />
          <TechRow label="Backend" value="Convex (realtime DB + durable workflows)" />
          <TechRow label="Search" value="Linkup API + Gemini 3.1 extraction" />
          <TechRow label="MCP Server" value="Node.js + TypeScript + SQLite (350+ tools)" />
          <TechRow label="Hosting" value="Vercel (frontend) + Convex Cloud (backend)" />
          <TechRow label="Package" value={`npm: nodebench-mcp (v${mcpVersion})`} />
        </div>
      </section>

      {/* Quick Start */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold text-content">Get Started</h2>
        <div className="mt-4 space-y-3">
          <StartOption
            label="Web App"
            description="Search any company right now"
            action="nodebenchai.com"
            href={`https://www.nodebenchai.com${buildCockpitPath({ surfaceId: "ask" })}`}
          />
          <StartOption
            label="Claude Code"
            description="One command to connect"
            action="claude mcp add nodebench -- npx -y nodebench-mcp --preset founder"
            code
          />
          <StartOption
            label="npm"
            description="Install globally"
            action="npm install -g nodebench-mcp"
            code
          />
        </div>
      </section>

      {/* Links */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold text-content">Links</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <ExtLink href="https://www.nodebenchai.com" icon={Globe} label="Website" />
          <ExtLink href="https://github.com/HomenShum/nodebench-ai" icon={Github} label="GitHub" />
          <ExtLink href="https://www.npmjs.com/package/nodebench-mcp" icon={Package} label="npm" />
        </div>
      </section>

      {/* Company Details */}
      <section className="mt-12 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-xs text-content-muted">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em]">Company Details</div>
        <div className="mt-2 space-y-1">
          <div>NodeBench, Inc. — Delaware C-Corp (active)</div>
          <div>Founded: 2024 | Headquarters: San Jose, CA</div>
          <div>Stage: Pre-revenue, bootstrapped</div>
          <div>Contact: via GitHub Issues or LinkedIn</div>
        </div>
      </section>
    </div>
  );
});

function Card({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <Icon className="h-5 w-5 text-[#d97757]" />
      <div className="mt-2 text-sm font-semibold text-content">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-content-muted">{body}</p>
    </div>
  );
}

function TechRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">{label}</div>
      <div className="mt-0.5 text-xs text-content-secondary">{value}</div>
    </div>
  );
}

function StartOption({ label, description, action, href, code }: {
  label: string; description: string; action: string; href?: string; code?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-content">{label}</div>
          <div className="text-xs text-content-muted">{description}</div>
        </div>
        {href && (
          <a
            href={href}
            className="inline-flex items-center gap-1 rounded-lg bg-[#d97757] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#c4603f]"
          >
            Open <ArrowRight className="h-3 w-3" />
          </a>
        )}
      </div>
      {code && (
        <pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] text-content-secondary">
          {action}
        </pre>
      )}
    </div>
  );
}

function ExtLink({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-xs font-medium text-content-secondary transition-colors hover:border-white/[0.12] hover:text-content"
    >
      <Icon className="h-4 w-4" />
      {label}
    </a>
  );
}

export default AboutPage;
