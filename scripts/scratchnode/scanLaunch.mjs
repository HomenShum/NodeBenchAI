#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const shouldRunLive = args.has("--live") || args.has("--interactive");
const shouldRunInteractive = args.has("--interactive");
const shouldPrintJson = args.has("--json");
const shouldFailOnWarn = args.has("--fail-on-warn");
const outPath = resolve(repoRoot, ".tmp/scratchnode-launch-scan.json");

const files = {
  homeV5: "public/proto/home-v5.html",
  docsHtml: "public/proto/docs.html",
  vercel: "vercel.json",
  scratchnodeConfig: "api/scratchnode-config.js",
  events: "convex/events.ts",
  notes: "convex/notes.ts",
  users: "convex/users.ts",
  exportScript: "scripts/repo/export-scratchnode-live-public.mjs",
  goalLoopScript: "scripts/scratchnode/runLaunchGoalLoop.mjs",
  splitRunbook: "docs/runbooks/PUBLIC_SCRATCHNODE_LIVE_SPLIT.md",
  launchRunbook: "docs/runbooks/SCRATCHNODE_LAUNCH_DAY.md",
  goalRunbook: "docs/runbooks/GOAL_MODE_RELEASE_AUTOPILOT.md",
  goalQueue: "goals/README.md",
  scratchnodeGoal: "goals/scratchnode/001-first-time-user-clarity.md",
  nodebenchGoal: "goals/nodebench/001-event-handoff.md",
  runtimeGoal: "goals/runtime/001-public-private-boundary.md",
  demoQa: "qa/run_demo_full.md",
  readme: "README.md",
  license: "LICENSE",
  security: "SECURITY.md",
  contributing: "CONTRIBUTING.md",
};

const staticChecks = [];
const findings = [];
const liveChecks = [];
const interactiveChecks = [];

function readText(relativePath) {
  const absolutePath = resolve(repoRoot, relativePath);
  if (!existsSync(absolutePath)) return "";
  return readFileSync(absolutePath, "utf8");
}

function lineFor(text, index) {
  return text.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function maskPattern(text, pattern) {
  return text.replace(pattern, (match) =>
    match
      .split("")
      .map((char) => (char === "\n" || char === "\r" ? char : " "))
      .join(""),
  );
}

function maskComments(text) {
  return maskPattern(maskPattern(text, /<!--[\s\S]*?-->/g), /\/\*[\s\S]*?\*\//g);
}

function addCheck(check) {
  staticChecks.push({
    ok: !!check.ok,
    name: check.name,
    plane: check.plane ?? "static",
    detail: check.detail ?? "",
    optional: !!check.optional,
  });
}

function addFinding(finding) {
  findings.push({
    id: `SN-${String(findings.length + 1).padStart(3, "0")}`,
    severity: finding.severity ?? "warn",
    safety: finding.safety ?? "human-gated",
    plane: finding.plane ?? "static",
    title: finding.title,
    path: finding.path,
    line: finding.line ?? null,
    detail: finding.detail ?? "",
    recommendation: finding.recommendation ?? "",
  });
}

function addLiveCheck(check) {
  liveChecks.push({
    ok: !!check.ok,
    name: check.name,
    url: check.url,
    status: check.status ?? null,
    durationMs: Math.round(check.durationMs ?? 0),
    detail: check.detail ?? "",
    optional: !!check.optional,
  });
}

function addInteractiveCheck(check) {
  interactiveChecks.push({
    ok: !!check.ok,
    name: check.name,
    url: check.url,
    durationMs: Math.round(check.durationMs ?? 0),
    detail: check.detail ?? "",
    optional: !!check.optional,
  });
}

function checkRequiredFile(relativePath, name = relativePath) {
  const ok = existsSync(resolve(repoRoot, relativePath));
  addCheck({ ok, name: `required file: ${name}`, detail: relativePath });
  if (!ok) {
    addFinding({
      severity: "blocker",
      safety: "manual",
      title: `Missing required launch file: ${name}`,
      path: relativePath,
      recommendation: "Restore or regenerate this file before public launch.",
    });
  }
}

function attrValue(tag, attr) {
  const match = tag.match(new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? null;
}

function hasAttr(tag, attr) {
  return new RegExp(`\\b${attr}\\s*=`, "i").test(tag);
}

function isInsideForm(text, index) {
  const before = text.slice(0, index);
  return before.lastIndexOf("<form") > before.lastIndexOf("</form");
}

function scanHomeV5() {
  const path = files.homeV5;
  const html = readText(path);
  if (!html) return;

  const masked = maskComments(html);

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  addCheck({
    ok: /ScratchNode/i.test(title),
    name: "home-v5 title is ScratchNode branded",
    detail: title,
  });

  const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0] ?? "";
  addCheck({
    ok: /https:\/\/scratchnode\.live\//i.test(canonical),
    name: "home-v5 canonical points at scratchnode.live",
    detail: canonical.slice(0, 180),
  });

  const firstTimeFlow = html.match(/<nav\b[^>]*data-first-time-flow[^>]*>[\s\S]*?<\/nav>/i)?.[0] ?? "";
  const hasFirstTimeClarityRail =
    /aria-label=["']First-time attendee flow["']/i.test(firstTimeFlow) &&
    /data-flow-step=["']join["']/i.test(firstTimeFlow) &&
    /data-flow-step=["']chat["']/i.test(firstTimeFlow) &&
    /data-flow-step=["']ask["']/i.test(firstTimeFlow) &&
    /data-flow-step=["']private-note["']/i.test(firstTimeFlow) &&
    /data-flow-step=["']wiki["']/i.test(firstTimeFlow);
  addCheck({
    ok: hasFirstTimeClarityRail,
    name: "home-v5 has first-time attendee flow rail",
    plane: "product-clarity",
    detail: "join -> chat -> /ask -> private note -> wiki",
  });
  if (!hasFirstTimeClarityRail) {
    addFinding({
      severity: "blocker",
      safety: "human-gated",
      plane: "product-clarity",
      title: "First-time attendee flow rail is missing or incomplete",
      path,
      recommendation:
        "Expose Join, Chat, /ask, Private note, and Wiki as one scannable first-viewport flow in home-v5.",
    });
  }

  const h1Matches = [...masked.matchAll(/<h1\b/gi)];
  addCheck({
    ok: h1Matches.length <= 1,
    name: "home-v5 has at most one static H1",
    detail: `h1Count=${h1Matches.length}`,
    optional: true,
  });
  if (h1Matches.length > 1) {
    addFinding({
      severity: "warn",
      safety: "human-gated",
      title: "Multiple static H1 elements in home-v5",
      path,
      line: lineFor(html, h1Matches[1].index ?? 0),
      detail: `Detected ${h1Matches.length} static H1 tags.`,
      recommendation: "Keep one page-level H1 and downgrade secondary headings after visual review.",
    });
  }

  for (const match of masked.matchAll(/<button\b[^>]*>/gi)) {
    const tag = match[0];
    if (hasAttr(tag, "type")) continue;
    const line = lineFor(html, match.index ?? 0);
    const inForm = isInsideForm(masked, match.index ?? 0);
    addFinding({
      severity: "warn",
      safety: inForm ? "human-gated" : "auto",
      title: inForm ? "Button inside form missing explicit type" : "Button outside form missing type=\"button\"",
      path,
      line,
      detail: tag.slice(0, 180),
      recommendation: inForm
        ? "Review whether the button should submit or be type=\"button\"."
        : "Add type=\"button\"; outside forms this is behavior-preserving.",
    });
  }

  for (const match of masked.matchAll(/<a\b[^>]*target\s*=\s*["']?_blank["']?[^>]*>/gi)) {
    const tag = match[0];
    const rel = attrValue(tag, "rel") ?? "";
    if (/\bnoopener\b/i.test(rel)) continue;
    addFinding({
      severity: "warn",
      safety: "auto",
      title: "target=_blank link missing rel=noopener",
      path,
      line: lineFor(html, match.index ?? 0),
      detail: tag.slice(0, 180),
      recommendation: "Add rel=\"noopener noreferrer\".",
    });
  }

  for (const match of masked.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const line = lineFor(html, match.index ?? 0);
    if (!hasAttr(tag, "alt")) {
      addFinding({
        severity: "warn",
        safety: "auto",
        title: "Image missing alt attribute",
        path,
        line,
        detail: tag.slice(0, 180),
        recommendation: "Add descriptive alt text or alt=\"\" for decorative images.",
      });
    }
    if (line > 2300 && !hasAttr(tag, "loading")) {
      addFinding({
        severity: "warn",
        safety: "auto",
        title: "Likely below-fold image missing lazy loading",
        path,
        line,
        detail: tag.slice(0, 180),
        recommendation: "Add loading=\"lazy\" after confirming it is not first-viewport media.",
      });
    }
  }

  const cssBlocks = [...html.matchAll(/[^{}]+{[^{}]*backdrop-filter\s*:[^{}]*}/gi)];
  for (const match of cssBlocks) {
    const block = match[0];
    if (/-webkit-backdrop-filter\s*:/i.test(block)) continue;
    addFinding({
      severity: "warn",
      safety: "auto",
      title: "backdrop-filter rule missing Safari prefix",
      path,
      line: lineFor(html, match.index ?? 0),
      detail: block.slice(0, 220).replace(/\s+/g, " "),
      recommendation: "Mirror the rule with -webkit-backdrop-filter for iOS Safari.",
    });
  }

  for (const match of html.matchAll(/\bsetInterval\s*\(/g)) {
    const start = Math.max(0, (match.index ?? 0) - 500);
    const end = Math.min(html.length, (match.index ?? 0) + 900);
    const windowText = html.slice(start, end);
    const hasHiddenGuard = /document\.hidden|visibilitychange|clearInterval/i.test(windowText);
    if (!hasHiddenGuard) {
      addFinding({
        severity: "warn",
        safety: "human-gated",
        title: "Polling interval lacks nearby visibility/cleanup guard",
        path,
        line: lineFor(html, match.index ?? 0),
        detail: "setInterval without nearby document.hidden, visibilitychange, or clearInterval signal.",
        recommendation: "Gate polling while document.hidden and clear intervals on teardown where practical.",
      });
    }
  }

  const listenerCount = [...html.matchAll(/\baddEventListener\s*\(/g)].length;
  const removeListenerCount = [...html.matchAll(/\bremoveEventListener\s*\(/g)].length;
  addCheck({
    ok: listenerCount <= 30 || removeListenerCount > 0,
    name: "interactive listener cleanup signal",
    detail: `addEventListener=${listenerCount}, removeEventListener=${removeListenerCount}`,
    optional: true,
  });
  if (listenerCount > 30 && removeListenerCount === 0) {
    addFinding({
      severity: "warn",
      safety: "human-gated",
      title: "Many event listeners with no removeEventListener signal",
      path,
      detail: `Detected ${listenerCount} addEventListener calls and no removeEventListener calls.`,
      recommendation: "Audit lifecycle for route changes, overlays, and repeated event joins.",
    });
  }

  for (const match of html.matchAll(/["']\/scratchnode-events(?:[?#][^"']*)?["']/gi)) {
    addFinding({
      severity: "blocker",
      safety: "manual",
      title: "Relative /scratchnode-events link in ScratchNode shell",
      path,
      line: lineFor(html, match.index ?? 0),
      detail: match[0],
      recommendation: "Use absolute https://nodebenchai.com/scratchnode-events links from scratchnode.live.",
    });
  }

  addCheck({
    ok: /PUBLIC_BASE_URL/.test(html) && /WORKSPACE_BASE_URL/.test(html),
    name: "home-v5 exposes separate ScratchNode and NodeBench base URLs",
    detail: "PUBLIC_BASE_URL and WORKSPACE_BASE_URL present",
  });

  const hasPrivateHandoffContract =
    /function\s+buildNodeBenchEventPrivateUrl\s*\(/.test(html) &&
    /WORKSPACE_BASE_URL[\s\S]{0,240}['"]\/events\/['"][\s\S]{0,240}['"]\/private\?source=scratchnode['"]/.test(html) &&
    /continuation=['"]?\s*\+\s*encodeURIComponent\(['"]private-notes['"]\)/.test(html) &&
    /publicArtifact=['"]?\s*\+\s*encodeURIComponent\(['"]event-wiki['"]\)/.test(html) &&
    /function\s+openNodeBenchPrivateHandoff\s*\(/.test(html);
  addCheck({
    ok: hasPrivateHandoffContract,
    name: "ScratchNode private handoff targets NodeBench event artifact",
    plane: "nodebench-handoff",
    detail: "WORKSPACE_BASE_URL /events/:id with continuation=private-notes and publicArtifact=event-wiki",
  });
  if (!hasPrivateHandoffContract) {
    addFinding({
      severity: "blocker",
      safety: "human-gated",
      plane: "nodebench-handoff",
      title: "NodeBench private handoff URL contract is missing or incomplete",
      path,
      recommendation:
        "Ensure ScratchNode uses WORKSPACE_BASE_URL /events/:eventId and includes continuation=private-notes plus publicArtifact=event-wiki.",
    });
  }

  const hasPrivateAnchorContract =
    /client\.onUpdate\(['"]notes:listMyAnchors['"][\s\S]{0,220}\{\s*ownerKey:\s*noteOwnerKey,\s*eventId\s*\}/i.test(html) &&
    /window\._sn_anchors_by_target\s*=\s*new Map\(\)/i.test(html) &&
    /window\._sn_anchors_by_note\s*=\s*new Map\(\)/i.test(html) &&
    /className\s*=\s*['"]sn-anchor-pin['"]/i.test(html) &&
    /data-anchor-id/i.test(html) &&
    /data-note-id/i.test(html) &&
    /window\._sn_pending_anchor/i.test(html) &&
    /client\.mutation\(['"]notes:createNoteAnchor['"]/i.test(html) &&
    /There is NO public broadcast of anchor data/i.test(html);
  addCheck({
    ok: hasPrivateAnchorContract,
    name: "home-v5 private note anchors are owner-scoped and preservable",
    plane: "privacy",
    detail: "listMyAnchors ownerKey subscription, sn-anchor-pin ids, pending-anchor create path",
  });
  if (!hasPrivateAnchorContract) {
    addFinding({
      severity: "blocker",
      safety: "human-gated",
      plane: "privacy",
      title: "Private note anchor contract is missing or incomplete",
      path,
      recommendation:
        "Ensure private note anchors render from owner-keyed listMyAnchors, expose note/anchor ids for verification, and create anchors through notes:createNoteAnchor only.",
    });
  }

  const hasPrivateAskBranchContract =
    /function\s+parseComposerIntent\s*\(/i.test(html) &&
    /\/ask private[\s\S]{0,140}private notebook save[\s\S]{0,120}no public agent call/i.test(html) &&
    /private note or private \/ask[\s\S]{0,140}never touches public feed or public agent/i.test(html) &&
    /LIVE-006[\s\S]{0,180}private saves privately and does not invoke public agent/i.test(html);
  addCheck({
    ok: hasPrivateAskBranchContract,
    name: "home-v5 private /ask stays on private branch",
    plane: "privacy",
    detail: "/ask private -> private notebook save, no public feed, no public agent",
  });
  if (!hasPrivateAskBranchContract) {
    addFinding({
      severity: "blocker",
      safety: "human-gated",
      plane: "privacy",
      title: "Private /ask branch contract is missing or incomplete",
      path,
      recommendation:
        "Ensure /ask private is parsed as a private notebook save and never reaches public chat, public /ask, or the public agent runtime.",
    });
  }

  const hasRoomWallArtifactContract =
    /class=["']sn-pin["'][\s\S]{0,220}snWall\s*&&\s*window\.snWall\.pinAnswer/i.test(html) &&
    /window\.snSuggestFaq\s*&&\s*window\.snSuggestFaq/i.test(html) &&
    /window\.snPromoteFaq\s*&&\s*window\.snPromoteFaq/i.test(html) &&
    /className\s*=\s*['"]host-queue['"]/i.test(html) &&
    /Promote to FAQ/i.test(html) &&
    /className\s*=\s*['"]published-wiki-card['"]/i.test(html) &&
    /artifact\.published_event_wiki/i.test(html) &&
    /EventArchiveArtifact/i.test(html) &&
    /hostPromotedOnly:\s*true/i.test(html) &&
    /privateNotesExcluded:\s*true/i.test(html);
  addCheck({
    ok: hasRoomWallArtifactContract,
    name: "home-v5 room wall turns public answers into host-promoted wiki artifacts",
    plane: "product-workflow",
    detail: "pin answer + suggest FAQ + host queue promotion + published wiki artifact + private-note exclusion",
  });
  if (!hasRoomWallArtifactContract) {
    addFinding({
      severity: "blocker",
      safety: "human-gated",
      plane: "product-workflow",
      title: "Room wall artifact contract is missing or incomplete",
      path,
      recommendation:
        "Ensure public /ask answers can be pinned to the wall, suggested for FAQ, host-promoted, and compacted into an event-public wiki artifact that excludes private notes.",
    });
  }

  const dailyBriefDeltaIndex = html.indexOf('class="daily-brief-delta"');
  const dailyBriefDeltaBlock = dailyBriefDeltaIndex >= 0 ? html.slice(dailyBriefDeltaIndex, dailyBriefDeltaIndex + 1800) : "";
  const hasDailyBriefDeltaContract =
    /data-delta-source=["']event-artifact["']/i.test(dailyBriefDeltaBlock) &&
    /data-private-notes=["']workspace-only["']/i.test(dailyBriefDeltaBlock) &&
    /What changed/i.test(dailyBriefDeltaBlock) &&
    /Why it matters/i.test(dailyBriefDeltaBlock) &&
    /event wiki and public sources/i.test(dailyBriefDeltaBlock) &&
    /Private notes stay workspace-only/i.test(dailyBriefDeltaBlock);
  addCheck({
    ok: hasDailyBriefDeltaContract,
    name: "NodeBench Daily Brief delta explains changed event artifacts without public private notes",
    plane: "nodebench-handoff",
    detail: "what changed + why it matters + event artifact/wiki source + workspace-only private notes",
  });
  if (!hasDailyBriefDeltaContract) {
    addFinding({
      severity: "blocker",
      safety: "human-gated",
      plane: "nodebench-handoff",
      title: "Daily Brief delta contract is missing or incomplete",
      path,
      recommendation:
        "Ensure the NodeBench handoff explains what changed, why it matters, uses the event artifact/wiki as public source, and keeps private notes workspace-only.",
    });
  }
}

function scanBackendContracts() {
  const events = readText(files.events);
  const notes = readText(files.notes);
  const users = readText(files.users);

  const contracts = [
    {
      name: "events.ts documents public/private boundary",
      ok: /only handles PUBLIC chat/i.test(events) && /Private notes/i.test(events),
      path: files.events,
      blocker: true,
    },
    {
      name: "provider prompt forbids private notes",
      ok: /Do not use or mention private notes/i.test(events),
      path: files.events,
      blocker: true,
    },
    {
      name: "answer trace states private notes are excluded",
      ok: /private notes excluded/i.test(events),
      path: files.events,
      blocker: true,
    },
    {
      name: "semantic cache trace shows source reuse and privacy boundary",
      ok:
        /step:\s*["']semantic_cache_lookup["'][\s\S]{0,360}status:\s*["']ok["'][\s\S]{0,360}source bundle unchanged[\s\S]{0,180}private notes excluded/i.test(events) &&
        /cacheHit:\s*true/i.test(events) &&
        /externalSearches:\s*0/i.test(events) &&
        /computeCacheSkipReason/i.test(events) &&
        /Cached answer skipped/i.test(events),
      path: files.events,
      blocker: true,
    },
    {
      name: "ask work uses idempotency and rate limit preparation",
      ok: /reserveAskSlot|_reserveAskSlot/i.test(events) && /ASK_RATE_LIMIT_PER_MIN/i.test(events),
      path: files.events,
      blocker: true,
    },
    {
      name: "normal sendMessage path is separate from askAgent",
      ok: /export const sendMessage = mutation/i.test(events) && /export const askAgent = action/i.test(events),
      path: files.events,
      blocker: true,
    },
    {
      name: "host-only wiki promotion/publish gate exists",
      ok: /(?:const|function)\s+requireHost/i.test(events) && /promoteAnswerToFaq/i.test(events) && /publishWiki/i.test(events),
      path: files.events,
      blocker: true,
    },
    {
      name: "private notes are owner-key scoped",
      ok: /ownerKey/i.test(notes) && /createNote|listMyNotes/i.test(notes),
      path: files.notes,
      blocker: true,
    },
    {
      name: "ScratchNode sign-in user module exists",
      ok: /Sign in to scratchnode\.live|magic/i.test(users),
      path: files.users,
      blocker: false,
    },
  ];

  for (const contract of contracts) {
    addCheck({
      ok: contract.ok,
      name: contract.name,
      plane: "backend-contract",
      detail: contract.path,
    });
    if (!contract.ok) {
      addFinding({
        severity: contract.blocker ? "blocker" : "warn",
        safety: "human-gated",
        plane: "backend-contract",
        title: `Backend contract signal missing: ${contract.name}`,
        path: contract.path,
        recommendation: "Inspect the backend implementation and tests before launch.",
      });
    }
  }
}

function scanPublicRepoReadiness() {
  for (const relativePath of [
    files.exportScript,
    files.goalLoopScript,
    files.splitRunbook,
    files.launchRunbook,
    files.goalRunbook,
    files.goalQueue,
    files.scratchnodeGoal,
    files.nodebenchGoal,
    files.runtimeGoal,
    files.demoQa,
    files.license,
    files.security,
    files.contributing,
  ]) {
    checkRequiredFile(relativePath);
  }

  const exportScript = readText(files.exportScript);
  const splitRunbook = readText(files.splitRunbook);
  const readme = readText(files.readme);

  addCheck({
    ok: /Explicit Exclusions/i.test(splitRunbook) && /convex\//i.test(splitRunbook),
    name: "public split runbook documents monorepo exclusions",
    plane: "public-repo",
    detail: files.splitRunbook,
  });
  addCheck({
    ok: /forbidden|sensitive|allowlist/i.test(exportScript),
    name: "public export script scans allowlist/sensitive output",
    plane: "public-repo",
    detail: files.exportScript,
  });
  addCheck({
    ok: /ScratchNode|NodeBench/i.test(readme),
    name: "root README names product context",
    plane: "public-repo",
    detail: files.readme,
    optional: true,
  });
}

function scanGoalAutomationReadiness() {
  const packageJson = readText("package.json");
  const goalRunbook = readText(files.goalRunbook);
  const goalLoopScript = readText(files.goalLoopScript);
  const launchRunbook = readText(files.launchRunbook);

  const checks = [
    {
      name: "package exposes ScratchNode launch goal loop script",
      ok: /"scratchnode:launch:goal"\s*:\s*"node scripts\/scratchnode\/runLaunchGoalLoop\.mjs"/i.test(packageJson),
      path: "package.json",
      blocker: true,
      detail: "scratchnode:launch:goal",
    },
    {
      name: "goal loop runs housekeeping and launch interaction gates",
      ok: /repo:housekeeping:check/i.test(goalLoopScript) && /scratchnode:launch:interactive/i.test(goalLoopScript),
      path: files.goalLoopScript,
      blocker: true,
      detail: "housekeeping + static/live/interactive launch checks",
    },
    {
      name: "goal loop writes durable .tmp report",
      ok: /scratchnode-launch-goal-loop\.json/i.test(goalLoopScript) && /notifyRecommended/i.test(goalLoopScript),
      path: files.goalLoopScript,
      blocker: true,
      detail: ".tmp/scratchnode-launch-goal-loop.json",
    },
    {
      name: "goal loop carries continuous development backlog",
      ok:
        /developmentBacklog/i.test(goalLoopScript) &&
        /nextDevelopmentCandidate/i.test(goalLoopScript) &&
        /safe-local-development/i.test(goalLoopScript),
      path: files.goalLoopScript,
      blocker: true,
      detail: "developmentBacklog + nextDevelopmentCandidate",
    },
    {
      name: "goal loop reads durable repo goal queue",
      ok: /readGoalQueue/i.test(goalLoopScript) && /goalQueue/i.test(goalLoopScript),
      path: files.goalLoopScript,
      blocker: true,
      detail: "goals/**/*.md -> goalQueue",
    },
    {
      name: "goal loop ignores non-card Markdown queue docs",
      ok:
        /frontmatter\.id/i.test(goalLoopScript) &&
        /frontmatter\.status/i.test(goalLoopScript) &&
        /frontmatter\.mode/i.test(goalLoopScript) &&
        /\.filter\(Boolean\)/i.test(goalLoopScript),
      path: files.goalLoopScript,
      blocker: true,
      detail: "requires explicit goal-card frontmatter before backlog inclusion",
    },
    {
      name: "goal loop covers both ScratchNode and NodeBench improvement axes",
      ok: /ScratchNode product workflow/i.test(goalLoopScript) && /NodeBench handoff/i.test(goalLoopScript),
      path: files.goalLoopScript,
      blocker: true,
      detail: "ScratchNode product workflow + NodeBench handoff",
    },
    {
      name: "goal loop preserves production mutation boundary",
      ok:
        /read-only against production/i.test(goalLoopScript) &&
        /sending chat|creating events|publishing wikis|mutating live user data/i.test(goalLoopScript),
      path: files.goalLoopScript,
      blocker: true,
      detail: "no live chat/event/wiki mutations",
    },
    {
      name: "goal runbook treats /goal as stop condition",
      ok: /goal is not a normal prompt/i.test(goalRunbook) && /stop condition/i.test(goalRunbook),
      path: files.goalRunbook,
      blocker: true,
      detail: files.goalRunbook,
    },
    {
      name: "goal runbook captures self-directed workflow pattern",
      ok:
        /batched issue queue/i.test(goalRunbook) &&
        /specialist passes/i.test(goalRunbook) &&
        /cost\/effort accounting/i.test(goalRunbook),
      path: files.goalRunbook,
      blocker: false,
      detail: "batch queue + focused passes + cost accounting",
    },
    {
      name: "launch runbook includes goal-loop cron command",
      ok: /scratchnode:launch:goal/i.test(launchRunbook),
      path: files.launchRunbook,
      blocker: false,
      detail: files.launchRunbook,
    },
  ];

  for (const check of checks) {
    addCheck({
      ok: check.ok,
      name: check.name,
      plane: "goal-automation",
      detail: check.detail,
      optional: !check.blocker,
    });
    if (!check.ok) {
      addFinding({
        severity: check.blocker ? "blocker" : "warn",
        safety: "human-gated",
        plane: "goal-automation",
        title: `Goal automation signal missing: ${check.name}`,
        path: check.path,
        recommendation: "Restore the goal-loop contract before relying on unattended launch automation.",
      });
    }
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "nodebench-scratchnode-launch-scan/1.0",
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = options.body === false ? "" : await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      contentType,
      body,
      durationMs: performance.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runHttpCheck(name, url, validate, options = {}) {
  try {
    const result = await fetchWithTimeout(url, options);
    const validation = validate(result);
    addLiveCheck({
      ok: result.ok && validation.ok,
      name,
      url,
      status: result.status,
      durationMs: result.durationMs,
      detail: validation.detail,
      optional: options.optional,
    });
  } catch (error) {
    addLiveCheck({
      ok: false,
      name,
      url,
      detail: error instanceof Error ? error.message : String(error),
      optional: options.optional,
    });
  }
}

function isInteractiveNetworkDenied(detail) {
  return /ERR_NETWORK_ACCESS_DENIED|Network access denied/i.test(detail ?? "");
}

function isLiveNetworkDenied(detail) {
  return isInteractiveNetworkDenied(detail) || /fetch failed/i.test(detail ?? "");
}

function summarizeRemoteProbeInfra({ liveFailures, interactiveFailures }) {
  const interactiveNetworkDenied =
    shouldRunInteractive &&
    interactiveChecks.length > 0 &&
    interactiveFailures.length === interactiveChecks.length &&
    interactiveFailures.every((check) => isInteractiveNetworkDenied(check.detail));
  const liveNetworkDenied =
    shouldRunLive &&
    liveChecks.length > 0 &&
    liveFailures.length === liveChecks.length &&
    liveFailures.every((check) => isLiveNetworkDenied(check.detail));
  const networkAccessDenied = interactiveNetworkDenied && (!shouldRunLive || liveNetworkDenied);

  return {
    networkAccessDenied,
    liveNetworkDenied,
    interactiveNetworkDenied,
    reason: networkAccessDenied ? "remote probes blocked by local network restrictions" : "",
    suppressedLiveFailures: networkAccessDenied ? liveFailures.length : 0,
    suppressedInteractiveFailures: networkAccessDenied ? interactiveFailures.length : 0,
  };
}

function headSignals(html) {
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? html.slice(0, 8000);
  return {
    head,
    title: head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "",
    canonical: head.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0] ?? "",
    ogTitle: head.match(/<meta\b[^>]*property=["']og:title["'][^>]*>/i)?.[0] ?? "",
    ogDescription: head.match(/<meta\b[^>]*property=["']og:description["'][^>]*>/i)?.[0] ?? "",
  };
}

async function runLiveChecks() {
  await runHttpCheck("scratchnode.live apex raw HTML", "https://scratchnode.live/", (result) => {
    const signals = headSignals(result.body);
    const ok =
      /ScratchNode/i.test(signals.title) &&
      /scratchnode\.live/i.test(signals.canonical) &&
      /ScratchNode/i.test(signals.ogTitle) &&
      !/AI Infra Summit/i.test(signals.title + signals.ogTitle + signals.ogDescription + signals.canonical);
    return {
      ok,
      detail: `title=${JSON.stringify(signals.title)}, canonical=${signals.canonical.slice(0, 140)}`,
    };
  });

  await runHttpCheck("scratchnode.live event route shell", "https://scratchnode.live/e/ai-infra-summit-2026", (result) => {
    const signals = headSignals(result.body);
    return {
      ok: /ScratchNode/i.test(signals.title) && /<html/i.test(result.body),
      detail: `title=${JSON.stringify(signals.title)}, bytes=${result.body.length}`,
    };
  });

  await runHttpCheck("scratchnode.live stale demo query does not alter raw event shell", "https://scratchnode.live/e/ai-infra-summit-2026?demo=1", (result) => {
    const signals = headSignals(result.body);
    return {
      ok: /ScratchNode/i.test(signals.title) && !/demo_ver/i.test(result.url),
      detail: `finalUrl=${result.url}, title=${JSON.stringify(signals.title)}`,
    };
  });

  await runHttpCheck("scratchnode.live demo route reachable", "https://scratchnode.live/demo_ver1", (result) => ({
    ok: /demoVerMatch|runDemoFull|ScratchNode/i.test(result.body),
    detail: `bytes=${result.body.length}`,
  }));

  await runHttpCheck("scratchnode public config endpoint", "https://scratchnode.live/api/scratchnode-config", (result) => {
    try {
      const json = JSON.parse(result.body);
      const keys = Object.keys(json).sort();
      const hasOnlyPublicShape =
        keys.includes("convexUrl") &&
        !keys.some((key) => /secret|token|key|password/i.test(key));
      return { ok: hasOnlyPublicShape, detail: `keys=${keys.join(",")}` };
    } catch {
      return { ok: false, detail: "response is not JSON" };
    }
  });

  await runHttpCheck("scratchnode OG image", "https://scratchnode.live/og-scratchnode.png", (result) => ({
    ok: /image\/png/i.test(result.contentType) && result.body.length > 1000,
    detail: `contentType=${result.contentType}, bytes=${result.body.length}`,
  }));

  await runHttpCheck("scratchnode missing-room route shell", "https://scratchnode.live/e/zzz-does-not-exist-zzz", (result) => ({
    ok: /ScratchNode/i.test(headSignals(result.body).title) && /<html/i.test(result.body),
    detail: `status=${result.status}, bytes=${result.body.length}`,
  }));

  await runHttpCheck("nodebenchai.com apex", "https://nodebenchai.com/", (result) => {
    const signals = headSignals(result.body);
    return {
      ok: /NodeBench/i.test(signals.title) || /id=["']root["']/i.test(result.body),
      detail: `finalUrl=${result.url}, title=${JSON.stringify(signals.title)}`,
    };
  });

  await runHttpCheck("www.nodebenchai.com apex", "https://www.nodebenchai.com/", (result) => {
    const signals = headSignals(result.body);
    return {
      ok: /NodeBench/i.test(signals.title) || /id=["']root["']/i.test(result.body),
      detail: `finalUrl=${result.url}, title=${JSON.stringify(signals.title)}`,
    };
  });

  await runHttpCheck("nodebenchai.com scratchnode-events route", "https://nodebenchai.com/scratchnode-events", (result) => ({
    ok: /id=["']root["']/i.test(result.body) && !/sidecar event rooms with memory/i.test(headSignals(result.body).title),
    detail: `finalUrl=${result.url}, title=${JSON.stringify(headSignals(result.body).title)}`,
  }));
}

async function runInteractiveChecks() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    addInteractiveCheck({
      ok: false,
      name: "Playwright import",
      url: "local",
      detail: error instanceof Error ? error.message : String(error),
      optional: true,
    });
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "nodebench-scratchnode-launch-scan/interactive",
  });

  async function pageCheck(name, url, validate) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const started = performance.now();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const result = await validate(page, consoleErrors);
      addInteractiveCheck({
        ok: !!result.ok,
        name,
        url,
        durationMs: performance.now() - started,
        detail: result.detail,
      });
    } catch (error) {
      addInteractiveCheck({
        ok: false,
        name,
        url,
        durationMs: performance.now() - started,
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await page.close().catch(() => {});
    }
  }

  await pageCheck("scratchnode apex interactive landing", "https://scratchnode.live/", async (page, consoleErrors) => {
    await page.waitForSelector("body", { timeout: 10_000 });
    const data = await page.evaluate(() => ({
      title: document.title,
      pageMode: document.body.getAttribute("data-page-mode"),
      hasJoinInput: !!document.querySelector("#landing-code, #ci"),
      buttonCount: document.querySelectorAll("button").length,
    }));
    return {
      ok: /ScratchNode/i.test(data.title) && data.hasJoinInput && data.buttonCount > 0,
      detail: `title=${JSON.stringify(data.title)}, pageMode=${data.pageMode}, buttons=${data.buttonCount}, consoleErrors=${consoleErrors.length}`,
    };
  });

  await pageCheck("scratchnode event route interactive", "https://scratchnode.live/e/ai-infra-summit-2026?demo=1", async (page) => {
    await page.waitForFunction(() => document.body.getAttribute("data-page-mode") === "event", null, { timeout: 15_000 });
    const data = await page.evaluate(() => ({
      pageMode: document.body.getAttribute("data-page-mode"),
      live: document.body.getAttribute("data-sn-live"),
      fullDemoAllowed: globalThis.shouldRunScratchNodeFullDemo?.(),
      composerDisabled: document.querySelector("#ci")?.hasAttribute("disabled") ?? null,
      hasAskHint: /\/ask/i.test(document.body.textContent ?? ""),
    }));
    return {
      ok: data.pageMode === "event" && data.fullDemoAllowed === false && data.hasAskHint,
      detail: JSON.stringify(data),
    };
  });

  await pageCheck("scratchnode event workflow affordances", "https://scratchnode.live/e/ai-infra-summit-2026", async (page) => {
    await page.waitForFunction(() => document.body.getAttribute("data-page-mode") === "event", null, { timeout: 15_000 });
    const data = await page.evaluate(() => {
      const bodyText = document.body.textContent ?? "";
      const buttonsAndLinks = [...document.querySelectorAll("button, a")]
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean);
      const isVisible = (node) => {
        const style = getComputedStyle(node);
        return style.display !== "none" &&
          style.visibility !== "hidden" &&
          node.getClientRects().length > 0;
      };
      const visibleButtonsAndLinks = [...document.querySelectorAll("button, a")]
        .filter(isVisible)
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean);
      const rowTexts = [...document.querySelectorAll(".row-text")]
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean);
      const answerQuestions = [...document.querySelectorAll(".ans-q")]
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean);
      const answerTexts = [...document.querySelectorAll(".ans")]
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean);
      const firstFlowSteps = [...document.querySelectorAll("[data-first-time-flow] [data-flow-step]")]
        .map((node) => ({
          step: node.getAttribute("data-flow-step") ?? "",
          text: node.textContent?.replace(/\s+/g, " ").trim() ?? "",
        }))
        .filter((item) => item.step);
      const normalizeQuestion = (text) => text.trim().replace(/[?.!]+$/, "").toLowerCase();
      const askQuestions = rowTexts
        .filter((text) => /^\/ask\b/i.test(text))
        .map((text) => normalizeQuestion(text.replace(/^\/ask\b/i, "")))
        .filter(Boolean);
      const composerPlaceholder = document.querySelector("#ci")?.getAttribute("placeholder") ?? "";
      const visibleActionText = `${visibleButtonsAndLinks.join(" | ")} ${composerPlaceholder}`;
      const firstFlowStepOrder = firstFlowSteps.map((item) => item.step).join("|");
      const hasPrivateNotesAffordance =
        !!document.querySelector("#lock") &&
        /My private notes|private notes/i.test(bodyText);
      return {
        composerPlaceholder,
        hasAskParentRow: rowTexts.some((text) => /^\/ask\b/i.test(text)),
        hasNestedAnswer: askQuestions.some((question) =>
          answerQuestions.some((answerQuestion) => normalizeQuestion(answerQuestion) === question),
        ),
        allAgentAnswersHaveAskParents:
          answerQuestions.length > 0 &&
          answerQuestions.every((answerQuestion) => askQuestions.includes(normalizeQuestion(answerQuestion))),
        hasPublicTraceBoundary: answerTexts.some((text) => /no private notes|private notes excluded/i.test(text)),
        hasSharedAnswerCostSummary: answerTexts.some((text) =>
          /Answered from event wiki/i.test(text) &&
          /\d+\s+similar questions/i.test(text) &&
          /\d+\s+sources reused/i.test(text) &&
          /0\s+new searches/i.test(text),
        ),
        hasTraceHonestySteps: answerTexts.some((text) =>
          /event wiki cache/i.test(text) &&
          /semantic cache/i.test(text) &&
          /No private notes used|public layer only/i.test(text),
        ),
        firstFlowSteps,
        visibleButtonsAndLinks: visibleButtonsAndLinks.slice(0, 16),
        firstFlowStepOrder,
        hasOrderedFirstFlow: firstFlowStepOrder === "join|chat|ask|private-note|wiki",
        hasVisibleFirstFlowAffordances:
          /ORBITAL|room code/i.test(visibleActionText) &&
          /\bChat\b/i.test(visibleActionText) &&
          /\/ask|Ask the first question/i.test(visibleActionText) &&
          /private notes|\bnotes\b|🔒/i.test(visibleActionText) &&
          /open wiki|view in wiki/i.test(visibleActionText),
        hasVisibleFirstFlowAffordancesFromControls:
          /ORBITAL|room code/i.test(visibleActionText) &&
          /\bChat\b/i.test(visibleActionText) &&
          /\/ask|Ask the first question/i.test(visibleActionText) &&
          hasPrivateNotesAffordance &&
          /open wiki|view in wiki/i.test(visibleActionText),
        hasFaqSuggestion: buttonsAndLinks.some((text) => /suggest for faq/i.test(text)),
        hasHostFaqPromotion: buttonsAndLinks.some((text) => /promote to faq/i.test(text)),
        hasWikiContinuation: buttonsAndLinks.some((text) => /open wiki|view in wiki/i.test(text)),
        hasPrivateNotesAffordance,
      };
    });
    const ok =
      /\/ask/i.test(data.composerPlaceholder) &&
      data.hasAskParentRow &&
      data.hasNestedAnswer &&
      data.allAgentAnswersHaveAskParents &&
      data.hasPublicTraceBoundary &&
      data.hasSharedAnswerCostSummary &&
      data.hasTraceHonestySteps &&
      (data.hasOrderedFirstFlow || data.hasVisibleFirstFlowAffordances || data.hasVisibleFirstFlowAffordancesFromControls) &&
      data.hasFaqSuggestion &&
      data.hasHostFaqPromotion &&
      data.hasWikiContinuation &&
      data.hasPrivateNotesAffordance;
    return {
      ok,
      detail: JSON.stringify(data),
    };
  });

  await pageCheck("scratchnode event interactive components", "https://scratchnode.live/e/ai-infra-summit-2026", async (page) => {
    await page.waitForFunction(() => typeof globalThis.openWiki === "function", null, { timeout: 15_000 });
    const data = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
      const readSheetTitle = () => document.querySelector("#sheet-title")?.textContent?.trim() ?? "";
      const readSheetText = () => document.querySelector("#sheet-content")?.textContent?.trim() ?? "";
      const close = () => {
        if (typeof globalThis.closeSheet === "function") globalThis.closeSheet();
      };

      const functions = [
        "openWiki",
        "openPeople",
        "openShare",
        "openNotes",
        "openMenu",
        "closeMenu",
        "openNodeBenchPrivateHandoff",
        "buildNodeBenchEventPrivateUrl",
        "buildNodeBenchSignInUrl",
        "toggleLock",
        "openModePicker",
        "openCaptureLevelPicker",
      ].filter((name) => typeof globalThis[name] === "function");

      globalThis.openWiki();
      await sleep(250);
      const wikiTitle = readSheetTitle();
      const wikiText = readSheetText();
      close();

      globalThis.openPeople();
      await sleep(250);
      const peopleTitle = readSheetTitle();
      const peopleText = readSheetText();
      close();

      globalThis.openShare();
      await sleep(250);
      const shareTitle = readSheetTitle();
      const shareText = readSheetText();
      const shareUrl = document.querySelector(".share-url-box code")?.textContent?.trim() ?? "";
      const shareCopyButtonText = document.querySelector(".share-url-box button")?.textContent?.trim() ?? "";
      const shareHasPublicEventUrl = /https:\/\/scratchnode\.live\/e\/ai-infra-summit-2026/i.test(shareUrl || shareText);
      const shareHasCopyAction = /copy/i.test(shareCopyButtonText);
      const shareHasRoomCode = /Live room code\s+ORBITAL|code\s+ORBITAL|ORBITAL/i.test(shareText);
      const shareQrImage = [...document.querySelectorAll("#sheet-content img")]
        .map((img) => ({
          alt: img.getAttribute("alt") ?? "",
          src: img.getAttribute("src") ?? "",
        }))
        .find((img) => /qr/i.test(img.alt) || /create-qr-code/i.test(img.src));
      const shareHasMobileQrPrompt = /scan to join on mobile/i.test(shareText);
      const shareQrTargetsRoom =
        !!shareQrImage &&
        /create-qr-code/i.test(shareQrImage.src) &&
        /scratchnode\.live%2Fe%2Fai-infra-summit-2026/i.test(shareQrImage.src) &&
        /room%3DORBITAL/i.test(shareQrImage.src);
      const shareHasSocialActions = ["Post on X", "LinkedIn", "Email", "More"]
        .every((label) => new RegExp(label, "i").test(shareText));
      close();

      globalThis.openNotes();
      await sleep(250);
      const notesText = readSheetText();
      close();

      const lock = document.querySelector("#lock");
      const beforePrivate = lock?.getAttribute("data-on");
      globalThis.toggleLock();
      await sleep(50);
      const afterPrivate = lock?.getAttribute("data-on");
      globalThis.toggleLock();

      const wallEl = document.querySelector("#sn-wall");
      const wallControllerReady = !!globalThis.snWall && typeof globalThis.snWall.show === "function";
      const wallTabVisible = [...document.querySelectorAll("[data-rt]")]
        .some((node) => /wall/i.test(node.textContent ?? ""));
      if (wallControllerReady) {
        globalThis.snWall.show("wall");
        await sleep(100);
      }
      const wallShown =
        wallEl?.getAttribute("data-on") === "true" &&
        wallEl?.getAttribute("aria-hidden") === "false";
      if (wallControllerReady) {
        globalThis.snWall.show("chat");
        await sleep(100);
      }
      const wallHidden =
        wallEl?.getAttribute("data-on") === "false" &&
        wallEl?.getAttribute("aria-hidden") === "true";

      const menuControllerReady =
        typeof globalThis.openMenu === "function" &&
        typeof globalThis.closeMenu === "function";
      const attendeeMenuRole = document.body.getAttribute("data-role") ?? "";
      const visibleMenuItems = () => [...document.querySelectorAll("#menu-sheet button, #menu-sheet h4")]
        .filter((node) => {
          const style = getComputedStyle(node);
          return style.display !== "none" &&
            style.visibility !== "hidden" &&
            node.getClientRects().length > 0;
        })
        .map((node) => ({
          text: node.textContent?.replace(/\s+/g, " ").trim() ?? "",
          onclick: node.getAttribute("onclick") ?? "",
        }))
        .filter((item) => item.text);
      const checkNodeBenchHandoffUrl = (urlText) => {
        try {
          const url = new URL(urlText);
          return url.origin === "https://nodebenchai.com" &&
            url.pathname === "/events/ai-infra-summit-2026/private" &&
            url.searchParams.get("source") === "scratchnode" &&
            url.searchParams.get("room") === "ORBITAL" &&
            url.searchParams.get("continuation") === "private-notes" &&
            url.searchParams.get("publicArtifact") === "event-wiki" &&
            url.searchParams.get("return") === "https://scratchnode.live/e/ai-infra-summit-2026";
        } catch {
          return false;
        }
      };
      const checkNodeBenchSignInUrl = (urlText, expectedReturn) => {
        try {
          const url = new URL(urlText);
          return url.origin === "https://nodebenchai.com" &&
            url.pathname === "/sign-in" &&
            url.searchParams.get("intent") === "save-private-notes" &&
            url.searchParams.get("return") === expectedReturn;
        } catch {
          return false;
        }
      };
      let attendeeMenuItems = [];
      let attendeeMenuText = "";
      if (menuControllerReady) {
        globalThis.openMenu();
        await sleep(100);
        attendeeMenuItems = visibleMenuItems();
        attendeeMenuText = attendeeMenuItems.map((item) => item.text).join(" | ");
        globalThis.closeMenu();
        await sleep(50);
      }
      const attendeeMenuHasWiki = /Public wiki/i.test(attendeeMenuText);
      const attendeeMenuHasShare = /Share/i.test(attendeeMenuText);
      const attendeeMenuHasNodeBench = /Continue in NodeBench/i.test(attendeeMenuText);
      const attendeeMenuHidesHostConsole = !/Host console/i.test(attendeeMenuText);
      const attendeeMenuNodeBenchItem = attendeeMenuItems.find((item) => /Continue in NodeBench/i.test(item.text));
      const attendeeMenuNodeBenchCallsHandoff =
        !!attendeeMenuNodeBenchItem &&
        /openNodeBenchPrivateHandoff\(\)/i.test(attendeeMenuNodeBenchItem.onclick);
      const nodeBenchHandoffUrl = typeof globalThis.buildNodeBenchEventPrivateUrl === "function"
        ? globalThis.buildNodeBenchEventPrivateUrl()
        : "";
      const nodeBenchSignInUrl = typeof globalThis.buildNodeBenchSignInUrl === "function"
        ? globalThis.buildNodeBenchSignInUrl(nodeBenchHandoffUrl)
        : "";
      const nodeBenchHandoffUrlOk = checkNodeBenchHandoffUrl(nodeBenchHandoffUrl);
      const nodeBenchSignInUrlOk = checkNodeBenchSignInUrl(nodeBenchSignInUrl, nodeBenchHandoffUrl);

      return {
        functions,
        wikiTitle,
        wikiText: wikiText.slice(0, 160),
        peopleTitle,
        peopleText: peopleText.slice(0, 160),
        shareTitle,
        shareUrl,
        shareCopyButtonText,
        shareText: shareText.slice(0, 160),
        shareHasPublicEventUrl,
        shareHasCopyAction,
        shareHasRoomCode,
        shareHasMobileQrPrompt,
        shareQrImage,
        shareQrTargetsRoom,
        shareHasSocialActions,
        notesText: notesText.slice(0, 160),
        beforePrivate,
        afterPrivate,
        wallControllerReady,
        wallTabVisible,
        wallShown,
        wallHidden,
        menuControllerReady,
        attendeeMenuRole,
        attendeeMenuText: attendeeMenuText.slice(0, 180),
        attendeeMenuNodeBenchItem,
        attendeeMenuHasWiki,
        attendeeMenuHasShare,
        attendeeMenuHasNodeBench,
        attendeeMenuHidesHostConsole,
        attendeeMenuNodeBenchCallsHandoff,
        nodeBenchHandoffUrl,
        nodeBenchSignInUrl,
        nodeBenchHandoffUrlOk,
        nodeBenchSignInUrlOk,
      };
    });
    const ok =
      data.functions.length >= 12 &&
      /Wiki/i.test(data.wikiTitle) &&
      /People/i.test(data.peopleTitle) &&
      /Share/i.test(data.shareTitle) &&
      data.shareHasPublicEventUrl &&
      data.shareHasCopyAction &&
      data.shareHasRoomCode &&
      data.shareHasMobileQrPrompt &&
      data.shareQrTargetsRoom &&
      data.shareHasSocialActions &&
      /private|notes/i.test(data.notesText) &&
      data.beforePrivate !== data.afterPrivate &&
      data.wallControllerReady &&
      data.wallTabVisible &&
      data.wallShown &&
      data.wallHidden &&
      data.menuControllerReady &&
      data.attendeeMenuRole === "attendee" &&
      data.attendeeMenuHasWiki &&
      data.attendeeMenuHasShare &&
      data.attendeeMenuHasNodeBench &&
      data.attendeeMenuHidesHostConsole &&
      data.attendeeMenuNodeBenchCallsHandoff &&
      data.nodeBenchHandoffUrlOk &&
      data.nodeBenchSignInUrlOk;
    return {
      ok,
      detail: JSON.stringify(data),
    };
  });

  await pageCheck("scratchnode demo route interactive", "https://scratchnode.live/demo_ver1?demoSpeed=instant", async (page) => {
    await page.waitForFunction(() => document.body.getAttribute("data-page-mode") === "demo", null, { timeout: 15_000 });
    await page.waitForTimeout(1000);
    const data = await page.evaluate(() => ({
      pageMode: document.body.getAttribute("data-page-mode"),
      fullDemoAllowed: globalThis.shouldRunScratchNodeFullDemo?.(),
      demoLogLength: Array.isArray(globalThis._demo_log) ? globalThis._demo_log.length : 0,
      buttonCount: document.querySelectorAll("button").length,
    }));
    return {
      ok: data.pageMode === "demo" && data.fullDemoAllowed === true && data.buttonCount > 0,
      detail: JSON.stringify(data),
    };
  });

  await pageCheck("nodebench apex interactive", "https://nodebenchai.com/", async (page) => {
    await page.waitForSelector("body", { timeout: 15_000 });
    const data = await page.evaluate(() => ({
      title: document.title,
      hasRoot: !!document.querySelector("#root"),
      bodyText: (document.body.textContent ?? "").slice(0, 300),
    }));
    return {
      ok: /NodeBench/i.test(data.title) || data.hasRoot,
      detail: `title=${JSON.stringify(data.title)}, hasRoot=${data.hasRoot}`,
    };
  });

  await pageCheck("nodebench scratchnode-events interactive", "https://nodebenchai.com/scratchnode-events", async (page) => {
    await page.waitForSelector("body", { timeout: 15_000 });
    await page.waitForTimeout(1200);
    const data = await page.evaluate(() => ({
      title: document.title,
      hasRoot: !!document.querySelector("#root"),
      text: (document.body.textContent ?? "").slice(0, 800),
      scratchnodeActions: [...document.querySelectorAll("a,button")]
        .map((el) => ({
          text: el.textContent?.trim() ?? "",
          href: el instanceof HTMLAnchorElement ? el.href : "",
        }))
        .filter((item) => /ScratchNode|event|open|join/i.test(`${item.text} ${item.href}`))
        .slice(0, 12),
    }));
    return {
      ok: data.hasRoot && /ScratchNode|events|NodeBench/i.test(data.text + data.title) && data.scratchnodeActions.length > 0,
      detail: `title=${JSON.stringify(data.title)}, hasRoot=${data.hasRoot}, actions=${data.scratchnodeActions.length}`,
    };
  });

  await pageCheck("nodebench scratchnode-events handoff empty-state contract", "https://nodebenchai.com/scratchnode-events", async (page) => {
    await page.waitForSelector("body", { timeout: 15_000 });
    await page.waitForTimeout(1200);
    const data = await page.evaluate(() => {
      const text = (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
      const scratchnodeLinks = [...document.querySelectorAll("a")]
        .map((link) => ({
          text: link.textContent?.replace(/\s+/g, " ").trim() ?? "",
          href: link.href,
        }))
        .filter((link) => /scratchnode\.live/i.test(link.href));
      return {
        title: document.title,
        hasRoot: !!document.querySelector("#root"),
        hasHandoffTitle: /ScratchNode\s*(?:->|→)\s*NodeBench/i.test(text),
        hasNoSessionState: /No ScratchNode session/i.test(text),
        hasPrivateNotesContinuation: /private notes will appear/i.test(text),
        scratchnodeLinks,
      };
    });
    const ok =
      /NodeBench/i.test(data.title) &&
      data.hasRoot &&
      data.hasHandoffTitle &&
      data.hasNoSessionState &&
      data.hasPrivateNotesContinuation &&
      data.scratchnodeLinks.some((link) => link.href === "https://scratchnode.live/" || link.href.startsWith("https://scratchnode.live/?"));
    return {
      ok,
      detail: JSON.stringify({
        title: data.title,
        hasRoot: data.hasRoot,
        hasHandoffTitle: data.hasHandoffTitle,
        hasNoSessionState: data.hasNoSessionState,
        hasPrivateNotesContinuation: data.hasPrivateNotesContinuation,
        scratchnodeLinks: data.scratchnodeLinks.slice(0, 3),
      }),
    };
  });

  await browser.close();
}

function summarize() {
  const requiredStaticFailures = staticChecks.filter((check) => !check.ok && !check.optional);
  const blockerFindings = findings.filter((finding) => finding.severity === "blocker");
  const warnFindings = findings.filter((finding) => finding.severity === "warn");
  const liveFailures = liveChecks.filter((check) => !check.ok && !check.optional);
  const interactiveFailures = interactiveChecks.filter((check) => !check.ok && !check.optional);
  const remoteProbeInfra = summarizeRemoteProbeInfra({ liveFailures, interactiveFailures });
  const effectiveLiveFailures = remoteProbeInfra.networkAccessDenied ? [] : liveFailures;
  const effectiveInteractiveFailures = remoteProbeInfra.networkAccessDenied ? [] : interactiveFailures;
  const passed =
    requiredStaticFailures.length === 0 &&
    blockerFindings.length === 0 &&
    effectiveLiveFailures.length === 0 &&
    effectiveInteractiveFailures.length === 0 &&
    (!shouldFailOnWarn || warnFindings.length === 0);

  return {
    passed,
    staticPassed: requiredStaticFailures.length === 0 && blockerFindings.length === 0,
    livePassed: effectiveLiveFailures.length === 0,
    interactivePassed: effectiveInteractiveFailures.length === 0,
    requiredStaticFailures: requiredStaticFailures.length,
    blockers: blockerFindings.length,
    warnings: warnFindings.length,
    autoSafeFindings: findings.filter((finding) => finding.safety === "auto").length,
    humanGatedFindings: findings.filter((finding) => finding.safety === "human-gated").length,
    liveFailures: effectiveLiveFailures.length,
    interactiveFailures: effectiveInteractiveFailures.length,
    rawLiveFailures: liveFailures.length,
    rawInteractiveFailures: interactiveFailures.length,
    remoteProbeInfra,
    staticChecks: staticChecks.length,
    liveChecks: liveChecks.length,
    interactiveChecks: interactiveChecks.length,
  };
}

async function main() {
  checkRequiredFile(files.homeV5);
  checkRequiredFile(files.vercel);
  checkRequiredFile(files.scratchnodeConfig);
  scanHomeV5();
  scanBackendContracts();
  scanPublicRepoReadiness();
  scanGoalAutomationReadiness();

  if (shouldRunLive) await runLiveChecks();
  if (shouldRunInteractive) await runInteractiveChecks();

  const report = {
    generatedAt: new Date().toISOString(),
    repo: repoRoot,
    modes: {
      static: true,
      live: shouldRunLive,
      interactive: shouldRunInteractive,
      failOnWarn: shouldFailOnWarn,
    },
    summary: summarize(),
    findings,
    staticChecks,
    liveChecks,
    interactiveChecks,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (shouldPrintJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `ScratchNode launch scan: ${report.summary.passed ? "PASS" : "FAIL"} ` +
        `(blockers=${report.summary.blockers}, warnings=${report.summary.warnings}, ` +
        `liveFailures=${report.summary.liveFailures}, interactiveFailures=${report.summary.interactiveFailures})`,
    );
    console.log(`Report: ${outPath}`);
    if (report.summary.remoteProbeInfra?.networkAccessDenied) {
      console.log(`- [info/auto] remote probes suppressed: ${report.summary.remoteProbeInfra.reason}`);
    }
    for (const finding of findings.slice(0, 12)) {
      const where = finding.line ? `${finding.path}:${finding.line}` : finding.path;
      console.log(`- [${finding.severity}/${finding.safety}] ${where} ${finding.title}`);
    }
    if (findings.length > 12) {
      console.log(`- ... ${findings.length - 12} more finding(s) in report`);
    }
  }

  if (!report.summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
