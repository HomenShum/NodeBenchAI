import React from "react";
import { Clock, Link2, Info, Folder } from "lucide-react";
import type { Pill as MappedPill } from "../lib/metaPillMappers";

export type MetaPillItem = {
  // Primary type pill
  typeLabel?: string;
  typeIcon?: React.ReactNode;
  // Optional project pill
  projectLabel?: string;
  // When (due, time) pill
  whenLabel?: string;
  // Link pill
  linkLabel?: string;
  linkHref?: string;
  // Updated pill (explicit, if distinct from when)
  updatedLabel?: string;
  // Details pill
  detailsLabel?: string;
};

export interface MetaPillsProps {
  // New API: array of mapped pills
  pills?: MappedPill[];
  // Back-compat: legacy single data object
  data?: MetaPillItem;
  className?: string; // container class, defaults to document-card__pills
  max?: number; // max pills to show (default 5)
  // Allow caller to customize type pill colors (e.g., themed label styles)
  typePillClassName?: string;
}

const truncate = (s: string, n = 22) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function MetaPills({ pills, data, className, max = 5, typePillClassName = "" }: MetaPillsProps) {
  // Build a normalized list of pills to render
  const fromMapped = (pills ?? []).slice(0, max).map((p) => {
    const base =
      p.kind === "type"
        ? `pill pill--type ${typePillClassName}`.trim()
        : p.kind === "project"
        ? "pill pill--project"
        : p.kind === "when"
        ? "pill pill--time"
        : p.kind === "link"
        ? "pill pill--link"
        : p.kind === "updated"
        ? "pill pill--updated"
        : "pill pill--details"; // default
    return {
      key: p.kind,
      className: base,
      // Mapped pills use emoji icons as strings
      icon: p.icon ? <span className="text-[13px] leading-none" aria-hidden>{p.icon}</span> : null,
      label: p.label,
      isLink: p.kind === "link" && !!p.href,
      href: p.href,
    };
  });

  // Legacy support: synthesize pills from `data` if provided and no mapped `pills` passed
  const fromData: Array<{
    key: string;
    className: string;
    icon?: React.ReactNode;
    label: string;
    isLink?: boolean;
    href?: string;
  }> = [];

  if (!pills && data) {
    if (data.typeLabel) {
      fromData.push({
        key: "type",
        className: `pill pill--type ${typePillClassName}`.trim(),
        icon: data.typeIcon,
        label: data.typeLabel,
      });
    }
    if (data.projectLabel) {
      fromData.push({
        key: "project",
        className: "pill pill--project",
        icon: <Folder className="h-3 w-3" />,
        label: data.projectLabel,
      });
    }
    if (data.whenLabel) {
      fromData.push({
        key: "when",
        className: "pill pill--time",
        icon: <Clock className="h-3 w-3" />,
        label: data.whenLabel,
      });
    }
    if (data.linkLabel) {
      fromData.push({
        key: "link",
        className: "pill pill--link",
        icon: <Link2 className="h-3 w-3" />,
        label: data.linkLabel,
        isLink: !!data.linkHref,
        href: data.linkHref,
      });
    }
    if (data.updatedLabel) {
      fromData.push({
        key: "updated",
        className: "pill pill--updated",
        icon: <Clock className="h-3 w-3" />,
        label: data.updatedLabel,
      });
    }
    if (data.detailsLabel) {
      fromData.push({
        key: "details",
        className: "pill pill--details",
        icon: <Info className="h-3 w-3" />,
        label: data.detailsLabel,
      });
    }
  }

  const toRender = fromMapped.length > 0 ? fromMapped : fromData.slice(0, max);

  return (
    <div className={className ?? "document-card__pills"}>
      {toRender.map((p) => (
        <div key={p.key} className={p.className} title={p.label}>
          {p.icon}
          {p.isLink && p.href ? (
            <a
              className="truncate hover:underline"
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {truncate(p.label)}
            </a>
          ) : (
            <span className="truncate">{truncate(p.label)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default MetaPills;
