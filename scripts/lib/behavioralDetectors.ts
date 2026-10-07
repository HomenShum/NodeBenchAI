/**
 * Reusable Product Behavioral Design Detectors
 *
 * Structural detection framework that identifies product behavior violations
 * BEFORE they reach users. Each detector maps to one of the 6 root cause
 * principles from Linear/ChatGPT/Perplexity/Notion/Vercel analysis.
 *
 * Usage:
 *   import { runAllDetectors, type DetectorResult } from "./lib/behavioralDetectors";
 *   const findings = await runAllDetectors(screenshotAnalysis);
 *
 * These detectors work on Gemini audit output (BehavioralAudit JSON) and
 * produce actionable fix tickets with severity, file targets, and metrics.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DetectorFinding {
  detector: string;
  principle: "dominant_job" | "visible_reasoning" | "speed_behavior" | "quality_discipline" | "context_compounding" | "chrome_collapse";
  severity: "P0" | "P1" | "P2";
  surface: string;
  title: string;
  evidence: string;
  fix: string;
  fileTargets: string[];
  metric: string;
}

export interface SurfaceAudit {
  surface: string;
  overallScore: number;
  dimensionScores: {
    dominantJob: number;
    visibleReasoning: number;
    speedBehavior: number;
    qualityDiscipline: number;
    contextCompounding: number;
    chromeCollapse: number;
  };
  topIssues: string[];
  components?: Array<{
    name: string;
    role: string;
    verdict: string;
    reasoning: string;
  }>;
  interactionBudgets?: {
    firstInputVisible: boolean;
    estimatedTimeToFirstAction: string;
    estimatedTimeToFirstValue: string;
    layoutStability: string;
  };
}

// ─── Detector: Dominant Job ──────────────────────────────────────────────────

/**
 * Principle 1: One dominant job per screen.
 * Detects when a surface has competing primary actions, multiple CTAs
 * fighting for attention, or unclear hierarchy.
 *
 * Based on: Notion's "subtract tools, consolidate workflows" philosophy.
 */
export function detectDominantJobViolations(audit: SurfaceAudit): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  const score = audit.dimensionScores.dominantJob;

  if (score <= 5) {
    // Check for specific patterns in top issues
    const competingIssues = audit.topIssues.filter(
      (i) =>
        i.toLowerCase().includes("compet") ||
        i.toLowerCase().includes("multiple") ||
        i.toLowerCase().includes("dilute") ||
        i.toLowerCase().includes("equal weight"),
    );

    if (competingIssues.length > 0) {
      findings.push({
        detector: "dominant-job-competing-actions",
        principle: "dominant_job",
        severity: score <= 3 ? "P0" : "P1",
        surface: audit.surface,
        title: `${audit.surface}: Multiple competing primary actions`,
        evidence: competingIssues[0],
        fix: "Identify the ONE primary action. Visually demote everything else. Use size, color, and position hierarchy — not equal-weight cards.",
        fileTargets: [`apps/web/src/features/${audit.surface}/views/${capitalize(audit.surface)}Home.tsx`],
        metric: "single_primary_cta_visible_above_fold",
      });
    }

    // Check for components with "competing" role
    const competingComponents = (audit.components || []).filter((c) => c.role === "competing");
    for (const comp of competingComponents) {
      findings.push({
        detector: "dominant-job-competing-component",
        principle: "dominant_job",
        severity: "P1",
        surface: audit.surface,
        title: `${audit.surface}: "${comp.name}" competes for primary attention`,
        evidence: comp.reasoning,
        fix: `${comp.verdict} this component. ${comp.verdict === "remove" ? "Delete it." : comp.verdict === "simplify" ? "Reduce to a single line or chip." : "Move below fold or into a secondary rail."}`,
        fileTargets: [`apps/web/src/features/${audit.surface}/views/${capitalize(audit.surface)}Home.tsx`],
        metric: "components_with_competing_role_count",
      });
    }
  }

  return findings;
}

// ─── Detector: Chrome Collapse ───────────────────────────────────────────────

/**
 * Principle 6: Collapse chrome aggressively.
 * Detects excessive bordered containers, nested boxes, and visual noise
 * that should be replaced with spacing + typography hierarchy.
 *
 * Based on: Linear's minimal UI, Vercel's clean dashboard.
 */
export function detectChromeViolations(audit: SurfaceAudit): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  const score = audit.dimensionScores.chromeCollapse;

  if (score <= 5) {
    const chromeIssues = audit.topIssues.filter(
      (i) =>
        i.toLowerCase().includes("bordered") ||
        i.toLowerCase().includes("chrome") ||
        i.toLowerCase().includes("clutter") ||
        i.toLowerCase().includes("nested") ||
        i.toLowerCase().includes("box"),
    );

    if (chromeIssues.length > 0) {
      findings.push({
        detector: "chrome-excessive-borders",
        principle: "chrome_collapse",
        severity: score <= 3 ? "P0" : "P1",
        surface: audit.surface,
        title: `${audit.surface}: Excessive bordered containers`,
        evidence: chromeIssues[0],
        fix: "Replace nb-panel borders with spacing gaps. Use font-weight and text-size for hierarchy instead of box borders. Keep borders only on interactive cards and inputs.",
        fileTargets: [
          `apps/web/src/features/${audit.surface}/views/${capitalize(audit.surface)}Home.tsx`,
          "apps/web/src/index.css",
        ],
        metric: "bordered_container_count_per_viewport",
      });
    }

    // Check for components marked "decorative"
    const decorativeComponents = (audit.components || []).filter((c) => c.role === "decorative");
    for (const comp of decorativeComponents) {
      findings.push({
        detector: "chrome-decorative-component",
        principle: "chrome_collapse",
        severity: "P2",
        surface: audit.surface,
        title: `${audit.surface}: "${comp.name}" is decorative chrome`,
        evidence: comp.reasoning,
        fix: "Remove this component or merge its content into an adjacent section.",
        fileTargets: [`apps/web/src/features/${audit.surface}/views/${capitalize(audit.surface)}Home.tsx`],
        metric: "decorative_component_count",
      });
    }
  }

  return findings;
}

// ─── Detector: Context Compounding ───────────────────────────────────────────

/**
 * Principle 5: The product gets more useful as it knows more context.
 * Detects surfaces that feel static/impersonal — no recent activity,
 * no personalization signals, no visible learning.
 *
 * Based on: ChatGPT memory, Notion AI fitting into blocks, Perplexity research artifacts.
 */
export function detectContextCompoundingGaps(audit: SurfaceAudit): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  const score = audit.dimensionScores.contextCompounding;

  if (score <= 4) {
    findings.push({
      detector: "context-no-personalization",
      principle: "context_compounding",
      severity: "P1",
      surface: audit.surface,
      title: `${audit.surface}: No visible personalization or learning signals`,
      evidence: audit.topIssues.find((i) =>
        i.toLowerCase().includes("context") ||
        i.toLowerCase().includes("personal") ||
        i.toLowerCase().includes("static") ||
        i.toLowerCase().includes("impersonal"),
      ) || `Context compounding score is ${score}/10 — surface feels static.`,
      fix: "Add visible signals: 'Based on your N recent searches', 'Using N saved reports', 'Your preferred lens: Founder'. Show what the system knows and how it helps.",
      fileTargets: [
        `apps/web/src/features/${audit.surface}/views/${capitalize(audit.surface)}Home.tsx`,
        "apps/web/src/features/product/lib/productSession.ts",
      ],
      metric: "visible_personalization_signal_count",
    });
  }

  return findings;
}

// ─── Detector: Speed Behavior ────────────────────────────────────────────────

/**
 * Principle 3: Speed is product behavior, not backend optimization.
 * Detects missing progressive reveal, layout jumps, absent skeletons.
 *
 * Based on: Linear sub-50ms, Vercel hot-path-first, ChatGPT streaming feel.
 */
export function detectSpeedBehaviorGaps(audit: SurfaceAudit): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  const score = audit.dimensionScores.speedBehavior;

  if (score <= 5) {
    findings.push({
      detector: "speed-no-progressive-reveal",
      principle: "speed_behavior",
      severity: "P1",
      surface: audit.surface,
      title: `${audit.surface}: Missing progressive reveal / skeleton loading`,
      evidence: audit.topIssues.find((i) =>
        i.toLowerCase().includes("load") ||
        i.toLowerCase().includes("skeleton") ||
        i.toLowerCase().includes("progressive") ||
        i.toLowerCase().includes("layout"),
      ) || `Speed behavior score is ${score}/10.`,
      fix: "Add skeleton placeholders for async content. Show classify result immediately, source chips while searching, answer blocks streaming progressively.",
      fileTargets: [
        `apps/web/src/features/${audit.surface}/views/${capitalize(audit.surface)}Home.tsx`,
        "apps/web/src/components/skeletons/Skeleton.tsx",
      ],
      metric: "skeleton_coverage_percentage",
    });
  }

  if (audit.interactionBudgets?.layoutStability === "major-shifts") {
    findings.push({
      detector: "speed-layout-instability",
      principle: "speed_behavior",
      severity: "P0",
      surface: audit.surface,
      title: `${audit.surface}: Major layout shifts detected`,
      evidence: "Layout stability rated as 'major-shifts'.",
      fix: "Reserve space with min-height on async containers. Use CSS contain:content on independent sections.",
      fileTargets: [`apps/web/src/features/${audit.surface}/views/${capitalize(audit.surface)}Home.tsx`],
      metric: "cls_score",
    });
  }

  return findings;
}

// ─── Detector: Visible Reasoning ─────────────────────────────────────────────

/**
 * Principle 2: Trust comes from visible reasoning, not decorative UI.
 * Detects missing source attribution, absent stage indicators, opaque AI output.
 *
 * Based on: Linear transparent AI, Perplexity answer engine with citations.
 */
export function detectVisibleReasoningGaps(audit: SurfaceAudit): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  const score = audit.dimensionScores.visibleReasoning;

  if (score <= 4) {
    findings.push({
      detector: "reasoning-no-trust-signals",
      principle: "visible_reasoning",
      severity: "P1",
      surface: audit.surface,
      title: `${audit.surface}: Insufficient trust signals (sources, stages, evidence)`,
      evidence: `Visible reasoning score is ${score}/10. Users can't verify or trust the output.`,
      fix: "Attach source citations to every claim. Show processing stages. Add confidence indicators. Make reasoning transparent.",
      fileTargets: [`apps/web/src/features/${audit.surface}/views/${capitalize(audit.surface)}Home.tsx`],
      metric: "trust_signal_count_per_answer_block",
    });
  }

  return findings;
}

// ─── Detector: Quality Discipline ────────────────────────────────────────────

/**
 * Principle 4: Quality is a system, not a cleanup sprint.
 * Detects inconsistent spacing, typography mismatches, missing hover/focus states.
 *
 * Based on: Linear Quality Wednesdays, Zero-bugs policy.
 */
export function detectQualityDisciplineGaps(audit: SurfaceAudit): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  const score = audit.dimensionScores.qualityDiscipline;

  if (score <= 5) {
    const papercuts = audit.topIssues.filter(
      (i) =>
        i.toLowerCase().includes("spacing") ||
        i.toLowerCase().includes("alignment") ||
        i.toLowerCase().includes("inconsisten") ||
        i.toLowerCase().includes("padding") ||
        i.toLowerCase().includes("papercut"),
    );

    if (papercuts.length > 0) {
      findings.push({
        detector: "quality-papercuts",
        principle: "quality_discipline",
        severity: "P2",
        surface: audit.surface,
        title: `${audit.surface}: Quality papercuts (spacing, alignment, consistency)`,
        evidence: papercuts[0],
        fix: "Standardize spacing tokens (gap-3/gap-4/gap-5). Standardize typography (nb-section-kicker for all headers). Check alignment grid.",
        fileTargets: [
          `apps/web/src/features/${audit.surface}/views/${capitalize(audit.surface)}Home.tsx`,
          "apps/web/src/index.css",
        ],
        metric: "papercut_count_per_surface",
      });
    }
  }

  return findings;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

/**
 * Run all 6 detectors against a surface audit result.
 * Returns findings sorted by severity (P0 first).
 */
export function runAllDetectors(audit: SurfaceAudit): DetectorFinding[] {
  const allFindings = [
    ...detectDominantJobViolations(audit),
    ...detectChromeViolations(audit),
    ...detectContextCompoundingGaps(audit),
    ...detectSpeedBehaviorGaps(audit),
    ...detectVisibleReasoningGaps(audit),
    ...detectQualityDisciplineGaps(audit),
  ];

  // Sort by severity: P0 > P1 > P2
  const order = { P0: 0, P1: 1, P2: 2 };
  return allFindings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Run detectors across multiple surfaces and produce a summary.
 */
export function runAuditWithDetectors(surfaces: SurfaceAudit[]): {
  findings: DetectorFinding[];
  summary: {
    totalFindings: number;
    p0Count: number;
    p1Count: number;
    p2Count: number;
    worstPrinciple: string;
    worstSurface: string;
    crossCuttingPatterns: string[];
  };
} {
  const allFindings: DetectorFinding[] = [];
  for (const surface of surfaces) {
    allFindings.push(...runAllDetectors(surface));
  }

  // Sort globally
  const order = { P0: 0, P1: 1, P2: 2 };
  allFindings.sort((a, b) => order[a.severity] - order[b.severity]);

  // Compute cross-cutting patterns (principles that appear on 3+ surfaces)
  const principleCountBySurface = new Map<string, Set<string>>();
  for (const f of allFindings) {
    if (!principleCountBySurface.has(f.principle)) principleCountBySurface.set(f.principle, new Set());
    principleCountBySurface.get(f.principle)!.add(f.surface);
  }
  const crossCuttingPatterns = Array.from(principleCountBySurface.entries())
    .filter(([, surfaces]) => surfaces.size >= 3)
    .map(([principle, surfaces]) => `${principle} (affects ${surfaces.size}/5 surfaces: ${Array.from(surfaces).join(", ")})`);

  // Worst principle (most findings)
  const principleCounts = new Map<string, number>();
  for (const f of allFindings) {
    principleCounts.set(f.principle, (principleCounts.get(f.principle) || 0) + 1);
  }
  const worstPrinciple = Array.from(principleCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "none";

  // Worst surface (lowest score)
  const worstSurface = surfaces.sort((a, b) => a.overallScore - b.overallScore)[0]?.surface || "none";

  return {
    findings: allFindings,
    summary: {
      totalFindings: allFindings.length,
      p0Count: allFindings.filter((f) => f.severity === "P0").length,
      p1Count: allFindings.filter((f) => f.severity === "P1").length,
      p2Count: allFindings.filter((f) => f.severity === "P2").length,
      worstPrinciple,
      worstSurface,
      crossCuttingPatterns,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
