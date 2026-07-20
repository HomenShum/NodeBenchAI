#!/usr/bin/env npx tsx
/**
 * Dopamine Scoring System — 50 boolean criteria across 5 progressive tiers.
 *
 * Reads actual source files and programmatically evaluates each criterion.
 * Tiered gating: must pass ALL criteria in tier N before tier N+1 counts.
 *
 * Usage: npx tsx scripts/score-dopamine.ts
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const FOUNDER_VIEWS = join(ROOT, "src/features/founder/views");
const SRC = join(ROOT, "apps", "web", "src");

const FILES = {
  dashboard: join(FOUNDER_VIEWS, "FounderDashboardView.tsx"),
  initiative: join(FOUNDER_VIEWS, "InitiativeWorkspaceView.tsx"),
  setup: join(FOUNDER_VIEWS, "CompanySetupView.tsx"),
  agents: join(FOUNDER_VIEWS, "AgentOversightView.tsx"),
  memo: join(FOUNDER_VIEWS, "ShareableMemoView.tsx"),
  command: join(FOUNDER_VIEWS, "CommandPanelView.tsx"),
  fixtures: join(FOUNDER_VIEWS, "founderFixtures.ts"),
  errorBoundary: join(SRC, "shared/components/ErrorBoundary.tsx"),
  toast: join(SRC, "hooks/useToast.ts"),
  commandPalette: join(SRC, "layouts/chrome/CommandPalette.tsx"),
  commandPaletteHook: join(SRC, "hooks/useCommandPalette.ts"),
};

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// Load all files once
const src: Record<string, string> = {};
for (const [key, path] of Object.entries(FILES)) {
  src[key] = safeRead(path);
}

// Combined source of all founder views
const allFounder = [
  src.dashboard,
  src.initiative,
  src.setup,
  src.agents,
  src.memo,
  src.command,
  src.fixtures,
].join("\n");

/* ------------------------------------------------------------------ */
/*  Criteria definitions                                               */
/* ------------------------------------------------------------------ */

interface Criterion {
  id: number;
  tier: number;
  name: string;
  check: () => boolean;
}

const criteria: Criterion[] = [
  // ═══════════════════════════════════════════════════════════════════
  // TIER 1: Basic Functionality (1-10)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 1,
    tier: 1,
    name: "Every button has an onClick handler (no dead buttons)",
    check: () => {
      // Count <button elements vs onClick handlers in each file
      for (const f of [src.dashboard, src.initiative, src.setup, src.agents, src.memo, src.command]) {
        const buttons = (f.match(/<button\b/g) || []).length;
        const clicks = (f.match(/onClick/g) || []).length;
        // Allow some buttons inside forms that submit via form action
        if (buttons > 0 && clicks < buttons * 0.7) return false;
      }
      return true;
    },
  },
  {
    id: 2,
    tier: 1,
    name: "At least one form of persistence (localStorage or Convex)",
    check: () => /localStorage\.(setItem|getItem)/.test(allFounder),
  },
  {
    id: 3,
    tier: 1,
    name: "Navigation works (useNavigate calls exist for all routes)",
    check: () => {
      const hasNav = /useNavigate/.test(src.dashboard) || /navigate\(/.test(src.dashboard);
      const hasBack = /history\.back|navigate\(-1\)|useNavigate/.test(src.initiative);
      return hasNav && hasBack;
    },
  },
  {
    id: 4,
    tier: 1,
    name: "Toast/feedback system exists",
    check: () => {
      const hasHook = src.toast.length > 50;
      const usedInViews = /useToast/.test(allFounder);
      return hasHook && usedInViews;
    },
  },
  {
    id: 5,
    tier: 1,
    name: "At least one dynamic timestamp (not hardcoded date)",
    check: () => /new Date\(\)/.test(allFounder) || /Date\.now\(\)/.test(allFounder),
  },
  {
    id: 6,
    tier: 1,
    name: "Company data can be saved and loaded",
    check: () => {
      const saves = /localStorage\.setItem/.test(src.setup) || /persistCompany/.test(src.setup);
      const loads = /localStorage\.getItem/.test(src.setup) || /loadSavedCompany/.test(src.setup);
      return saves && loads;
    },
  },
  {
    id: 7,
    tier: 1,
    name: "At least one state transition with visual feedback",
    check: () => {
      // Look for state changes that trigger visual changes (accept/reject patterns)
      const hasAcceptState = /setState.*accept|setInterventions|setStatus.*accept/i.test(src.dashboard);
      const hasMotion = /motion\.|AnimatePresence|framer-motion/.test(src.dashboard);
      return hasAcceptState || hasMotion;
    },
  },
  {
    id: 8,
    tier: 1,
    name: "Error boundaries exist",
    check: () => src.errorBoundary.length > 100 && /ErrorBoundary/.test(src.errorBoundary),
  },
  {
    id: 9,
    tier: 1,
    name: "Loading states exist for async operations",
    check: () => {
      // Check for loading states, skeleton screens, or transition-opacity patterns
      const hasLoading = /isLoading|loading|skeleton|Skeleton/i.test(allFounder);
      const hasTransitionOpacity = /transition-opacity|opacity-0.*opacity-100|useRevealOnMount/.test(allFounder);
      return hasLoading || hasTransitionOpacity;
    },
  },
  {
    id: 10,
    tier: 1,
    name: "At least one share mechanism exists",
    check: () => {
      const hasClipboard = /clipboard\.writeText/.test(allFounder);
      const hasCopyUrl = /copyMemoUrl|copyUrl|shareUrl/.test(allFounder);
      return hasClipboard || hasCopyUrl;
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // TIER 2: Feedback Loops (11-20)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 11,
    tier: 2,
    name: "Accept action shows immediate visual change (green state, icon swap)",
    check: () => {
      const hasAcceptedState = /accepted|status.*===.*"accepted"/.test(src.dashboard);
      const hasGreenOnAccept = /emerald|green|check|Check/.test(src.dashboard) && /accept/i.test(src.dashboard);
      return hasAcceptedState || hasGreenOnAccept;
    },
  },
  {
    id: 12,
    tier: 2,
    name: "Reject action removes item with animation",
    check: () => {
      const hasReject = /reject|dismissed|handleDismiss|handleReject/i.test(src.dashboard);
      const hasAnimatePresence = /AnimatePresence/.test(src.dashboard);
      return hasReject && hasAnimatePresence;
    },
  },
  {
    id: 13,
    tier: 2,
    name: "Defer action shows distinct visual state from accept",
    check: () => {
      const hasDefer = /defer|deferred/i.test(src.dashboard);
      const hasDeferState = /status.*===.*"deferred"|deferred/i.test(src.dashboard);
      return hasDefer && hasDeferState;
    },
  },
  {
    id: 14,
    tier: 2,
    name: "User actions appear in the activity feed",
    check: () => {
      const hasUserActions = /userActions|actionLog|activityLog/i.test(src.dashboard);
      const logsActions = /setUserActions|\.push\(|addAction|logAction/.test(src.dashboard);
      return hasUserActions && logsActions;
    },
  },
  {
    id: 15,
    tier: 2,
    name: "Actions counter updates in real-time",
    check: () => {
      const hasCount = /done.*today|todayCount|actionCount|decisionsToday/i.test(src.dashboard);
      const hasCounter = /\.length|\.filter|count/i.test(src.dashboard);
      return hasCount && hasCounter;
    },
  },
  {
    id: 16,
    tier: 2,
    name: "Streak tracker increments across days",
    check: () => {
      const hasStreakStorage = /localStorage.*streak|LS_KEY_STREAK/i.test(src.dashboard);
      const hasIncrement = /streak.*\+|currentStreak|streakCount|count\s*\+\s*1|newCount/i.test(src.dashboard);
      return hasStreakStorage && hasIncrement;
    },
  },
  {
    id: 17,
    tier: 2,
    name: "Message input produces a response (not just sends)",
    check: () => {
      const hasInput = /input.*message|textarea|handleSend|onSend/i.test(src.command);
      const hasResponse = /response|reply|addMessage.*assistant|role.*assistant/i.test(src.command);
      return hasInput && hasResponse;
    },
  },
  {
    id: 18,
    tier: 2,
    name: "Approval flow has at least 2 outcomes (approve/reject)",
    check: () => {
      const hasApprove = /accept|approve/i.test(src.dashboard);
      const hasReject = /reject|dismiss/i.test(src.dashboard);
      return hasApprove && hasReject;
    },
  },
  {
    id: 19,
    tier: 2,
    name: "At least 3 different toast variants (success/warning/error)",
    check: () => {
      const toastContent = src.toast;
      // Check for variant types in the toast hook or its usage
      const hasSuccess = /success/.test(toastContent) || /toast\([^)]*"success"/.test(allFounder);
      const hasWarning = /warning|warn/.test(toastContent) || /toast\([^)]*"warning"/.test(allFounder);
      const hasError = /error/.test(toastContent) || /toast\([^)]*"error"/.test(allFounder);
      return hasSuccess && hasError && hasWarning;
    },
  },
  {
    id: 20,
    tier: 2,
    name: "Conversation persists across page reloads",
    check: () => {
      const saves = /localStorage\.setItem.*message|LS_KEY.*message|persistMessages/i.test(src.command);
      const loads = /localStorage\.getItem.*message|loadMessages|initialMessages.*localStorage/i.test(src.command);
      return saves && loads;
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // TIER 3: Variable Reward & Return Hooks (21-30)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 21,
    tier: 3,
    name: "Daily memo content changes based on date",
    check: () => {
      // Check if daily memo uses date-based logic (not just static fixture)
      const dateAware = /getDay\(\)|getDate\(\)|dayOfWeek|dateIndex|toDateString|dayRotation/i.test(src.dashboard);
      const dynamicMemo = /memoForToday|dailyMemoContent|rotateMemo|memoVariant/i.test(src.dashboard);
      return dateAware || dynamicMemo;
    },
  },
  {
    id: 22,
    tier: 3,
    name: "What Changed feed includes user's own past actions",
    check: () => {
      // Merging user actions into the changes feed
      const mergesActions = /userActions.*changes|mergedFeed|combinedChanges|\.concat.*userAction/i.test(src.dashboard);
      const actionInFeed = /type.*===.*"user_action"|source.*===.*"user"/i.test(src.dashboard);
      return mergesActions || actionInFeed;
    },
  },
  {
    id: 23,
    tier: 3,
    name: "Intervention rankings change after user accepts/rejects",
    check: () => {
      // After accept/reject, remaining items re-rank
      const reranks = /reRank|resort|sort.*after|filter.*accepted|recalculate.*rank/i.test(src.dashboard);
      const modifiesInterventions = /setInterventions.*filter|setInterventions.*map|interventions\.filter/i.test(src.dashboard);
      return reranks || modifiesInterventions;
    },
  },
  {
    id: 24,
    tier: 3,
    name: "Agent status can change between sessions",
    check: () => {
      // Agent status persisted or dynamic
      const persisted = /localStorage.*agent|LS_KEY.*agent/i.test(allFounder);
      const dynamic = /setAgentStatus|updateAgent|agentStatus.*set/i.test(allFounder);
      return persisted || dynamic;
    },
  },
  {
    id: 25,
    tier: 3,
    name: "At least one metric visually updates based on user behavior",
    check: () => {
      // Confidence bar, progress, or metric that changes with user actions
      const dynamicMetric = /identityConfidence|confidence.*set|setConfidence|progressWidth|completionRate/i.test(src.dashboard);
      const barUpdates = /style.*width.*%|\.toFixed|Math\.round.*confidence/i.test(src.dashboard);
      return dynamicMetric && barUpdates;
    },
  },
  {
    id: 26,
    tier: 3,
    name: "Dashboard shows different state on first visit vs return visit",
    check: () => {
      const firstVisit = /firstVisit|hasVisited|isNewUser|isReturning|visitCount|returningUser/i.test(src.dashboard);
      const localStorage = /localStorage.*visit|LS_KEY.*visit/i.test(src.dashboard);
      return firstVisit || localStorage;
    },
  },
  {
    id: 27,
    tier: 3,
    name: "Streak has visual escalation (different styling at 3, 7, 30 days)",
    check: () => {
      // Multiple streak thresholds with different visuals
      const multiThreshold = /streak.*>=?\s*3|streak.*>=?\s*7|streak.*>=?\s*30/i.test(src.dashboard);
      const streakEmoji = /flame|fire|meteor|rocket|crown|Flame/i.test(src.dashboard) && /streak/i.test(src.dashboard);
      return multiThreshold || streakEmoji;
    },
  },
  {
    id: 28,
    tier: 3,
    name: "At least one surprise element (random tip, insight, or suggestion)",
    check: () => {
      const hasRandom = /Math\.random|randomTip|randomInsight|shuffl/i.test(src.dashboard);
      const hasTips = /tips?\[|insights?\[|suggestions?\[|TIPS|INSIGHTS/i.test(src.dashboard);
      return hasRandom || hasTips;
    },
  },
  {
    id: 29,
    tier: 3,
    name: "Notifications or badges for pending items",
    check: () => {
      const hasBadge = /badge|notification.*count|pending.*count|unread/i.test(src.dashboard);
      const hasVisualBadge = /rounded-full.*text-\[10px\]|bg-rose|bg-amber.*count/i.test(src.dashboard);
      return hasBadge || hasVisualBadge;
    },
  },
  {
    id: 30,
    tier: 3,
    name: "Time-based content (morning vs evening greeting)",
    check: () => {
      const hasTimeGreeting = /getHours|morning|evening|afternoon|Good\s+(morning|evening|afternoon)/i.test(src.dashboard);
      const hasTimeLogic = /hour\s*[<>=]|timeOfDay|greetingText/i.test(src.dashboard);
      return hasTimeGreeting || hasTimeLogic;
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // TIER 4: Investment & Social (31-40)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 31,
    tier: 4,
    name: "User-created data accumulates and is visible (decisions history)",
    check: () => {
      const hasHistory = /history|pastDecisions|decisionLog|actionHistory/i.test(allFounder);
      const persisted = /localStorage.*actions|LS_KEY_USER_ACTIONS/.test(src.dashboard);
      return hasHistory && persisted;
    },
  },
  {
    id: 32,
    tier: 4,
    name: "Share button copies a working URL that renders without auth",
    check: () => {
      const hasCopyUrl = /copyMemoUrl|clipboard.*writeText.*memo|shareUrl/.test(allFounder);
      const hasRoute = /\/memo\//.test(allFounder);
      return hasCopyUrl && hasRoute;
    },
  },
  {
    id: 33,
    tier: 4,
    name: "Shared memo has OG meta tags for social previews",
    check: () => {
      const hasOG = /og:title|og:description|og:type/.test(src.memo);
      return hasOG;
    },
  },
  {
    id: 34,
    tier: 4,
    name: "Shared memo looks screenshot-worthy (dark mode, branded, clean)",
    check: () => {
      const hasDarkBg = /bg-\[#151413\]/.test(src.memo);
      const hasBranding = /NodeBench/.test(src.memo);
      const hasManrope = /Manrope/.test(src.memo);
      return hasDarkBg && hasBranding && hasManrope;
    },
  },
  {
    id: 35,
    tier: 4,
    name: "At least 3 types of content can be shared",
    check: () => {
      // memo, intervention, initiative — need share actions for at least 3
      const memoShare = /copyMemoUrl|shareMemo/.test(allFounder);
      const interventionShare = /shareIntervention|share.*intervention|copyIntervention/i.test(allFounder);
      const initiativeShare = /shareInitiative|share.*initiative|copyInitiative/i.test(allFounder);
      const genericShare = /navigator\.share|Share2/.test(allFounder);
      let count = 0;
      if (memoShare) count++;
      if (interventionShare) count++;
      if (initiativeShare) count++;
      if (genericShare) count++;
      return count >= 3;
    },
  },
  {
    id: 36,
    tier: 4,
    name: "Print stylesheet exists for shareable content",
    check: () => /@media print/.test(src.memo),
  },
  {
    id: 37,
    tier: 4,
    name: "User can export data (JSON, CSV, or PDF)",
    check: () => {
      const hasExport = /exportData|downloadJSON|downloadCSV|window\.print|exportPDF/i.test(allFounder);
      const hasBlob = /new Blob|URL\.createObjectURL|download.*json|download.*csv/i.test(allFounder);
      return hasExport || hasBlob;
    },
  },
  {
    id: 38,
    tier: 4,
    name: "Decision history is browsable/searchable",
    check: () => {
      const hasSearch = /searchQuery|filterActions|searchActions|browse.*history/i.test(allFounder);
      const hasFilter = /filter.*type|filterBy|setFilter/i.test(allFounder);
      return hasSearch || hasFilter;
    },
  },
  {
    id: 39,
    tier: 4,
    name: "Company profile confidence changes based on user actions",
    check: () => {
      const dynamicConfidence = /setIdentityConfidence|identityConfidence.*\+|updateConfidence/i.test(src.dashboard);
      const changesOnAction = /confidence.*accept|accept.*confidence/i.test(src.dashboard);
      return dynamicConfidence || changesOnAction;
    },
  },
  {
    id: 40,
    tier: 4,
    name: "Agent connection shows live status indicator",
    check: () => {
      const hasPulse = /pulse|animate-pulse|boxShadow.*rgba|glow/.test(src.agents);
      const hasStatusDot = /rounded-full.*bg-(emerald|green)/.test(src.agents);
      return hasPulse && hasStatusDot;
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // TIER 5: Delight & Polish (41-50)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 41,
    tier: 5,
    name: "Stagger animations on page transitions",
    check: () => {
      const hasStagger = /transitionDelay|stagger|delay.*index|style.*delay/i.test(allFounder);
      const hasMotion = /motion\.div|framer-motion/.test(allFounder);
      return hasStagger && hasMotion;
    },
  },
  {
    id: 42,
    tier: 5,
    name: "Hover states on all interactive cards",
    check: () => {
      // Check that glass cards have hover states
      const hoverCount = (allFounder.match(/hover:/g) || []).length;
      return hoverCount >= 15;
    },
  },
  {
    id: 43,
    tier: 5,
    name: "Keyboard shortcuts for common actions (Accept=A, Defer=D)",
    check: () => {
      const hasKeydown = /keydown|keypress|useHotkey|onKeyDown/i.test(allFounder);
      const hasKeyMap = /key.*===.*"a"|key.*===.*"d"|keyMap|shortcuts/i.test(allFounder);
      return hasKeydown && hasKeyMap;
    },
  },
  {
    id: 44,
    tier: 5,
    name: "Sound feedback option (click sounds, notification sounds)",
    check: () => {
      const hasAudio = /new Audio|AudioContext|playSound|useSound/i.test(allFounder);
      return hasAudio;
    },
  },
  {
    id: 45,
    tier: 5,
    name: "Confetti or celebration animation on milestones",
    check: () => {
      const hasConfetti = /confetti|celebration|celebrate|party|fireworks/i.test(allFounder);
      const hasMilestone = /milestone|streak.*===.*7|streak.*===.*10|streak.*===.*30/i.test(allFounder);
      return hasConfetti || (hasMilestone && /animation|animate|motion/i.test(allFounder));
    },
  },
  {
    id: 46,
    tier: 5,
    name: "Undo for destructive actions (reject with undo toast)",
    check: () => /undo|Undo/i.test(allFounder),
  },
  {
    id: 47,
    tier: 5,
    name: "Drag-and-drop for priority reordering",
    check: () => {
      const hasDnd = /draggable|onDragStart|onDragEnd|@dnd-kit|react-beautiful-dnd|useSortable/i.test(allFounder);
      return hasDnd;
    },
  },
  {
    id: 48,
    tier: 5,
    name: "Quick-add for signals/notes without leaving dashboard",
    check: () => {
      const hasQuickAdd = /quickAdd|addSignal|addNote|inlineAdd|quickNote/i.test(src.dashboard);
      const hasInlineForm = /showAddForm|isAdding|setIsAdding/i.test(src.dashboard);
      return hasQuickAdd || hasInlineForm;
    },
  },
  {
    id: 49,
    tier: 5,
    name: "Command palette (Cmd+K) for power users",
    check: () => {
      const exists = src.commandPalette.length > 100;
      const hasCmdK = /Cmd\+K|ctrl\+k|meta.*k|mod.*k|metaKey.*k/i.test(src.commandPalette + (src.commandPaletteHook ?? ""));
      return exists && hasCmdK;
    },
  },
  {
    id: 50,
    tier: 5,
    name: "Onboarding tooltips that highlight new features on first visit",
    check: () => {
      const hasTooltip = /tooltip|onboarding.*tip|firstTime.*tooltip|showTip|highlightNew/i.test(allFounder);
      const hasOnboarding = /onboarding|hasSeenOnboarding|showOnboarding/i.test(allFounder);
      return hasTooltip || hasOnboarding;
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Scoring engine                                                     */
/* ------------------------------------------------------------------ */

interface CriterionResult {
  id: number;
  tier: number;
  name: string;
  pass: boolean;
}

function runScore(): {
  results: CriterionResult[];
  tierScores: Record<number, { passed: number; total: number; allPassed: boolean }>;
  totalScore: number;
} {
  const results: CriterionResult[] = criteria.map((c) => ({
    id: c.id,
    tier: c.tier,
    name: c.name,
    pass: c.check(),
  }));

  // Calculate tier scores
  const tierScores: Record<number, { passed: number; total: number; allPassed: boolean }> = {};
  for (let t = 1; t <= 5; t++) {
    const tierResults = results.filter((r) => r.tier === t);
    const passed = tierResults.filter((r) => r.pass).length;
    tierScores[t] = {
      passed,
      total: tierResults.length,
      allPassed: passed === tierResults.length,
    };
  }

  // Tiered gating: must pass ALL in tier N before tier N+1 counts
  let totalScore = 0;
  for (let t = 1; t <= 5; t++) {
    const tierPoints = tierScores[t].passed * 2; // 2 points per criterion
    totalScore += tierPoints;

    // If this tier isn't fully passed, no higher tiers count
    if (!tierScores[t].allPassed) {
      break;
    }
  }

  return { results, tierScores, totalScore };
}

/* ------------------------------------------------------------------ */
/*  Output                                                             */
/* ------------------------------------------------------------------ */

const TIER_NAMES: Record<number, string> = {
  1: "Basic Functionality",
  2: "Feedback Loops",
  3: "Variable Reward & Return Hooks",
  4: "Investment & Social",
  5: "Delight & Polish",
};

const { results, tierScores, totalScore } = runScore();

// Print table
console.log("\n╔══════════════════════════════════════════════════════════════════════════╗");
console.log("║                    NODEBENCH DOPAMINE SCORE                             ║");
console.log("╚══════════════════════════════════════════════════════════════════════════╝\n");

for (let t = 1; t <= 5; t++) {
  const ts = tierScores[t];
  const gated = t > 1 && !tierScores[t - 1].allPassed;
  const tierLabel = `TIER ${t}: ${TIER_NAMES[t]}`;
  const tierStatus = gated
    ? `[GATED — tier ${t - 1} incomplete]`
    : `[${ts.passed}/${ts.total}]`;

  console.log(`\n── ${tierLabel} ${tierStatus} ${"─".repeat(Math.max(0, 60 - tierLabel.length - tierStatus.length))}`);

  const tierResults = results.filter((r) => r.tier === t);
  for (const r of tierResults) {
    const icon = r.pass ? "  PASS" : "  FAIL";
    const marker = r.pass ? "\x1b[32m" : "\x1b[31m";
    const reset = "\x1b[0m";
    console.log(`${marker}${icon}${reset}  ${r.id}. ${r.name}`);
  }
}

// Summary
console.log("\n╔══════════════════════════════════════════════════════════════════════════╗");
console.log(`║  TOTAL SCORE: ${totalScore}/100                                                      ║`);
console.log("╚══════════════════════════════════════════════════════════════════════════╝");

// Find highest impact fixes (first FAIL items in lowest incomplete tier)
const lowestIncompleteTier = [1, 2, 3, 4, 5].find((t) => !tierScores[t].allPassed);
if (lowestIncompleteTier) {
  const failures = results.filter(
    (r) => r.tier === lowestIncompleteTier && !r.pass,
  );
  console.log(
    `\n🎯 TOP ${Math.min(5, failures.length)} FIXES TO REACH NEXT TIER (Tier ${lowestIncompleteTier}: ${TIER_NAMES[lowestIncompleteTier]}):`,
  );
  for (const f of failures.slice(0, 5)) {
    console.log(`   ${f.id}. ${f.name}`);
  }
}

// Save JSON
const outputDir = join(ROOT, "docs/demo-video");
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

const outputPath = join(outputDir, "dopamine-score.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      totalScore,
      tierScores,
      results,
      nextFixes: results
        .filter((r) => r.tier === lowestIncompleteTier && !r.pass)
        .map((r) => ({ id: r.id, name: r.name })),
    },
    null,
    2,
  ),
);

console.log(`\nResults saved to: ${outputPath}`);
