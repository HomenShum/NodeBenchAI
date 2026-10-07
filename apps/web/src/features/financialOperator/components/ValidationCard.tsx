import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import type { ValidationPayload, ValidationFinding } from "../types";

interface Props {
  data: ValidationPayload;
}

function FindingIcon({ level }: { level: ValidationFinding["level"] }) {
  if (level === "error") {
    return <AlertCircle className="h-3.5 w-3.5 text-red-300" aria-label="Error" />;
  }
  if (level === "warning") {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-label="Warning" />;
  }
  return <Info className="h-3.5 w-3.5 text-blue-300" aria-label="Info" />;
}

/**
 * Validation card — schema/units/range checks + findings list.
 * Counts shown verbatim (HONEST_SCORES). Findings never swallowed.
 */
export function ValidationCard({ data }: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
        <Stat label="Schema" value={data.schemaPassed ? "Pass" : "Fail"} ok={data.schemaPassed} />
        <Stat
          label="Units"
          value={data.unitsNormalized ? "Normalized" : "Mismatch"}
          ok={data.unitsNormalized}
        />
        <Stat label="Checks run" value={String(data.checksRun)} />
        <Stat
          label="Checks passed"
          value={`${data.checksPassed}/${data.checksRun}`}
          ok={data.checksPassed === data.checksRun}
        />
      </div>
      {data.findings.length > 0 ? (
        <ul className="space-y-1.5">
          {data.findings.map((f, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded border border-edge bg-surface/40 px-2.5 py-1.5 text-[13px] text-content-secondary"
            >
              <span className="mt-0.5 flex-shrink-0">
                <FindingIcon level={f.level} />
              </span>
              <span>
                {f.fieldRef && (
                  <span className="font-mono text-[12px] text-content-muted">
                    [{f.fieldRef}]{" "}
                  </span>
                )}
                {f.message}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-content-muted">
          No findings — all checks passed cleanly.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean;
}) {
  const tone =
    ok === undefined
      ? "text-content"
      : ok
        ? "text-emerald-200"
        : "text-amber-200";
  return (
    <div className="rounded border border-edge bg-surface/40 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-content-muted">
        {label}
      </div>
      <div className={`font-mono text-[13px] ${tone}`}>{value}</div>
    </div>
  );
}
