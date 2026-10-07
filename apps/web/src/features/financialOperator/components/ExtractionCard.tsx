import { AlertTriangle, Check, HelpCircle } from "lucide-react";
import type { ExtractionPayload, ExtractedField } from "../types";

interface Props {
  data: ExtractionPayload;
}

function formatValue(field: ExtractedField): string {
  if (field.value === null || field.value === undefined) return "—";
  if (typeof field.value === "number") {
    if (field.unit === "USD_millions") {
      return `$${field.value.toLocaleString()}M`;
    }
    if (field.unit === "decimal") {
      return `${(field.value * 100).toFixed(2)}%`;
    }
    if (field.unit === "percent") {
      return `${field.value}%`;
    }
    return field.value.toLocaleString();
  }
  return String(field.value);
}

function StatusIcon({ status }: { status: ExtractedField["status"] }) {
  if (status === "verified") {
    return (
      <Check
        className="h-3.5 w-3.5 text-emerald-300"
        aria-label="Verified"
      />
    );
  }
  if (status === "needs_review") {
    return (
      <AlertTriangle
        className="h-3.5 w-3.5 text-amber-300"
        aria-label="Needs review"
      />
    );
  }
  return (
    <HelpCircle
      className="h-3.5 w-3.5 text-content-muted"
      aria-label="Unresolved"
    />
  );
}

/**
 * Extraction card — one row per field with value, source, confidence, status.
 * Confidence is shown verbatim (HONEST_SCORES — no rounding to 100%).
 */
export function ExtractionCard({ data }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-content-muted">
        <span className="rounded-full border border-edge bg-surface/40 px-2 py-0.5 font-mono">
          schema: {data.schemaName}
        </span>
        <span>{data.totalFound} fields</span>
        {data.needsReviewCount > 0 && (
          <span className="text-amber-200">
            {data.needsReviewCount} need review
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {data.fields.map((field) => (
          <li
            key={field.fieldName}
            className="rounded border border-edge bg-surface/40 p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <StatusIcon status={field.status} />
                <span className="text-sm font-medium text-content">
                  {field.fieldName}
                </span>
              </div>
              <span className="font-mono text-sm text-content">
                {formatValue(field)}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-1 gap-1 text-[12px] text-content-muted sm:grid-cols-3">
              <div>
                <dt className="inline">Source: </dt>
                <dd className="inline text-content-secondary">{field.sourceRef}</dd>
              </div>
              <div>
                <dt className="inline">Confidence: </dt>
                <dd className="inline text-content-secondary">
                  {field.confidence.toFixed(2)}
                </dd>
              </div>
              <div>
                <dt className="inline">Unit: </dt>
                <dd className="inline text-content-secondary">{field.unit ?? "—"}</dd>
              </div>
            </dl>
            {field.reviewNote && (
              <p className="mt-2 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[12px] text-amber-100/90">
                {field.reviewNote}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
