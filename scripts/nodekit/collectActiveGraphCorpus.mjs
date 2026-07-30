import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertCanonicalNodeKitRunExport } from "./runActiveGraphCanary.mjs";
import { ACTIVEGRAPH_CORPUS_SCHEMA } from "./runActiveGraphCorpus.mjs";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export const ACTIVEGRAPH_CORPUS_SCENARIOS = Object.freeze(
  [
    ["context-repository", "context", "step", "complete"],
    ["context-mobbin", "context", "evidence", "complete"],
    ["decision-direction", "decision", "decision", "complete"],
    ["build-ui", "build", "step", "complete"],
    ["build-backend", "build", "step", "complete"],
    ["check-types", "check", "verification", "complete"],
    ["check-schema", "check", "verification", "complete"],
    ["review-code", "review", "decision", "review"],
    ["review-simplification", "review", "decision", "review"],
    ["review-design-reference", "review", "evidence", "review"],
    ["review-authority-trust", "review", "verification", "review"],
    ["review-data-truth", "review", "verification", "review"],
    ["browser-live-proof", "browser", "evidence", "complete"],
    ["agent-eval", "agent-eval", "verification", "complete"],
    ["aggregate-findings", "aggregate", "decision", "complete"],
    ["repair-approved", "repair", "step", "complete"],
    ["deliver-evidence-pack", "deliver", "evidence", "complete"],
    ["human-gate-blocked", "human-gate", "approval", "barrier"],
    ["barrier-recovered", "barrier", "verification", "barrier"],
    ["failed-safely", "build", "verification", "failed"],
  ].map(([label, workflowClass, auxiliary, graphMode]) =>
    Object.freeze({ label, workflowClass, auxiliary, graphMode }),
  ),
);

export class ActiveGraphCorpusCollectionError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ActiveGraphCorpusCollectionError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ActiveGraphCorpusCollectionError(code, message);
}

function rawHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertGatewayUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("gateway_url_invalid", "Gateway URL is invalid.");
  }
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  const hosted =
    url.hostname.endsWith(".convex.site") ||
    url.hostname === "nodebenchai.com" ||
    url.hostname.endsWith(".nodebenchai.com");
  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    (!hosted && !loopback) ||
    url.pathname !== "/api/mcpGateway" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    fail(
      "gateway_url_invalid",
      "Gateway URL must be the HTTPS NodeBench/Convex MCP endpoint or loopback.",
    );
  }
  return url;
}

async function readBoundedJsonResponse(response, controller) {
  if (!response.body)
    fail("gateway_response_invalid", "Gateway returned no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        controller.abort();
        fail("gateway_response_too_large", "Gateway response exceeded 4 MiB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let parsed;
  try {
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("gateway_response_invalid", "Gateway response was not valid JSON.");
  }
  return parsed;
}

export async function callNodeBenchGateway({
  gatewayUrl,
  mcpSecret,
  fn,
  args,
  fetchImpl = fetch,
}) {
  const url = assertGatewayUrl(gatewayUrl);
  if (typeof mcpSecret !== "string" || mcpSecret.length < 16) {
    fail("gateway_secret_missing", "MCP_SECRET is missing or too short.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-mcp-secret": mcpSecret,
      },
      body: JSON.stringify({
        fn,
        args,
        meta: {
          client: "nodebench-activegraph-owner-corpus",
          purpose: "offline-adoption-gate",
        },
      }),
    });
    const payload = await readBoundedJsonResponse(response, controller);
    if (!response.ok || payload?.success !== true || !("data" in payload)) {
      fail("gateway_call_failed", `${fn} failed with HTTP ${response.status}.`);
    }
    return payload.data;
  } catch (error) {
    if (error instanceof ActiveGraphCorpusCollectionError) throw error;
    if (error?.name === "AbortError") {
      fail("gateway_timeout", `${fn} exceeded ${REQUEST_TIMEOUT_MS}ms.`);
    }
    fail("gateway_call_failed", `${fn} failed.`);
  } finally {
    clearTimeout(timeout);
  }
}

function graphFields(scenario, index) {
  const seed = `${scenario.label}:${index}`;
  const graphHash = rawHash(`graph:${seed}`);
  const caseContentHash = rawHash(`case:${seed}`);
  const frontierHash = rawHash(`frontier:${seed}`);
  return {
    graphId: `execution-graph:sha256:${graphHash}`,
    graphHash,
    caseId: `case:activegraph-corpus:${index}`,
    stageId: scenario.workflowClass,
    caseContentHash,
    nodeId: `node:${scenario.label}`,
    nodeRunId: `node-run:${scenario.label}:1`,
    nodeKind:
      scenario.graphMode === "review"
        ? "review"
        : scenario.graphMode === "barrier"
          ? "barrier"
          : "task",
    frontierHash,
  };
}

async function recordAuxiliary(call, scenario, session, index) {
  const shared = {
    traceId: session.traceId,
  };
  if (scenario.auxiliary === "step") {
    await call("recordStep", {
      ...shared,
      stage: scenario.workflowClass === "repair" ? "edit" : "inspect",
      type: "task_started",
      title: `Exercise ${scenario.label}`,
      tool: "nodekit-corpus",
      action: "observe representative workflow",
      target: scenario.label,
      resultSummary: "Synthetic owner-scoped corpus event completed.",
      evidenceRefs: [`corpus:${index}`],
      verification: ["bounded synthetic production probe"],
      confidence: 1,
    });
  } else if (scenario.auxiliary === "decision") {
    await call("recordDecision", {
      ...shared,
      decisionType: "corpus_probe",
      statement: `Record representative ${scenario.label} decision.`,
      basis: ["bounded production probe", "offline export experiment"],
      evidenceRefs: [`corpus:${index}`],
      alternativesConsidered: ["do not adopt ActiveGraph"],
      confidence: 1,
      limitations: ["Synthetic probe; not a user claim."],
    });
  } else if (scenario.auxiliary === "verification") {
    await call("recordVerification", {
      ...shared,
      label: scenario.label,
      status: scenario.graphMode === "failed" ? "failed" : "passed",
      details: "Deterministic corpus verification event.",
      relatedArtifactIds: [`corpus-artifact:${index}`],
      createGuardrailSpan: false,
    });
  } else if (scenario.auxiliary === "evidence") {
    await call("attachEvidence", {
      ...shared,
      title: `Corpus evidence ${scenario.label}`,
      summary: "Bounded synthetic evidence for offline replay coverage.",
      sourceRefs: [
        {
          label: "NodeKit ActiveGraph corpus probe",
          kind: "synthetic-production-probe",
        },
      ],
      supportedClaims: ["The canonical export retained this event."],
      unsupportedClaims: ["ActiveGraph should become production authority."],
    });
  } else if (scenario.auxiliary === "approval") {
    await call("requestTraceApproval", {
      sessionId: session.sessionId,
      traceId: session.traceId,
      toolName: "activegraph_offline_adoption",
      riskLevel: "high",
      justification:
        "Record a protected human gate without granting or simulating approval.",
    });
  }
}

async function recordGraphLifecycle(call, scenario, session, index) {
  const graph = graphFields(scenario, index);
  await call("recordExecutionGraphEvent", {
    traceId: session.traceId,
    eventType: "node.started",
    ...graph,
    reviewContextRef:
      scenario.graphMode === "review"
        ? `review-context:${scenario.label}`
        : undefined,
  });
  if (scenario.graphMode === "barrier") {
    await call("recordExecutionGraphEvent", {
      traceId: session.traceId,
      eventType: "barrier.blocked",
      ...graph,
      status: "blocked",
      reasonCode: "owner_approval_required",
      blockingEdgeCount: 1,
    });
    await call("recordExecutionGraphEvent", {
      traceId: session.traceId,
      eventType: "barrier.opened",
      ...graph,
      status: "opened",
    });
  }
  if (scenario.graphMode !== "failed") {
    const artifactHash = rawHash(`artifact:${scenario.label}:${index}`);
    await call("recordExecutionGraphEvent", {
      traceId: session.traceId,
      eventType: "artifact.produced",
      ...graph,
      artifactId: `artifact:${scenario.label}`,
      artifactSchemaVersion: "nodekit.corpus-artifact/v1",
      artifactContentHash: artifactHash,
      authorityKind:
        scenario.workflowClass === "check" ? "deterministic" : "agent-produced",
    });
    await call("recordExecutionGraphEvent", {
      traceId: session.traceId,
      eventType: "node.completed",
      ...graph,
      status: "completed",
      reviewContextRef:
        scenario.graphMode === "review"
          ? `review-context:${scenario.label}`
          : undefined,
      reviewSeparation:
        scenario.graphMode === "review" ? "fresh-context" : undefined,
      protectedEvaluator: false,
    });
  } else {
    await call("recordExecutionGraphEvent", {
      traceId: session.traceId,
      eventType: "node.failed",
      ...graph,
      status: "failed",
      reasonCode: "synthetic_failure_probe",
    });
  }
}

async function bestEffortTerminalize(call, session, errorMessage) {
  if (!session) return;
  try {
    await call("completeTrace", {
      traceId: session.traceId,
      status: "error",
      crossCheckStatus: "violated",
      deltaFromVision: errorMessage.slice(0, 240),
    });
  } catch {
    // The original failure remains authoritative.
  }
  try {
    await call("updateSessionStatus", {
      sessionId: session.sessionId,
      status: "failed",
      errorMessage: errorMessage.slice(0, 240),
      crossCheckStatus: "violated",
      deltaFromVision: errorMessage.slice(0, 240),
    });
  } catch {
    // The original failure remains authoritative.
  }
}

export async function collectActiveGraphCorpus({
  gatewayUrl,
  mcpSecret,
  outputDirectory,
  gatewayCall = callNodeBenchGateway,
}) {
  const resolvedOutput = resolve(outputDirectory);
  if (existsSync(resolvedOutput)) {
    fail("output_exists", "Corpus output directory must not already exist.");
  }
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  mkdirSync(resolvedOutput);
  const exportsDirectory = resolve(resolvedOutput, "exports");
  mkdirSync(exportsDirectory);

  const call = (fn, args) => gatewayCall({ gatewayUrl, mcpSecret, fn, args });
  const manifestEntries = [];
  for (const [index, scenario] of ACTIVEGRAPH_CORPUS_SCENARIOS.entries()) {
    let session;
    try {
      session = await call("mcpStartExecutionRun", {
        title: `ActiveGraph corpus: ${scenario.label}`,
        workflowName: `activegraph-corpus-${scenario.label}`,
        description:
          "Bounded owner-scoped synthetic production trace for the offline ActiveGraph adoption gate.",
        type:
          index % 5 === 0
            ? "manual"
            : index % 5 === 1
              ? "cron"
              : index % 5 === 2
                ? "scheduled"
                : index % 5 === 3
                  ? "agent"
                  : "swarm",
        visibility: "private",
        nativeSessionReference: {
          workspaceId: `workspace:sha256:${rawHash("activegraph-corpus-workspace")}`,
          sessionId: `session:sha256:${rawHash(`activegraph-corpus-session:${index}`)}`,
          workspaceArtifactRef: `native-workspace:sha256:${rawHash("activegraph-corpus-workspace-artifact")}`,
          workspaceArtifactDigest: rawHash(
            "activegraph-corpus-workspace-artifact",
          ),
          sessionArtifactRef: `native-agent-session:sha256:${rawHash(`activegraph-corpus-session-artifact:${index}`)}`,
          sessionArtifactDigest: rawHash(
            `activegraph-corpus-session-artifact:${index}`,
          ),
          checkpointArtifactRef: `native-session-checkpoint:sha256:${rawHash(`activegraph-corpus-checkpoint:${index}`)}`,
          checkpointArtifactDigest: rawHash(
            `activegraph-corpus-checkpoint:${index}`,
          ),
        },
        metadata: {
          corpusSchemaVersion: ACTIVEGRAPH_CORPUS_SCHEMA,
          corpusScenario: scenario.label,
          nonAuthoritative: true,
        },
      });
      await recordAuxiliary(call, scenario, session, index);
      await recordGraphLifecycle(call, scenario, session, index);
      const failed = scenario.graphMode === "failed";
      await call("completeTrace", {
        traceId: session.traceId,
        status: failed ? "error" : "completed",
        crossCheckStatus: failed ? "violated" : "aligned",
        deltaFromVision: failed
          ? "Synthetic failure scenario remained fail-closed."
          : "Synthetic corpus scenario matched its bounded plan.",
      });
      await call("updateSessionStatus", {
        sessionId: session.sessionId,
        status: failed ? "failed" : "completed",
        errorMessage: failed
          ? "Synthetic failure scenario for offline replay coverage."
          : undefined,
        crossCheckStatus: failed ? "violated" : "aligned",
        deltaFromVision: failed
          ? "Synthetic failure scenario remained fail-closed."
          : "Synthetic corpus scenario matched its bounded plan.",
      });
      const exportDocument = await call("exportNodeKitRun", {
        traceId: session.traceId,
      });
      assertCanonicalNodeKitRunExport(exportDocument);
      const terminalStatus = failed ? "error" : "completed";
      if (exportDocument.trace.status !== terminalStatus) {
        fail(
          "export_status_mismatch",
          `${scenario.label} export did not preserve terminal status.`,
        );
      }
      const fileName = `${String(index + 1).padStart(2, "0")}-${scenario.label}.json`;
      const exportPath = resolve(exportsDirectory, fileName);
      writeFileSync(
        exportPath,
        `${JSON.stringify(exportDocument, null, 2)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
        },
      );
      manifestEntries.push({
        label: scenario.label,
        inputFile: relative(resolvedOutput, exportPath).replaceAll("\\", "/"),
        workflowClass: scenario.workflowClass,
        terminalStatus,
      });
    } catch (error) {
      await bestEffortTerminalize(
        call,
        session,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  const manifest = {
    schemaVersion: ACTIVEGRAPH_CORPUS_SCHEMA,
    collectedAt: new Date().toISOString(),
    source: {
      kind: "nodebench-production",
      gatewayFunction: "exportNodeKitRun",
      authorization: "gateway-injected-owner",
    },
    exports: manifestEntries,
  };
  const manifestPath = resolve(resolvedOutput, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return Object.freeze({
    manifestPath,
    corpusSize: manifestEntries.length,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const outputDirectory = process.argv[2];
    if (!outputDirectory || process.argv.length !== 3) {
      fail(
        "cli_args_invalid",
        "Usage: node collectActiveGraphCorpus.mjs <new-output-directory>",
      );
    }
    const result = await collectActiveGraphCorpus({
      gatewayUrl: process.env.NODEBENCH_MCP_GATEWAY_URL,
      mcpSecret: process.env.MCP_SECRET,
      outputDirectory,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
