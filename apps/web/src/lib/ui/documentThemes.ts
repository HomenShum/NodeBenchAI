import type { FileType } from "./fileTypes";

export type DocumentCardTheme = {
  ring: string;
  gradient: string;
  iconBg: string;
  label: string;
  watermarkText: string;
};

// Note: Use fully static Tailwind class strings to ensure JIT picks them up.
export function getThemeForFileType(type: FileType): DocumentCardTheme {
  switch (type) {
    case "nbdoc":
      return {
        ring: "ring-1 ring-blue-400/25",
        gradient: "bg-gradient-to-br from-blue-50/10 to-transparent",
        iconBg: "bg-blue-500",
        label: "bg-blue-500/10 border-blue-500/30 text-blue-700",
        watermarkText: "text-blue-500",
      } as const;
    case "csv":
    case "excel":
      return {
        ring: "ring-1 ring-indigo-400/25",
        gradient: "bg-gradient-to-br from-indigo-50/10 to-transparent",
        iconBg: "bg-indigo-500",
        label: "bg-indigo-500/10 border-indigo-500/30 text-content-secondary",
        watermarkText: "text-indigo-500",
      } as const;
    case "pdf":
      return {
        ring: "ring-1 ring-red-400/25",
        gradient: "bg-gradient-to-br from-red-50/10 to-transparent",
        iconBg: "bg-red-500",
        label: "bg-red-500/10 border-red-500/30 text-red-700",
        watermarkText: "text-red-500",
      } as const;
    case "video":
      return {
        ring: "ring-1 ring-violet-400/25",
        gradient: "bg-gradient-to-br from-violet-50/10 to-transparent",
        iconBg: "bg-violet-500",
        label: "bg-violet-500/10 border-violet-500/30 text-violet-700",
        watermarkText: "text-violet-500",
      } as const;
    case "audio":
      return {
        ring: "ring-1 ring-amber-400/25",
        gradient: "bg-gradient-to-br from-amber-50/10 to-transparent",
        iconBg: "bg-amber-500",
        label: "bg-amber-500/10 border-amber-500/30 text-amber-700",
        watermarkText: "text-amber-500",
      } as const;
    case "image":
      return {
        ring: "ring-1 ring-cyan-400/25",
        gradient: "bg-gradient-to-br from-cyan-50/10 to-transparent",
        iconBg: "bg-cyan-500",
        label: "bg-cyan-500/10 border-cyan-500/30 text-cyan-700",
        watermarkText: "text-cyan-500",
      } as const;
    case "text":
    case "document":
      return {
        ring: "ring-1 ring-gray-400/20",
        gradient: "bg-gradient-to-br from-gray-50/10 to-transparent",
        iconBg: "bg-gray-500",
        label: "bg-gray-500/10 border-gray-500/30 text-content-secondary",
        watermarkText: "text-content-secondary",
      } as const;
    case "code":
      return {
        ring: "ring-1 ring-yellow-400/25",
        gradient: "bg-gradient-to-br from-yellow-50/10 to-transparent",
        iconBg: "bg-yellow-500",
        label: "bg-yellow-500/10 border-yellow-500/30 text-yellow-700",
        watermarkText: "text-yellow-500",
      } as const;
    case "json":
      return {
        ring: "ring-1 ring-sky-400/25",
        gradient: "bg-gradient-to-br from-sky-50/10 to-transparent",
        iconBg: "bg-sky-500",
        label: "bg-sky-500/10 border-sky-500/30 text-sky-700",
        watermarkText: "text-sky-500",
      } as const;
    case "web":
      return {
        ring: "ring-1 ring-indigo-400/25",
        gradient: "bg-gradient-to-br from-indigo-50/10 to-transparent",
        iconBg: "bg-indigo-500",
        label: "bg-indigo-500/10 border-indigo-500/30 text-indigo-700",
        watermarkText: "text-indigo-500",
      } as const;
    case "dossier":
      return {
        ring: "ring-1 ring-purple-400/30",
        gradient: "bg-gradient-to-br from-purple-50/15 to-indigo-50/10",
        iconBg: "bg-gradient-to-br from-purple-500 to-indigo-600",
        label: "bg-purple-500/10 border-purple-500/30 text-purple-700",
        watermarkText: "text-purple-400",
      } as const;
    case "unknown":
    default:
      return {
        ring: "",
        gradient: "",
        iconBg: "bg-[var(--accent-primary)]",
        label: "bg-surface border-edge text-content-secondary",
        watermarkText: "text-content-secondary",
      } as const;
  }
}
