import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { ReportReadOnlyPanel } from "@/features/reports/components/ReportReadOnlyPanel";

function getReportIdFromPath(): string | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname.replace(/^\/report\//, "").replace(/\/$/, "");
  return path ? decodeURIComponent(path) : null;
}

export function PublicReportView() {
  const api = useConvexApi();
  const reportId = useMemo(() => getReportIdFromPath(), []);
  const report = useQuery(
    (api?.domains?.product?.reports as any)?.getPublicReport ?? "skip",
    api?.domains?.product?.reports && reportId ? { reportId } : "skip",
  ) as any;

  return (
    <div className="min-h-screen bg-[#0c0b0a] px-4 py-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto mb-5 flex w-full max-w-3xl items-center justify-between gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-white/78 transition hover:border-white/[0.16] hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to NodeBench
        </Link>
      </div>

      {report === undefined ? (
        <div className="mx-auto max-w-3xl rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 text-[14px] text-white/70">
          Loading report…
        </div>
      ) : report ? (
        <ReportReadOnlyPanel report={report} />
      ) : (
        <div className="mx-auto max-w-3xl rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6">
          <h1 className="text-[22px] font-semibold text-white">Report unavailable</h1>
          <p className="mt-2 text-[14px] leading-7 text-white/68">
            This report is not public, was removed, or the link is invalid.
          </p>
        </div>
      )}
    </div>
  );
}

export default PublicReportView;
