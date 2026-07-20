import type { Id } from "../../../../convex/_generated/dataModel";
import type {
  ApprovalRequestPayload,
  ArtifactPayload,
  CalculationPayload,
  EvidencePayload,
  ExtractionPayload,
  ResultPayload,
  RunBriefPayload,
  StepKind,
  StepStatus,
  ToolCallPayload,
  ValidationPayload,
} from "../types";
import { ApprovalCard } from "./ApprovalCard";
import { ArtifactCard } from "./ArtifactCard";
import { CalculationCard } from "./CalculationCard";
import { EvidenceCard } from "./EvidenceCard";
import { ExtractionCard } from "./ExtractionCard";
import { ResultCard } from "./ResultCard";
import { RunBriefCard } from "./RunBriefCard";
import { StepShell } from "./StepShell";
import { ToolCallCard } from "./ToolCallCard";
import { ValidationCard } from "./ValidationCard";

export interface StepRecord {
  _id: Id<"financialOperatorSteps">;
  runId: Id<"financialOperatorRuns">;
  seq: number;
  kind: StepKind;
  status: StepStatus;
  title: string;
  payload?: unknown;
  durationMs?: number;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

interface Props {
  step: StepRecord;
}

/**
 * Switch on step.kind, render the right card body inside the common shell.
 * Each card receives the typed payload — the shell carries seq + status +
 * duration + error.
 */
export function StepCard({ step }: Props) {
  const body = renderBody(step);
  return (
    <StepShell
      kind={step.kind}
      status={step.status}
      title={step.title}
      seq={step.seq}
      durationMs={step.durationMs}
      errorMessage={step.errorMessage}
    >
      {body}
    </StepShell>
  );
}

function renderBody(step: StepRecord) {
  const p = step.payload as Record<string, unknown> | undefined;
  if (!p) {
    return (
      <p className="text-[12px] text-content-muted italic">
        No payload recorded.
      </p>
    );
  }
  switch (step.kind) {
    case "run_brief":
      return <RunBriefCard data={p as unknown as RunBriefPayload} />;
    case "tool_call":
      return <ToolCallCard data={p as unknown as ToolCallPayload} />;
    case "extraction":
      return <ExtractionCard data={p as unknown as ExtractionPayload} />;
    case "validation":
      return <ValidationCard data={p as unknown as ValidationPayload} />;
    case "calculation":
      return <CalculationCard data={p as unknown as CalculationPayload} />;
    case "evidence":
      return <EvidenceCard data={p as unknown as EvidencePayload} />;
    case "artifact":
      return <ArtifactCard data={p as unknown as ArtifactPayload} />;
    case "approval_request": {
      const data = p as unknown as ApprovalRequestPayload & {
        selectedOptionId?: ApprovalRequestPayload["options"][number]["id"];
      };
      return (
        <ApprovalCard
          runId={step.runId}
          stepId={step._id}
          status={step.status}
          data={data}
          selectedOptionId={data.selectedOptionId}
        />
      );
    }
    case "result":
      return <ResultCard data={p as unknown as ResultPayload} />;
    default:
      return (
        <p className="text-[12px] text-content-muted italic">
          Unknown step kind.
        </p>
      );
  }
}
