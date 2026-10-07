export const LINKEDIN_QUALITY_JUDGE_MODEL_ALIASES = [
  "laguna-s-2.1-free",
  "laguna-xs-2.1-free",
] as const;

export type LinkedInQualityJudgeModelAlias =
  (typeof LINKEDIN_QUALITY_JUDGE_MODEL_ALIASES)[number];

export type LinkedInQualityJudgeVerdict = "approve" | "needs_rewrite" | "reject";

export interface LinkedInQualityJudgeResult {
  hookQuality: boolean;
  opinionDepth: boolean;
  questionAuthenticity: boolean;
  reasoning: string;
  verdict: LinkedInQualityJudgeVerdict;
}

export interface LinkedInQualityJudgeAttemptFailure {
  modelAlias: LinkedInQualityJudgeModelAlias;
  reason: string;
}

export class LinkedInQualityJudgeModelsExhaustedError extends Error {
  constructor(public readonly failures: LinkedInQualityJudgeAttemptFailure[]) {
    super(
      `All LinkedIn quality judge models failed: ${failures
        .map(({ modelAlias, reason }) => `${modelAlias}: ${reason}`)
        .join("; ")}`,
    );
    this.name = "LinkedInQualityJudgeModelsExhaustedError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Extract and strictly validate the judge's JSON envelope. Boolean coercion is
 * intentionally forbidden: malformed responses must not become approvals.
 */
export function parseLinkedInQualityJudgeResponse(
  responseText: string,
): LinkedInQualityJudgeResult {
  const jsonMatch = responseText.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Invalid judge response format: JSON object missing");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Invalid judge response format: malformed JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid judge response format: expected an object");
  }

  const candidate = parsed as Record<string, unknown>;
  const booleanFields = [
    "hookQuality",
    "opinionDepth",
    "questionAuthenticity",
  ] as const;
  for (const field of booleanFields) {
    if (typeof candidate[field] !== "boolean") {
      throw new Error(`Invalid judge response format: ${field} must be boolean`);
    }
  }

  if (
    candidate.verdict !== "approve" &&
    candidate.verdict !== "needs_rewrite" &&
    candidate.verdict !== "reject"
  ) {
    throw new Error("Invalid judge response format: unsupported verdict");
  }

  if (typeof candidate.reasoning !== "string" || !candidate.reasoning.trim()) {
    throw new Error("Invalid judge response format: reasoning must be non-empty");
  }

  const passedCriteria = booleanFields.filter((field) => candidate[field] === true).length;
  const expectedVerdict: LinkedInQualityJudgeVerdict =
    passedCriteria === 3 ? "approve" : passedCriteria === 0 ? "reject" : "needs_rewrite";
  if (candidate.verdict !== expectedVerdict) {
    throw new Error(
      `Invalid judge response format: verdict ${String(candidate.verdict)} conflicts with criteria`,
    );
  }

  return {
    hookQuality: candidate.hookQuality as boolean,
    opinionDepth: candidate.opinionDepth as boolean,
    questionAuthenticity: candidate.questionAuthenticity as boolean,
    reasoning: candidate.reasoning.trim(),
    verdict: expectedVerdict,
  };
}

/**
 * Try the reviewed free-model route in order. The chosen alias is returned so
 * callers can persist exact model provenance with the verdict.
 */
export async function runLinkedInQualityJudgeWithFallback<T>(
  attempt: (modelAlias: LinkedInQualityJudgeModelAlias) => Promise<T>,
): Promise<{
  modelAlias: LinkedInQualityJudgeModelAlias;
  value: T;
  failures: LinkedInQualityJudgeAttemptFailure[];
}> {
  const failures: LinkedInQualityJudgeAttemptFailure[] = [];

  for (const modelAlias of LINKEDIN_QUALITY_JUDGE_MODEL_ALIASES) {
    try {
      return { modelAlias, value: await attempt(modelAlias), failures };
    } catch (error) {
      failures.push({ modelAlias, reason: errorMessage(error) });
    }
  }

  throw new LinkedInQualityJudgeModelsExhaustedError(failures);
}

/** Stop a batch after a transient judge failure; pending selection is oldest-first. */
export function shouldContinueLinkedInJudgeBatch(result: { success: boolean }): boolean {
  return result.success;
}
