import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const exactKitSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/features/designKit/exact/ExactKit.tsx"),
  "utf8",
);
const exactKitCss = readFileSync(
  resolve(process.cwd(), "apps/web/src/features/designKit/exact/exactKit.css"),
  "utf8",
);
const topNavSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/layouts/ProductTopNav.tsx"),
  "utf8",
);

function between(start: string, end: string) {
  const startIndex = exactKitSource.indexOf(start);
  const endIndex = exactKitSource.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing end marker: ${end}`).toBeGreaterThan(startIndex);
  return exactKitSource.slice(startIndex, endIndex);
}

describe("ExactKit runtime-grounding guards", () => {
  it("uses one canonical surface tree inside the established mobile wrapper", () => {
    const source = between("function ResponsiveSurface", "function DeferredReportsPanel");
    expect(source).toContain("mobile-${mobile}-surface");
    expect(source).toContain("{children}");
    expect(source).not.toContain("ExactMobileSurface");
    expect(exactKitSource).not.toContain("function MobileChatBody");
    expect(exactKitSource).not.toContain("function MobileMeBody");
  });

  it("does not ship canned completed activity or report fallbacks", () => {
    for (const fixture of [
      "INBOX_SEED",
      "REPORT_DETAILS",
      "RECENT_REPORTS",
      "RECENT_CAPTURES",
      "EVENT_STATS",
      "ORBITAL_THREAD_TURNS",
      "SPARK_SEEDS",
      "TODAY_LANES",
    ]) {
      expect(exactKitSource).not.toContain(fixture);
    }
    expect(exactKitSource).not.toContain("NBPulseStrip");
  });

  it("keeps starter prompts generic and capability-backed", () => {
    const prompts = between("const PROMPT_CARDS", "function openWorkspace");
    expect(prompts).not.toMatch(/DISCO|Mercor|attached 10-K/i);
    expect(prompts).toContain("pasted filing text");
    expect(prompts).toContain("current sources");
  });

  it("keeps Reports, Inbox, Me, and Chat on runtime-backed states", () => {
    const reportDetail = between("export function ExactReportDetailSurface", "export function ExactReportsSurface");
    expect(reportDetail).toContain("const detail = liveDetail");
    expect(reportDetail).toContain("No runtime-backed report");

    const inbox = between("export function ExactInboxSurface", "type ExactNotebookEntity");
    expect(inbox).toContain("useState<ExactInboxItem[]>([])");
    expect(inbox).toContain('testId="inbox-loading"');
    expect(inbox).toContain("requireSuccessfulInboxMutation(result)");
    expect(inbox).toContain("Snooze 24h");
    expect(inbox).toContain('role="alert"');

    const me = between("export function ExactMeSurface", "export function ExactMcpTerminalPage");
    expect(me).toContain('testId="me-memory-empty"');
    expect(me).not.toContain("Stop watching");
    expect(me).not.toContain("No watched entities");

    const chat = between("export function ExactChatSurface", "function nowTime");
    expect(chat).toContain('data-testid="exact-web-chat-stream"');
    expect(chat).toContain('initialTab: "chat"');
    expect(chat).toContain("fastAgent.openWithContext");
    expect(chat).toContain("chatRunInFlight");
    expect(chat).toContain('placeholder="Ask or paste text... (@ to mention an entity)"');
    expect(chat).not.toContain('t: "pill"');
    expect(chat).not.toContain('kind: "confirm"');
    expect(exactKitCss).not.toContain(".nb-epill");
    expect(exactKitCss).not.toContain(".nb-confirm");
    expect(chat).not.toContain("No paid calls");
    expect(chat).not.toContain("checked live run eligibility");
    expect(chat).not.toContain("Ship Demo Day");
    expect(chat).not.toContain("PIPELINE_MODEL_OPTIONS");
  });

  it("describes research runs and entity recency without inventing saved reports or watch state", () => {
    const home = between("export function ExactHomeSurface", "type ExactReportCard");
    const reports = between("export function ExactReportsSurface", "/* Runtime-backed profile");
    const avatar = between("export function ExactAvatarMenu", "/*");

    expect(home).toContain("View activity");
    expect(home).toContain("completed bundle from Reports Background runs");
    expect(home).not.toMatch(/saves? (the result )?as a report|saved under Reports/i);
    expect(home).not.toContain("% confidence");
    expect(reports).toContain('data-testid="reports-pipelines-panel-slot"');
    expect(reports.indexOf('data-testid="reports-pipelines-panel-slot"')).toBeLessThan(reports.indexOf("<details"));
    expect(reports).toContain("Background-run progress and output are listed above");
    expect(reports).not.toContain("latest?.status === \"verified\"");
    expect(avatar).toContain("Recent entities");
    expect(avatar).toContain('onSurfaceChange?.("connect")');
    expect(avatar).not.toContain('onSurfaceChange?.("me")');
    expect(avatar).not.toContain("Watching");
    expect(exactKitSource).not.toContain('fresh: "fresh" | "updated" | "watching"');
    expect(exactKitCss).toContain('.nb-recent-fresh[data-state="older"]');
  });

  it("requires an explicit query before the primary background run can start", () => {
    const home = between("export function ExactHomeSurface", "type ExactReportCard");

    expect(home).toContain("disabled={authLoading || backgroundSubmitting || (isAuthenticated && !query.trim())}");
    expect(home).toContain('message: "Add a query or choose a scenario first."');
    expect(home).toContain('isAuthenticated ? "Run research" : "Sign in to run"');
    expect(home).toContain('await signIn("google"');
    expect(home).toContain('url.searchParams.set("q", pendingQuery)');
    expect(home).toContain('useState(() => searchParams.get("q") ?? "")');
    expect(home).not.toContain("firstFallbackPrompt");
    expect(home).not.toContain("fallbackPrompt:");
  });

  it("removes the inert notification control from top navigation", () => {
    expect(topNavSource).not.toContain("Open notifications");
  });

  it("keeps the reachable MCP developer page honest before a real call", () => {
    const terminal = exactKitSource.slice(
      exactKitSource.indexOf("export function ExactMcpTerminalPage"),
    );
    expect(terminal).toContain('data-testid="mcp-terminal-empty"');
    expect(terminal).toContain("No MCP call has run on this page.");
    expect(terminal).not.toMatch(/companyName: "DISCO"|first dossier returned|tools loaded/i);
  });

  it("does not reintroduce identity, execution, or freshness claims before runtime evidence", () => {
    const chat = between("function ChatTraceView", "export function ExactInboxSurface");
    const reports = between("export function ExactReportDetailSurface", "export function ExactReportsSurface");

    expect(chat).not.toContain('data-role="user">HS');
    expect(chat).not.toContain("Reasoned across");
    expect(chat).not.toContain("verification lanes");
    expect(chat).not.toContain("auto-handled");
    expect(chat).not.toContain('"Open the report"');
    expect(chat).not.toContain('"Show sources used"');
    expect(reports).not.toContain('aria-label="Live status"');
    expect(exactKitSource).toContain('if (!ts) return "time unavailable"');
  });
});
