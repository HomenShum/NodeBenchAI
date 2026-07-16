/**
 * Stable identities for pipeline launches.
 *
 * `attemptKey` identifies the user's logical launch (or one scheduled due
 * occurrence). `workflowExecutionKey` identifies the durable workflow that is
 * allowed to execute that attempt. Keeping them separate lets workflow retries
 * resume their own terminal attempt without letting an overlapping cron sweep
 * restart the same occurrence.
 */

export type PrimitivePipelineKind =
  | "code_gen"
  | "design_gen"
  | "research"
  | "custom";

function stableHash(input: string): string {
  // Two independent 32-bit FNV-style lanes keep this deterministic in every
  // Convex runtime without depending on Node's crypto module.
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

export function buildPipelineIdempotencyKey(args: {
  pipelineKind: PrimitivePipelineKind;
  spec: string;
  ownerKey?: string;
  attemptKey?: string;
}): string {
  return `pipeline:${stableHash(
    JSON.stringify([
      args.pipelineKind,
      args.ownerKey ?? "anonymous",
      args.spec,
      args.attemptKey ?? "reuse",
    ]),
  )}`;
}

function newUniqueKey(
  prefix: string,
  now: number = Date.now(),
  nonce: string =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
): string {
  return `${prefix}:${now.toString(36)}:${nonce}`;
}

export function createManualPipelineAttemptKey(
  now?: number,
  nonce?: string,
): string {
  return newUniqueKey("manual", now, nonce);
}

export function createPipelineWorkflowExecutionKey(
  now?: number,
  nonce?: string,
): string {
  return newUniqueKey("workflow", now, nonce);
}

export function buildScheduleOccurrenceAttemptKey(
  scheduleId: string,
  dueNextRunAt: number,
): string {
  if (!Number.isFinite(dueNextRunAt) || dueNextRunAt < 0) {
    throw new Error("Scheduled occurrence requires a finite dueNextRunAt");
  }
  return `schedule:${scheduleId}:${Math.trunc(dueNextRunAt)}`;
}

export function deriveComposedStageKey(
  parentKey: string,
  stage: 1 | 2,
): string {
  return `${parentKey}:stage:${stage}`;
}
