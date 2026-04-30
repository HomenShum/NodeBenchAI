export type ReportActionId =
  | "open_brief"
  | "open_sources"
  | "open_notebook"
  | "resume_chat"
  | "export_crm_csv";

export type ReportActionTarget = "button" | "download";

export type ReportActionItem = {
  id: ReportActionId;
  label: string;
  ariaLabel: string;
  target: ReportActionTarget;
};

export type ReportActionCard = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  state: string;
  sources: number;
  updated: string;
  watched: boolean;
};

export const REPORT_CONTEXTUAL_ACTIONS: ReportActionItem[] = [
  {
    id: "open_brief",
    label: "Brief",
    ariaLabel: "Open report brief",
    target: "button",
  },
  {
    id: "open_sources",
    label: "Sources",
    ariaLabel: "Open report sources",
    target: "button",
  },
  {
    id: "open_notebook",
    label: "Notebook",
    ariaLabel: "Open report notebook",
    target: "button",
  },
  {
    id: "resume_chat",
    label: "Chat",
    ariaLabel: "Resume report chat",
    target: "button",
  },
  {
    id: "export_crm_csv",
    label: "Export",
    ariaLabel: "Export report to CRM CSV",
    target: "download",
  },
];

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export function createReportCrmCsv(report: ReportActionCard) {
  const headers = [
    "record_type",
    "name",
    "category",
    "status",
    "summary",
    "source_count",
    "updated",
    "nodebench_report_id",
    "watched",
  ];
  const values = [
    "company",
    report.title,
    report.kind,
    report.state,
    report.summary,
    report.sources,
    report.updated,
    report.id,
    report.watched ? "true" : "false",
  ];
  return `${headers.map(csvCell).join(",")}\n${values.map(csvCell).join(",")}\n`;
}

export function downloadReportCrmCsv(report: ReportActionCard) {
  if (typeof window === "undefined") return;
  const csv = createReportCrmCsv(report);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${report.id || "nodebench-report"}-crm.csv`;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
