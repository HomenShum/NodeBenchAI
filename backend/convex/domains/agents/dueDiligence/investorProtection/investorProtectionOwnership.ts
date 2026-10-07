import type { Doc, Id } from "../../../../_generated/dataModel";

type InvestorProtectionJobOwner = Pick<
  Doc<"investorPlaybookJobs">,
  "jobId" | "userId"
>;

/**
 * Internal job identifiers are not authority. Every retained workflow write must
 * carry the expected owner and prove the job belongs to that owner first.
 */
export function assertInvestorProtectionJobOwner<T extends InvestorProtectionJobOwner>(
  job: T | null,
  userId: Id<"users">,
  jobId: string,
): T {
  if (!job) {
    throw new Error(`Investor protection job not found: ${jobId}`);
  }

  if (job.userId !== userId) {
    throw new Error("Investor protection job owner mismatch");
  }

  return job;
}
