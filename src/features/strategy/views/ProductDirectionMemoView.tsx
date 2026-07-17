import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  BrainCircuit,
  BriefcaseBusiness,
  FileJson2,
  Flag,
  Layers3,
  Lightbulb,
  ShieldAlert,
} from "lucide-react";

import { LazyCodeBlock } from "@/shared/components/LazyCodeBlock";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ai-ui/tabs";
import { cn } from "@/lib/utils";
import { SourceChip } from "@/shared/ui";

import { TESTS_ASSURED_PRODUCT_DIRECTION } from "../data/testsAssuredProductDirection";
import {
  IN_HOUSE_PRODUCT_DIRECTION_JSON_SCHEMA,
  type InHouseProductDirection,
} from "../types/inHouseProductDirection";

type MemoTab = "executive" | "evidence" | "options" | "plan" | "narrative" | "json";

const TABS: Array<{ id: MemoTab; label: string }> = [
  { id: "executive", label: "Executive Answer" },
  { id: "evidence", label: "Evidence" },
  { id: "options", label: "Product Options" },
  { id: "plan", label: "Build Plan" },
  { id: "narrative", label: "Narrative" },
  { id: "json", label: "JSON Contract" },
];

function ConfidenceBadge({ value }: { value: InHouseProductDirection["meta"]["confidence_level"] }) {
  const tone =
    value === "high"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
      : value === "medium"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300"
        : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300";
  return (
    <span className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide", tone)}>
      {value} confidence
    </span>
  );
}

function SourceChips({ sourceRefs }: { sourceRefs?: Array<{ label: string; url?: string }> }) {
  if (!sourceRefs?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {sourceRefs.map((source) => (
        <SourceChip
          key={`${source.label}-${source.url ?? "local"}`}
          label={source.label}
          href={source.url}
        />
      ))}
    </div>
  );
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-edge bg-surface-secondary p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-content">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-content-secondary">
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProductDirectionMemoView() {
  const [activeTab, setActiveTab] = useState<MemoTab>("executive");
  const analysis = TESTS_ASSURED_PRODUCT_DIRECTION;

  const formattedJson = useMemo(() => JSON.stringify(analysis, null, 2), [analysis]);
  const schemaJson = useMemo(() => JSON.stringify(IN_HOUSE_PRODUCT_DIRECTION_JSON_SCHEMA, null, 2), []);

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-6 px-6 py-8" data-testid="product-direction-memo">
      <header className="rounded-[28px] border border-edge bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.14),transparent_36%),rgba(5,5,5,0.92)] p-6">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-edge bg-surface-secondary/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
            Product Direction Memo
          </span>
          <ConfidenceBadge value={analysis.meta.confidence_level} />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-content">
              {analysis.meta.subject_company}: what should they build next?
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-content-secondary">
              {analysis.executive_answer.recommended_direction}
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-content-muted">
              {analysis.executive_answer.why_best_fit}
            </p>
          </div>
          <div className="rounded-2xl border border-edge bg-surface-secondary p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Truth boundary</div>
            <p className="mt-2 text-sm leading-relaxed text-content-secondary">{analysis.public_evidence.truth_boundary}</p>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Do not say</div>
            <p className="mt-2 text-sm leading-relaxed text-rose-600 dark:text-rose-300">{analysis.final_output_block.best_do_not_say}</p>
          </div>
        </div>
      </header>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as MemoTab)}
        className="contents"
      >
        <TabsList
          className="flex h-auto flex-wrap justify-start gap-2 bg-transparent p-0"
          aria-label="Product direction memo sections"
        >
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition data-[state=active]:bg-indigo-500/10 data-[state=active]:text-indigo-100 data-[state=active]:shadow-none",
                activeTab === tab.id
                  ? "border-indigo-400/40 bg-indigo-500/10 text-indigo-100"
                  : "border-edge bg-surface/50 text-content-muted hover:border-edge hover:text-content",
              )}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

      <TabsContent value="executive" className="mt-0">
        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <SectionCard title="Executive Answer" icon={<BadgeCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />}>
            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                  Recommended direction
                </div>
                <p className="mt-2 text-base leading-relaxed text-content">
                  {analysis.executive_answer.recommended_direction}
                </p>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                  Why this is the best fit
                </div>
                <p className="mt-2 text-sm leading-relaxed text-content-secondary">
                  {analysis.executive_answer.why_best_fit}
                </p>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                  What to avoid
                </div>
                <p className="mt-2 text-sm leading-relaxed text-content-secondary">
                  {analysis.executive_answer.what_to_avoid}
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Final Output Block" icon={<Flag className="h-4 w-4 text-amber-600 dark:text-amber-300" />}>
            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                  Best-fit product name
                </div>
                <p className="mt-2 text-lg font-medium text-content">
                  {analysis.final_output_block.best_fit_product_name}
                </p>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                  Positioning line
                </div>
                <p className="mt-2 text-sm leading-relaxed text-content-secondary">
                  {analysis.final_output_block.best_positioning_line}
                </p>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                  Short recommendation
                </div>
                <p className="mt-2 text-sm leading-relaxed text-content-secondary">
                  {analysis.final_output_block.short_recommendation}
                </p>
              </div>
            </div>
          </SectionCard>
        </div>
      </TabsContent>

      <TabsContent value="evidence" className="mt-0">
        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title="Publicly Supported Facts" icon={<BookOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />}>
            <div className="space-y-4">
              {analysis.public_evidence.publicly_supported_facts.map((fact: any) => (
                <div key={fact.statement} className="rounded-xl border border-edge bg-surface/50 p-4">
                  <p className="text-sm leading-relaxed text-content">{fact.statement}</p>
                  <div className="mt-3 flex items-center gap-3 text-xs text-content-muted">
                    <span>confidence {(fact.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <SourceChips sourceRefs={fact.source_refs} />
                </div>
              ))}
            </div>
          </SectionCard>

          <div className="space-y-6">
            <SectionCard title="Supported But Limited" icon={<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />}>
              <div className="space-y-4">
                {analysis.public_evidence.publicly_supported_but_limited.map((claim: any) => (
                  <div key={claim.claim} className="rounded-xl border border-edge bg-surface/50 p-4">
                    <div className="text-sm font-medium text-content">{claim.claim}</div>
                    <p className="mt-2 text-sm leading-relaxed text-content-secondary">{claim.what_is_supported}</p>
                    <p className="mt-2 text-sm leading-relaxed text-content-muted">{claim.what_is_missing}</p>
                    <SourceChips sourceRefs={claim.source_refs} />
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Not Established" icon={<ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-300" />}>
              <BulletList items={analysis.public_evidence.not_established_by_public_evidence} />
            </SectionCard>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="options" className="mt-0">
        <div className="space-y-6">
          <SectionCard title="Credibility Filter" icon={<ShieldAlert className="h-4 w-4 text-content-secondary" />}>
            <div className="grid gap-4 lg:grid-cols-3">
              {[
                ["High credibility", analysis.credibility_filter.high_credibility_build_directions, "text-emerald-600 dark:text-emerald-300"],
                [
                  "Medium credibility",
                  analysis.credibility_filter.medium_credibility_exploratory_directions,
                  "text-amber-600 dark:text-amber-300",
                ],
                ["Low credibility", analysis.credibility_filter.low_credibility_stretch_directions, "text-rose-600 dark:text-rose-300"],
              ].map(([label, items, tone]) => (
                <div key={String(label)} className="rounded-xl border border-edge bg-surface/50 p-4">
                  <div className={cn("text-sm font-medium", tone as string)}>{label}</div>
                  <div className="mt-3 space-y-3">
                    {(items as InHouseProductDirection["credibility_filter"]["high_credibility_build_directions"]).map((item: any) => (
                      <div key={item.direction}>
                        <div className="text-sm text-content">{item.direction}</div>
                        <div className="mt-1 text-xs leading-relaxed text-content-muted">{item.rationale}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-3">
            {analysis.product_options.map((option: any) => (
              <SectionCard
                key={option.option_id}
                title={option.name}
                icon={<Lightbulb className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />}
              >
                <div className="space-y-4">
                  <span className="rounded-full border border-edge bg-surface-secondary/50 px-2 py-1 text-[11px] uppercase tracking-wide text-content-muted">
                    {option.fit_level.replace(/_/g, " ")}
                  </span>
                  <p className="text-sm leading-relaxed text-content-secondary">{option.what_it_is}</p>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                      Core capabilities
                    </div>
                    <div className="mt-2">
                      <BulletList items={option.core_capabilities} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">Why it fits</div>
                    <div className="mt-2">
                      <BulletList items={option.why_it_fits} />
                    </div>
                  </div>
                  {option.correct_framing ? (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100">
                      {option.correct_framing}
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            ))}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="plan" className="mt-0">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <SectionCard title="Phased Build Plan" icon={<Layers3 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />}>
            <div className="space-y-4">
              {analysis.phased_build_plan.map((phase: any) => (
                <div key={phase.phase_id} className="rounded-xl border border-edge bg-surface/50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-content">{phase.name}</div>
                    <span className="rounded-full border border-edge bg-surface-secondary/50 px-2 py-1 text-[10px] uppercase tracking-wide text-content-muted">
                      {phase.phase_id.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-content-secondary">{phase.goal}</p>
                  <div className="mt-3">
                    <BulletList items={phase.build_items} />
                  </div>
                  {phase.credible_claim_after_phase ? (
                    <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-emerald-100">
                      {phase.credible_claim_after_phase}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </SectionCard>

          <div className="space-y-6">
            <SectionCard title="Likely Pain Points" icon={<BriefcaseBusiness className="h-4 w-4 text-amber-600 dark:text-amber-300" />}>
              <BulletList items={analysis.customer_pain_points.likely_pain_points} />
              <p className="mt-4 text-xs leading-relaxed text-content-muted">{analysis.customer_pain_points.sales_note}</p>
            </SectionCard>

            <SectionCard title="Suggested Product Shape" icon={<BrainCircuit className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />}>
              <div className="space-y-3">
                {analysis.final_recommendation.suggested_product_shape.map((layer: any) => (
                  <div key={layer.layer_name} className="rounded-xl border border-edge bg-surface/50 p-3">
                    <div className="text-sm font-medium text-content">{layer.layer_name}</div>
                    <div className="mt-1 text-xs leading-relaxed text-content-muted">{layer.role}</div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="narrative" className="mt-0">
        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title="Defensible Narrative" icon={<BadgeCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />}>
            <BulletList items={analysis.defensible_narrative.narrative_arc} />
            <div className="mt-4 rounded-xl border border-edge bg-surface/50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">Example answer</div>
              <p className="mt-2 text-sm leading-relaxed text-content-secondary">{analysis.defensible_narrative.example_answer}</p>
            </div>
          </SectionCard>

          <div className="space-y-6">
            <SectionCard title="Security & Trust Requirements" icon={<ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-300" />}>
              <div className="space-y-4">
                {analysis.security_trust_requirements.requirements.map((requirement: any) => (
                  <div key={requirement.requirement} className="rounded-xl border border-edge bg-surface/50 p-4">
                    <div className="text-sm font-medium text-content">{requirement.requirement}</div>
                    <div className="mt-1 text-xs leading-relaxed text-content-muted">{requirement.why_it_matters}</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Limitations" icon={<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />}>
              <BulletList items={analysis.limitations} />
            </SectionCard>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="json" className="mt-0">
        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title="Typed Output" icon={<FileJson2 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />}>
            <LazyCodeBlock code={formattedJson} language="json" />
          </SectionCard>
          <SectionCard title="Schema Contract" icon={<FileJson2 className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />}>
            <LazyCodeBlock code={schemaJson} language="json" />
          </SectionCard>
        </div>
      </TabsContent>
      </Tabs>
    </div>
  );
}

export default ProductDirectionMemoView;
