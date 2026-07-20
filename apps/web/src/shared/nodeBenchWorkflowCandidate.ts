import {
  evaluateAgentOutput,
  type AgentOutputEnvelope,
} from "./agentOutputContract";
import {
  inspectNodeWorkflowCandidate,
  type CandidateAdmission,
  type NodeWorkflowRequest,
  type NodeWorkflowResult,
} from "./workflowExecutionPort";

export interface NodeBenchEvidenceBinding {
  claimId: string;
  sourceRefs: string[];
}

export interface NodeBenchWorkflowCandidate {
  kind: "answer-report-packet";
  outputs: AgentOutputEnvelope[];
  evidenceBindings: NodeBenchEvidenceBinding[];
}

/**
 * Evaluates a sidecar result as an unpersisted candidate. Artifact storage and
 * benchmark score writes remain in NodeBenchAI's existing Convex functions.
 */
export function inspectNodeBenchWorkflowCandidate(args: {
  request: NodeWorkflowRequest;
  result: NodeWorkflowResult<NodeBenchWorkflowCandidate>;
  expectedAppCommit: string;
  digestCandidate: (
    candidate: NodeBenchWorkflowCandidate,
  ) => string | Promise<string>;
  now?: () => Date;
}): Promise<CandidateAdmission<NodeBenchWorkflowCandidate>> {
  return inspectNodeWorkflowCandidate({
    ...args,
    expectedApp: "nodebenchai",
    validateCandidate: validateNodeBenchWorkflowCandidate,
  });
}

export function validateNodeBenchWorkflowCandidate(
  candidate: NodeBenchWorkflowCandidate,
): string[] {
  const issues: string[] = [];
  if (candidate?.kind !== "answer-report-packet") {
    return ["NodeBenchAI candidate must be an answer/report packet."];
  }
  if (
    !Array.isArray(candidate.outputs) ||
    candidate.outputs.length < 1 ||
    candidate.outputs.length > 128
  ) {
    issues.push(
      "NodeBenchAI candidate must contain 1 to 128 output envelopes.",
    );
    return issues;
  }

  const outputIds = new Set<string>();
  const knownSources = new Set<string>();
  for (const output of candidate.outputs) {
    if (outputIds.has(output.id))
      issues.push(`Duplicate NodeBenchAI output: ${output.id}.`);
    outputIds.add(output.id);
    for (const sourceRef of [...output.sourceRefs, ...output.citationRefs]) {
      knownSources.add(sourceRef);
    }
    const evaluation = evaluateAgentOutput(output);
    for (const issue of evaluation.issues.filter(
      (item) => item.severity === "error",
    )) {
      issues.push(`${output.id}: ${issue.code} ${issue.message}`);
    }
  }

  if (
    !Array.isArray(candidate.evidenceBindings) ||
    candidate.evidenceBindings.length < 1 ||
    candidate.evidenceBindings.length > 512
  ) {
    issues.push(
      "NodeBenchAI candidate must contain bounded evidence bindings.",
    );
    return [...new Set(issues)];
  }
  const claimIds = new Set<string>();
  for (const binding of candidate.evidenceBindings) {
    if (!bounded(binding.claimId, 1, 256))
      issues.push("NodeBenchAI claim ID is invalid.");
    if (claimIds.has(binding.claimId))
      issues.push(`Duplicate NodeBenchAI claim: ${binding.claimId}.`);
    claimIds.add(binding.claimId);
    if (!Array.isArray(binding.sourceRefs) || binding.sourceRefs.length < 1) {
      issues.push(`NodeBenchAI claim ${binding.claimId} has no evidence.`);
    } else if (
      binding.sourceRefs.some((sourceRef) => !knownSources.has(sourceRef))
    ) {
      issues.push(
        `NodeBenchAI claim ${binding.claimId} references unknown evidence.`,
      );
    }
  }
  return [...new Set(issues)];
}

function bounded(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= min &&
    value.length <= max
  );
}
