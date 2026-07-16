/**
 * Server-owned admission and input bounds for cost-bearing pipeline launches.
 *
 * Public callers never provide an owner or quota key. The caller's authenticated
 * user id is resolved before this helper runs, so rotating browser/session ids
 * cannot reset launch allowance.
 */

export const PIPELINE_SPEC_MAX_LENGTH = 4_000;
export const PIPELINE_TITLE_MAX_LENGTH = 120;
export const PIPELINE_MODEL_ID_MAX_LENGTH = 160;
export const PIPELINE_OWNER_KEY_MAX_LENGTH = 240;

export const PIPELINE_SHORT_WINDOW_MS = 10 * 60 * 1_000;
export const PIPELINE_DAY_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const PIPELINE_SHORT_WINDOW_LIMIT = 4;
export const PIPELINE_DAY_WINDOW_LIMIT = 30;

type LaunchTextInput = {
  spec: string;
  title?: string;
  modelId?: string;
};

function boundedRequired(value: string, label: string, maxLength: number): string {
  if (value.length > maxLength) {
    throw new Error(`${label} exceeds the ${maxLength} character limit`);
  }
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function boundedOptional(
  value: string | undefined,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > maxLength) {
    throw new Error(`${label} exceeds the ${maxLength} character limit`);
  }
  return value.trim() || undefined;
}

export function normalizePipelineLaunchText<T extends LaunchTextInput>(
  input: T,
): T & { spec: string; title?: string; modelId?: string } {
  return {
    ...input,
    spec: boundedRequired(input.spec, "Pipeline spec", PIPELINE_SPEC_MAX_LENGTH),
    title: boundedOptional(input.title, "Pipeline title", PIPELINE_TITLE_MAX_LENGTH),
    modelId: boundedOptional(
      input.modelId,
      "Pipeline model id",
      PIPELINE_MODEL_ID_MAX_LENGTH,
    ),
  };
}

export function normalizePipelineOwnerKey(ownerKey: string): string {
  return boundedRequired(
    ownerKey,
    "Pipeline owner key",
    PIPELINE_OWNER_KEY_MAX_LENGTH,
  );
}

function retryAfterSeconds(windowStartAt: number, windowMs: number, now: number): number {
  return Math.max(1, Math.ceil((windowStartAt + windowMs - now) / 1_000));
}

/**
 * Atomically consume launch units from both a short and daily fixed window.
 * Call only inside a Convex mutation transaction.
 */
export async function reservePipelineLaunchAdmission(
  ctx: any,
  ownerKeyInput: string,
  options: { units?: number; now?: number } = {},
): Promise<{ shortRemaining: number; dayRemaining: number }> {
  const ownerKey = normalizePipelineOwnerKey(ownerKeyInput);
  if (!ownerKey.startsWith("user:")) {
    throw new Error("Pipeline launch admission requires an authenticated owner");
  }

  const units = options.units ?? 1;
  if (!Number.isSafeInteger(units) || units < 1 || units > PIPELINE_SHORT_WINDOW_LIMIT) {
    throw new Error("Invalid pipeline launch admission units");
  }
  const now = options.now ?? Date.now();
  const existing = await ctx.db
    .query("pipelineLaunchAdmissions")
    .withIndex("by_owner", (q: any) => q.eq("ownerKey", ownerKey))
    .unique();

  const shortExpired =
    !existing || now - existing.shortWindowStartedAt >= PIPELINE_SHORT_WINDOW_MS;
  const dayExpired =
    !existing || now - existing.dayWindowStartedAt >= PIPELINE_DAY_WINDOW_MS;
  const shortWindowStartedAt = shortExpired ? now : existing.shortWindowStartedAt;
  const dayWindowStartedAt = dayExpired ? now : existing.dayWindowStartedAt;
  const shortCount = (shortExpired ? 0 : existing.shortCount) + units;
  const dayCount = (dayExpired ? 0 : existing.dayCount) + units;

  if (shortCount > PIPELINE_SHORT_WINDOW_LIMIT) {
    throw new Error(
      `Pipeline launch limit reached. Retry in ${retryAfterSeconds(
        shortWindowStartedAt,
        PIPELINE_SHORT_WINDOW_MS,
        now,
      )} seconds`,
    );
  }
  if (dayCount > PIPELINE_DAY_WINDOW_LIMIT) {
    throw new Error(
      `Daily pipeline launch limit reached. Retry in ${retryAfterSeconds(
        dayWindowStartedAt,
        PIPELINE_DAY_WINDOW_MS,
        now,
      )} seconds`,
    );
  }

  const row = {
    ownerKey,
    shortWindowStartedAt,
    shortCount,
    dayWindowStartedAt,
    dayCount,
    updatedAt: now,
  };
  if (existing) await ctx.db.patch(existing._id, row);
  else await ctx.db.insert("pipelineLaunchAdmissions", row);

  return {
    shortRemaining: PIPELINE_SHORT_WINDOW_LIMIT - shortCount,
    dayRemaining: PIPELINE_DAY_WINDOW_LIMIT - dayCount,
  };
}
