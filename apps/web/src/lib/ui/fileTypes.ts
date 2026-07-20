export type FileType =
  | "nbdoc"
  | "csv"
  | "excel"
  | "pdf"
  | "video"
  | "audio"
  | "image"
  | "text"
  | "code"
  | "json"
  | "web"
  | "document"
  | "dossier"
  | "unknown";

export const FILE_TYPE_COLORS: Record<FileType, string> = {
  nbdoc: "#3b82f6", // blue-500
  csv: "#10b981", // indigo-500
  excel: "#10b981", // indigo-500
  pdf: "#ef4444", // red-500
  video: "#8b5cf6", // violet-500
  audio: "#f59e0b", // amber-500
  image: "#06b6d4", // cyan-500
  text: "#6b7280", // gray-500
  code: "#eab308", // yellow-500
  json: "#0ea5e9", // sky-500
  web: "#6366f1", // indigo-500
  document: "#6b7280", // gray-500
  dossier: "#9333ea", // purple-600
  unknown: "#9ca3af", // gray-400
};

export function inferFileType(args: {
  name?: string;
  mimeType?: string | null;
  isNodebenchDoc?: boolean;
}): FileType {
  const { name, mimeType, isNodebenchDoc } = args;
  if (isNodebenchDoc) return "nbdoc";

  const mt = (mimeType || "").toLowerCase();
  if (mt.includes("html")) return "web";
  if (mt.startsWith("video/")) return "video";
  if (mt.startsWith("audio/")) return "audio";
  if (mt.startsWith("image/")) return "image";
  if (mt === "application/pdf" || mt.includes("pdf")) return "pdf";
  if (mt.includes("csv")) return "csv";
  if (mt.includes("spreadsheet") || mt.includes("excel")) return "excel";
  if (mt.includes("json")) return "json";
  if (mt.startsWith("text/")) return "text";

  const n = (name || "").toLowerCase();
  // Detect URLs in names/titles
  if (n.startsWith("http://") || n.startsWith("https://") || n.startsWith("www.")) return "web";
  const ext = n.split(".").pop() || "";
  if (["mp4", "mov", "avi", "webm", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "csv") return "csv";
  if (["xlsx", "xls"].includes(ext)) return "excel";
  if (ext === "json") return "json";
  if (["md", "markdown", "txt"].includes(ext)) return "text";
  if (["js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "html", "css", "scss", "sh"].includes(ext)) return "code";

  return "unknown";
}
