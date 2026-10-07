/**
 * Verification Integrations Index
 *
 * Re-exports all verification integration modules for easy importing.
 * These integrations connect the verification system to other domains:
 *
 * - linkedinVerification: LinkedIn funding/FDA/clinical post verification
 * - artifactVerification: Source artifact verification hooks
 * - narrativeVerification: Narrative thread/event verification
 * - feedVerification: For You Feed insight+correctness ranking
 * - agentVerificationAdapter: Agent pipeline verification tools
 *
 * @module domains/verification/integrations
 */

// Note: These are "use node" files, so they cannot be re-exported directly.
// Import them directly from their respective files:
//
// import { verifyFundingPost } from "./linkedinVerification";
// import { verifyArtifactOnCreate } from "./artifactVerification";
// import { verifyNarrativeEvent } from "./narrativeVerification";
// import { enrichCandidatesWithVerification } from "./feedVerification";
// import { executeVerifyClaim } from "./agentVerificationAdapter";

// Export type definitions that can be used without "use node"
export type {
  LinkedInVerificationResult,
} from "./linkedinVerification";

export type {
  ArtifactVerificationResult,
} from "./artifactVerification";

export type {
  NarrativeVerificationResult,
} from "./narrativeVerification";

export type {
  VerificationSignals,
  EnrichedFeedCandidate,
} from "./feedVerification";

export type {
  AgentVerificationContext,
  VerificationToolResult,
  ClaimForVerification,
} from "./agentVerificationAdapter";
