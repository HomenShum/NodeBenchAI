#!/usr/bin/env node
import { ConvexHttpClient } from "convex/browser";

import { buildEventCaptureMutationArgs } from "../apps/api-headless/src/lib/event-capture-projection.ts";
import { api } from "../backend/convex/_generated/api";

type ParsedArgs = {
  command?: string;
  subcommand?: string;
  resourceUri?: string;
  text?: string;
  reportId?: string;
  format?: string;
  workspaceId: string;
  eventId?: string;
  eventSessionId?: string;
  anonymousSessionId?: string;
  title?: string;
  kind: "text" | "voice" | "image" | "screenshot" | "file";
  help: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: argv[0],
    workspaceId: "ship-demo-day",
    kind: "text",
    anonymousSessionId: process.env.NODEBENCH_ANON_SESSION_ID ?? "cli.local",
    help: argv.includes("--help") || argv.includes("-h"),
  };
  if (parsed.command === "expand" && argv[1] && !argv[1].startsWith("-")) {
    parsed.resourceUri = argv[1];
  }
  if (parsed.command === "notebook" && argv[1] && !argv[1].startsWith("-")) {
    parsed.subcommand = argv[1];
  }
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--text" || arg === "-t") && next) {
      parsed.text = next;
      i += 1;
    } else if ((arg === "--workspace" || arg === "--workspace-id") && next) {
      parsed.workspaceId = next;
      i += 1;
    } else if (arg === "--event-id" && next) {
      parsed.eventId = next;
      i += 1;
    } else if (arg === "--event-session-id" && next) {
      parsed.eventSessionId = next;
      i += 1;
    } else if (arg === "--anonymous-session-id" && next) {
      parsed.anonymousSessionId = next;
      i += 1;
    } else if (arg === "--title" && next) {
      parsed.title = next;
      i += 1;
    } else if (arg === "--kind" && next) {
      parsed.kind = next as ParsedArgs["kind"];
      i += 1;
    } else if ((arg === "--report" || arg === "--report-id") && next) {
      parsed.reportId = next;
      i += 1;
    } else if (arg === "--format" && next) {
      parsed.format = next;
      i += 1;
    }
  }
  return parsed;
}

function usage() {
  return [
    "Usage:",
    "  npm run nodebench -- capture --text \"Met Alex from Orbital Labs...\"",
    "  npm run nodebench -- expand nodebench://org/orbital-labs",
    "  npm run nodebench -- notebook append --report <reportId> --text \"Follow up with Alex\"",
    "  npm run nodebench -- export --report <reportId> --format crm_csv",
    "  npm run nodebench -- timeline --report <reportId>",
    "",
    "Options:",
    "  --workspace ship-demo-day",
    "  --anonymous-session-id <id>",
    "  --kind text|voice|image|screenshot|file",
    "  --report <Convex productReports id>",
    "  --format crm_csv|csv|json|markdown",
    "",
    "Routing:",
    "  Capture uses NODEBENCH_API_URL /v1/event-captures when set, otherwise CONVEX_URL direct mutation.",
    "  Notebook, export, expand, and timeline use CONVEX_URL direct queries/mutations.",
  ].join("\n");
}

function buildConvexCaptureArgs(input: ParsedArgs) {
  if (!input.text?.trim()) throw new Error("--text is required for capture");
  return buildEventCaptureMutationArgs(input);
}

async function postViaApi(input: ParsedArgs) {
  const baseUrl = process.env.NODEBENCH_API_URL?.replace(/\/+$/, "");
  if (!baseUrl) return null;
  const apiKey = process.env.NODEBENCH_API_KEY ?? process.env.NODEBENCH_API_TOKEN ?? "";
  const res = await fetch(`${baseUrl}/v1/event-captures`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      text: input.text,
      workspaceId: input.workspaceId,
      eventId: input.eventId,
      eventSessionId: input.eventSessionId,
      anonymousSessionId: input.anonymousSessionId,
      title: input.title,
      kind: input.kind,
    }),
  });
  if (!res.ok) throw new Error(`NodeBench API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function postViaConvex(input: ParsedArgs) {
  const client = getConvexClient();
  return client.mutation((api as any).domains.product.eventWorkspace.recordCapture, buildConvexCaptureArgs(input));
}

function getConvexClient() {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Set CONVEX_URL before running this NodeBench CLI command.");
  }
  return new ConvexHttpClient(convexUrl);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function entitySlugFromUri(uri: string) {
  return uri
    .replace(/^nodebench:\/\//, "")
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\//g, ".");
}

async function recordCliActivity(
  client: ConvexHttpClient,
  input: ParsedArgs,
  args: {
    reportId?: string;
    workspaceId?: string;
    entitySlug?: string;
    label: string;
    detail?: string;
    status?: string;
  },
) {
  return client.mutation((api as any).domains.product.activity.recordActivity, {
    anonymousSessionId: input.anonymousSessionId,
    ...(args.reportId ? { reportId: args.reportId as any } : {}),
    ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
    ...(args.entitySlug ? { entitySlug: args.entitySlug } : {}),
    activityType: "cli_action",
    actorType: "cli",
    visibility: "private",
    privacyScope: "private",
    payloadPreview: {
      label: args.label,
      ...(args.detail ? { detail: args.detail } : {}),
      ...(args.status ? { status: args.status } : {}),
    },
  });
}

async function expandViaConvex(input: ParsedArgs) {
  const resourceUri = input.resourceUri?.trim();
  if (!resourceUri) throw new Error("resource URI is required for expand");
  const client = getConvexClient();
  const entitySlug = entitySlugFromUri(resourceUri);
  await recordCliActivity(client, input, {
    workspaceId: input.workspaceId,
    entitySlug,
    label: "CLI resource expanded",
    detail: resourceUri,
    status: "expand",
  });
  const timeline = await client.query((api as any).domains.product.activity.getEntityTimeline, {
    anonymousSessionId: input.anonymousSessionId,
    entitySlug,
    limit: 25,
  });
  return {
    resourceUri,
    entitySlug,
    timeline,
  };
}

async function appendNotebookViaConvex(input: ParsedArgs) {
  const reportId = input.reportId?.trim();
  const text = input.text?.trim();
  if (!reportId) throw new Error("--report is required for notebook append");
  if (!text) throw new Error("--text is required for notebook append");
  const client = getConvexClient();
  const report = await client.query((api as any).domains.product.reports.getReport, {
    reportId: reportId as any,
    anonymousSessionId: input.anonymousSessionId,
  });
  const currentHtml = typeof report?.notebookHtml === "string" ? report.notebookHtml : "";
  const nextHtml = `${currentHtml}\n<p>${escapeHtml(text)}</p>`;
  const result = await client.mutation((api as any).domains.product.reports.saveReportNotebookHtml, {
    reportId: reportId as any,
    notebookHtml: nextHtml,
    anonymousSessionId: input.anonymousSessionId,
  });
  await recordCliActivity(client, input, {
    reportId,
    workspaceId: reportId,
    label: "CLI notebook append",
    detail: text,
    status: "notebook_append",
  });
  return result;
}

async function exportViaConvex(input: ParsedArgs) {
  const reportId = input.reportId?.trim();
  if (!reportId) throw new Error("--report is required for export");
  const client = getConvexClient();
  const format = input.format ?? "crm_csv";
  const preview = await client.mutation((api as any).domains.product.reports.previewReportExport, {
    reportId: reportId as any,
    anonymousSessionId: input.anonymousSessionId,
    format,
  });
  const completed = await client.mutation((api as any).domains.product.reports.completeReportExport, {
    anonymousSessionId: input.anonymousSessionId,
    exportKey: preview.exportKey,
  });
  await recordCliActivity(client, input, {
    reportId,
    workspaceId: reportId,
    label: "CLI report export",
    detail: `${format} / ${completed.rows?.length ?? 0} rows`,
    status: "completed",
  });
  return completed;
}

async function timelineViaConvex(input: ParsedArgs) {
  const reportId = input.reportId?.trim();
  if (!reportId) throw new Error("--report is required for timeline");
  const client = getConvexClient();
  return client.query((api as any).domains.product.activity.getReportTimeline, {
    reportId: reportId as any,
    anonymousSessionId: input.anonymousSessionId,
    limit: 80,
  });
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  if (input.help || !input.command) {
    console.log(usage());
    process.exit(input.help ? 0 : 1);
  }
  if (input.command === "capture") {
    const result = (await postViaApi(input)) ?? (await postViaConvex(input));
    if (process.env.CONVEX_URL) {
      await recordCliActivity(getConvexClient(), input, {
        workspaceId: input.workspaceId,
        label: "CLI capture recorded",
        detail: input.text,
        status: "capture",
      }).catch(() => null);
    }
    console.log(JSON.stringify({
      ok: true,
      status: "Saved to active event session",
      paidCallsUsed: 0,
      result,
    }, null, 2));
    return;
  }
  if (input.command === "expand") {
    console.log(JSON.stringify({ ok: true, result: await expandViaConvex(input) }, null, 2));
    return;
  }
  if (input.command === "notebook" && input.subcommand === "append") {
    console.log(JSON.stringify({ ok: true, result: await appendNotebookViaConvex(input) }, null, 2));
    return;
  }
  if (input.command === "export") {
    console.log(JSON.stringify({ ok: true, result: await exportViaConvex(input) }, null, 2));
    return;
  }
  if (input.command === "timeline") {
    console.log(JSON.stringify({ ok: true, result: await timelineViaConvex(input) }, null, 2));
    return;
  }
  console.log(usage());
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
