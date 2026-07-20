export const NODE_WORKFLOW_PROTOCOL_VERSION =
  "node.workflow-execution/v1" as const;

export type NodeWorkflowApp =
  "nodevideo" | "nodeslide" | "noderoom" | "nodebenchai";
export type NodeWorkflowFramework = "native" | "rocketride" | "langchain";

export interface NodeWorkflowRequest {
  schemaVersion: typeof NODE_WORKFLOW_PROTOCOL_VERSION;
  app: NodeWorkflowApp;
  workflow: string;
  fixtureId: string;
  traceId: string;
  inputDigest: string;
  baseVersion?: number;
  idempotencyKey: string;
  concurrency: number;
  deadlineMs: number;
  failureSeed?: string;
}

export interface NodeRunEvent {
  sequence: number;
  atMs: number;
  kind: string;
  unitId?: string;
  detail?: string;
}

export interface NodeRunMetrics {
  coldStartMs: number;
  warmupMs: number;
  executionMs: number;
  totalMs: number;
  retryCount: number;
  completedUnits: number;
  failedUnits: number;
  duplicateUnits: number;
  leakedUnits: number;
  peakRssBytes?: number;
  cpuTimeMs?: number;
  runtimeHealthyAfter?: boolean;
}

export interface RuntimeProvenance {
  adapter: string;
  adapterVersion: string;
  runtime: string;
  runtimeVersion: string;
  appCommit: string;
  deterministic: boolean;
  location: "local" | "cloud";
}

export interface StructuredRunError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface NodeWorkflowResult<TCandidate> {
  schemaVersion: typeof NODE_WORKFLOW_PROTOCOL_VERSION;
  runId: string;
  traceId: string;
  framework: NodeWorkflowFramework;
  candidate: TCandidate;
  inputDigest: string;
  idempotencyKey: string;
  outputDigest: string;
  events: NodeRunEvent[];
  metrics: NodeRunMetrics;
  provenance: RuntimeProvenance;
  error?: StructuredRunError;
}

export interface NodeWorkflowExecutionPort<TCandidate> {
  readonly framework: NodeWorkflowFramework;
  execute(
    request: Readonly<NodeWorkflowRequest>,
    options?: { signal?: AbortSignal },
  ): Promise<NodeWorkflowResult<TCandidate>>;
}

export interface NodeWorkflowSidecarPortOptions {
  framework: Exclude<NodeWorkflowFramework, "native">;
  endpoint: string;
  headers?: Readonly<Record<string, string>>;
  fetch?: typeof fetch;
  maxResponseBytes?: number;
}

export function createNativeNodeWorkflowExecutionPort<TCandidate>(
  execute: (
    request: Readonly<NodeWorkflowRequest>,
    options?: { signal?: AbortSignal },
  ) => Promise<NodeWorkflowResult<TCandidate>>,
): NodeWorkflowExecutionPort<TCandidate> {
  return {
    framework: "native",
    execute: async (request, options) => {
      const issues = validateNodeWorkflowRequest(request);
      if (issues.length > 0)
        throw new Error(`Invalid workflow request: ${issues.join(" ")}`);
      const result = await execute(structuredClone(request), options);
      if (result.framework !== "native") {
        throw new Error(
          "Native workflow result framework does not match the configured port.",
        );
      }
      return result;
    },
  };
}

/**
 * Calls a configured candidate-only sidecar. The endpoint is fixed when the
 * port is created, never derived from a workflow request, and cannot receive an
 * application write capability.
 */
export function createNodeWorkflowSidecarExecutionPort<TCandidate>(
  options: NodeWorkflowSidecarPortOptions,
): NodeWorkflowExecutionPort<TCandidate> {
  const endpoint = validateSidecarEndpoint(options.endpoint);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function")
    throw new Error("A fetch implementation is required.");
  const maxResponseBytes = options.maxResponseBytes ?? 1_250_000;
  if (!safeIntegerInRange(maxResponseBytes, 1_024, 10_000_000)) {
    throw new Error(
      "Sidecar response limit must be between 1024 and 10000000 bytes.",
    );
  }
  const headers = validateSidecarHeaders(options.headers ?? {});

  return {
    framework: options.framework,
    async execute(request, executionOptions) {
      const requestIssues = validateNodeWorkflowRequest(request);
      if (requestIssues.length > 0) {
        throw new Error(`Invalid workflow request: ${requestIssues.join(" ")}`);
      }
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort("workflow deadline exceeded"),
        request.deadlineMs,
      );
      const relayAbort = () =>
        controller.abort(executionOptions?.signal?.reason);
      executionOptions?.signal?.addEventListener("abort", relayAbort, {
        once: true,
      });
      try {
        if (executionOptions?.signal?.aborted) relayAbort();
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify(structuredClone(request)),
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Workflow sidecar returned HTTP ${response.status}.`);
        }
        const contentType =
          response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("application/json")) {
          throw new Error("Workflow sidecar must return application/json.");
        }
        const result = JSON.parse(
          await readBoundedResponse(response, maxResponseBytes),
        ) as unknown;
        if (
          !isRecord(result) ||
          result["schemaVersion"] !== NODE_WORKFLOW_PROTOCOL_VERSION
        ) {
          throw new Error(
            "Workflow sidecar returned an unsupported result schema.",
          );
        }
        if (result["framework"] !== options.framework) {
          throw new Error(
            "Workflow sidecar result framework does not match the configured port.",
          );
        }
        return result as unknown as NodeWorkflowResult<TCandidate>;
      } finally {
        clearTimeout(timeout);
        executionOptions?.signal?.removeEventListener("abort", relayAbort);
      }
    },
  };
}

export interface CandidateAdmissionReceipt {
  schemaVersion: "node.workflow-candidate-admission/v1";
  runId: string;
  traceId: string;
  app: NodeWorkflowApp;
  framework: NodeWorkflowFramework;
  inputDigest: string;
  outputDigest: string;
  status: "candidate_validated" | "candidate_rejected";
  issues: string[];
  finalWriteAuthority: "application_validation_cas_review";
  verifiedAt: string;
}

export type CandidateAdmission<TCandidate> =
  | {
      accepted: true;
      candidate: TCandidate;
      receipt: CandidateAdmissionReceipt;
    }
  | { accepted: false; receipt: CandidateAdmissionReceipt };

export async function inspectNodeWorkflowCandidate<TCandidate>(args: {
  request: NodeWorkflowRequest;
  result: NodeWorkflowResult<TCandidate>;
  expectedApp: NodeWorkflowApp;
  expectedAppCommit: string;
  digestCandidate: (candidate: TCandidate) => string | Promise<string>;
  validateCandidate: (
    candidate: TCandidate,
  ) => readonly string[] | Promise<readonly string[]>;
  requireDeterministic?: boolean;
  now?: () => Date;
}): Promise<CandidateAdmission<TCandidate>> {
  const issues = validateNodeWorkflowEnvelope(
    args.request,
    args.result,
    args.expectedApp,
    args.expectedAppCommit,
    args.requireDeterministic ?? true,
  );

  try {
    const candidateBytes = new TextEncoder().encode(
      canonicalNodeWorkflowJson(args.result.candidate),
    );
    if (candidateBytes.byteLength > 1_000_000) {
      issues.push("Candidate exceeds the 1 MB protocol limit.");
    }
  } catch (error) {
    issues.push(`Candidate is not canonical JSON: ${errorMessage(error)}`);
  }

  let computedDigest = "";
  try {
    computedDigest = await args.digestCandidate(args.result.candidate);
    if (!isSha256Digest(computedDigest)) {
      issues.push("Candidate digester did not return a sha256 digest.");
    } else if (computedDigest !== args.result.outputDigest) {
      issues.push(
        "Candidate output digest does not match the execution receipt.",
      );
    }
  } catch (error) {
    issues.push(`Candidate digest failed: ${errorMessage(error)}`);
  }

  try {
    issues.push(...(await args.validateCandidate(args.result.candidate)));
  } catch (error) {
    issues.push(
      `Application candidate validation failed: ${errorMessage(error)}`,
    );
  }

  const uniqueIssues = [...new Set(issues)];
  const receipt: CandidateAdmissionReceipt = {
    schemaVersion: "node.workflow-candidate-admission/v1",
    runId: cleanText(args.result.runId) || "invalid-run",
    traceId: cleanText(args.result.traceId) || "invalid-trace",
    app: args.expectedApp,
    framework: args.result.framework,
    inputDigest: args.result.inputDigest,
    outputDigest: computedDigest || args.result.outputDigest,
    status:
      uniqueIssues.length === 0 ? "candidate_validated" : "candidate_rejected",
    issues: uniqueIssues,
    finalWriteAuthority: "application_validation_cas_review",
    verifiedAt: (args.now ?? (() => new Date()))().toISOString(),
  };

  if (uniqueIssues.length > 0) return { accepted: false, receipt };
  return {
    accepted: true,
    candidate: deepFreeze(structuredClone(args.result.candidate)),
    receipt,
  };
}

export function validateNodeWorkflowEnvelope<TCandidate>(
  request: NodeWorkflowRequest,
  result: NodeWorkflowResult<TCandidate>,
  expectedApp: NodeWorkflowApp,
  expectedAppCommit: string,
  requireDeterministic = true,
): string[] {
  const issues = validateNodeWorkflowRequest(request, expectedApp);
  if (result.schemaVersion !== NODE_WORKFLOW_PROTOCOL_VERSION) {
    issues.push("Unsupported workflow result schema.");
  }
  if (!boundedText(result.runId, 1, 256)) issues.push("Run ID is invalid.");
  if (!boundedText(result.traceId, 1, 256))
    issues.push("Result trace ID is invalid.");
  if (!["native", "rocketride", "langchain"].includes(result.framework)) {
    issues.push("Framework is invalid.");
  }
  if (result.inputDigest !== request.inputDigest) {
    issues.push("Result is not bound to the request input digest.");
  }
  if (result.traceId !== request.traceId) {
    issues.push("Result is not bound to the request trace ID.");
  }
  if (result.idempotencyKey !== request.idempotencyKey) {
    issues.push("Result is not bound to the request idempotency key.");
  }
  if (!isSha256Digest(result.outputDigest))
    issues.push("Result output digest is invalid.");
  if (result.error)
    issues.push(
      `Executor returned ${result.error.code}: ${result.error.message}`,
    );

  validateEvents(result.events, issues);
  validateMetrics(result.metrics, request.deadlineMs, issues);
  validateProvenance(
    result.provenance,
    expectedAppCommit,
    requireDeterministic,
    issues,
  );
  return issues;
}

export function validateNodeWorkflowRequest(
  request: NodeWorkflowRequest,
  expectedApp?: NodeWorkflowApp,
): string[] {
  const issues: string[] = [];
  if (request.schemaVersion !== NODE_WORKFLOW_PROTOCOL_VERSION) {
    issues.push("Unsupported workflow request schema.");
  }
  if (
    !["nodevideo", "nodeslide", "noderoom", "nodebenchai"].includes(request.app)
  ) {
    issues.push("Request app is invalid.");
  }
  if (expectedApp && request.app !== expectedApp)
    issues.push(`Request app must be ${expectedApp}.`);
  if (!boundedText(request.workflow, 1, 160))
    issues.push("Workflow name is invalid.");
  if (!boundedText(request.fixtureId, 1, 256))
    issues.push("Fixture ID is invalid.");
  if (!boundedText(request.traceId, 1, 256))
    issues.push("Request trace ID is invalid.");
  if (!isSha256Digest(request.inputDigest))
    issues.push("Request input digest is invalid.");
  if (!boundedText(request.idempotencyKey, 1, 256))
    issues.push("Idempotency key is invalid.");
  if (!safeIntegerInRange(request.concurrency, 1, 256))
    issues.push("Concurrency is invalid.");
  if (!safeIntegerInRange(request.deadlineMs, 1, 30 * 60 * 1000)) {
    issues.push("Deadline is invalid.");
  }
  if (
    request.baseVersion !== undefined &&
    !safeIntegerInRange(request.baseVersion, 0, Number.MAX_SAFE_INTEGER)
  ) {
    issues.push("Base version is invalid.");
  }
  if (
    request.failureSeed !== undefined &&
    !boundedText(request.failureSeed, 1, 256)
  ) {
    issues.push("Failure seed is invalid.");
  }
  return issues;
}

/** Stable JSON shared with the Python sidecar before SHA-256 binding. */
export function canonicalNodeWorkflowJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

function validateEvents(
  events: readonly NodeRunEvent[],
  issues: string[],
): void {
  if (!Array.isArray(events) || events.length === 0) {
    issues.push("Execution events are required.");
    return;
  }
  if (events.length > 10_000) {
    issues.push("Execution event count exceeds the protocol limit.");
    return;
  }
  let lastAt = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || event.sequence !== index + 1) {
      issues.push("Execution event sequences must be contiguous.");
      break;
    }
    if (!Number.isFinite(event.atMs) || event.atMs < lastAt || event.atMs < 0) {
      issues.push("Execution event clocks must be finite and monotonic.");
      break;
    }
    if (!boundedText(event.kind, 1, 120)) {
      issues.push("Execution event kind is invalid.");
      break;
    }
    lastAt = event.atMs;
  }
}

function validateSidecarEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("Workflow sidecar endpoint is not a valid URL.");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error(
      "Workflow sidecar credentials must be supplied as headers, not URL userinfo.",
    );
  }
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "");
  const local = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  if (
    endpoint.protocol !== "https:" &&
    !(endpoint.protocol === "http:" && local)
  ) {
    throw new Error("Workflow sidecars require HTTPS except on localhost.");
  }
  endpoint.hash = "";
  return endpoint.toString();
}

function validateSidecarHeaders(
  input: Readonly<Record<string, string>>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.trim().toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_\`|~-]+$/.test(name)) {
      throw new Error("Workflow sidecar header name is invalid.");
    }
    if (["host", "content-length", "content-type"].includes(name)) {
      throw new Error(
        `Workflow sidecar header ${name} is managed by the execution port.`,
      );
    }
    if (/[\r\n]/.test(rawValue))
      throw new Error("Workflow sidecar header value is invalid.");
    headers[name] = rawValue;
  }
  return headers;
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(
      "Workflow sidecar response exceeds the configured byte limit.",
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("response limit exceeded");
        throw new Error(
          "Workflow sidecar response exceeds the configured byte limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validateMetrics(
  metrics: NodeRunMetrics | undefined,
  deadlineMs: number,
  issues: string[],
): void {
  if (!metrics || typeof metrics !== "object") {
    issues.push("Execution metrics are required.");
    return;
  }
  const durations = [
    metrics.coldStartMs,
    metrics.warmupMs,
    metrics.executionMs,
    metrics.totalMs,
  ];
  if (durations.some((value) => !Number.isFinite(value) || value < 0)) {
    issues.push("Execution durations must be finite and non-negative.");
  }
  if (metrics.totalMs > deadlineMs)
    issues.push("Execution exceeded the request deadline.");
  const counts = [
    metrics.retryCount,
    metrics.completedUnits,
    metrics.failedUnits,
    metrics.duplicateUnits,
    metrics.leakedUnits,
  ];
  if (
    counts.some(
      (value) => !safeIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER),
    )
  ) {
    issues.push("Execution counters must be non-negative safe integers.");
  }
  if (metrics.completedUnits < 1)
    issues.push("Execution completed no work units.");
  if (metrics.failedUnits > 0)
    issues.push("Execution contains failed work units.");
  if (metrics.duplicateUnits > 0)
    issues.push("Execution contains duplicate work units.");
  if (metrics.leakedUnits > 0)
    issues.push("Execution contains cross-scope leaked work units.");
  for (const value of [metrics.peakRssBytes, metrics.cpuTimeMs]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      issues.push("Optional resource metrics must be finite and non-negative.");
      break;
    }
  }
  if (
    metrics.runtimeHealthyAfter !== undefined &&
    typeof metrics.runtimeHealthyAfter !== "boolean"
  ) {
    issues.push("Post-execution runtime health must be boolean when reported.");
  }
}

function validateProvenance(
  provenance: RuntimeProvenance | undefined,
  expectedAppCommit: string,
  requireDeterministic: boolean,
  issues: string[],
): void {
  if (!provenance || typeof provenance !== "object") {
    issues.push("Runtime provenance is required.");
    return;
  }
  for (const [label, value] of [
    ["adapter", provenance.adapter],
    ["adapter version", provenance.adapterVersion],
    ["runtime", provenance.runtime],
    ["runtime version", provenance.runtimeVersion],
    ["application commit", provenance.appCommit],
  ] as const) {
    if (!boundedText(value, 1, 256))
      issues.push(`Runtime ${label} is invalid.`);
  }
  if (!["local", "cloud"].includes(provenance.location)) {
    issues.push("Runtime location is invalid.");
  }
  if (provenance.appCommit !== expectedAppCommit) {
    issues.push(
      "Runtime provenance does not match the frozen application commit.",
    );
  }
  if (requireDeterministic && !provenance.deterministic) {
    issues.push("Scored candidate must use deterministic provenance.");
  }
}

function isSha256Digest(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Canonical JSON numbers must be finite.");
    return JSON.stringify(value);
  }
  if (typeof value !== "object")
    throw new Error("Candidate contains a non-JSON value.");
  if (ancestors.has(value)) throw new Error("Candidate contains a cycle.");
  ancestors.add(value);
  let encoded: string;
  if (Array.isArray(value)) {
    encoded = `[${value.map((item) => canonicalize(item, ancestors)).join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Candidate must contain plain JSON objects.");
    }
    encoded = `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalize(item, ancestors)}`,
      )
      .join(",")}}`;
  }
  ancestors.delete(value);
  return encoded;
}

function boundedText(
  value: unknown,
  min: number,
  max: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= min &&
    value.length <= max
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  for (const item of Object.values(value as Record<string, unknown>))
    deepFreeze(item);
  return Object.freeze(value) as T;
}

function safeIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
