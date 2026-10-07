import { useMemo, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  GitBranch,
  MapPin,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ProductComposerMode } from "@/features/product/components/ProductIntakeComposer";
import {
  inferCaptureRoute,
  type CaptureRoute,
} from "@/features/product/lib/captureRouter";

type SimpleFile = { name: string; size?: number };

export type ComposerRoutingPreviewProps = {
  text: string;
  files: ReadonlyArray<SimpleFile>;
  mode?: ProductComposerMode;
  activeContextLabel?: string | null;
  compact?: boolean;
  className?: string;
};

export function ComposerRoutingPreview({
  text,
  files,
  mode = "ask",
  activeContextLabel,
  compact = false,
  className,
}: ComposerRoutingPreviewProps) {
  const route = useMemo(
    () => inferCaptureRoute({ text, files, mode, activeContextLabel }),
    [activeContextLabel, files, mode, text],
  );

  if (!text.trim() && files.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Composer routing preview"
      className={cn(
        "rounded-md border border-white/[0.08] bg-[#111418]/80 text-white shadow-[0_12px_40px_rgba(0,0,0,0.18)]",
        compact ? "px-3 py-2" : "px-4 py-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded border border-[#d97757]/25 bg-[#d97757]/10 px-2 py-1 text-[11px] font-medium text-[#e59579]">
          <GitBranch size={12} aria-hidden />
          {intentLabel(route.intent)}
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-white/70">
          <MapPin size={12} aria-hidden />
          {route.targetLabel}
        </span>
        <ConfidencePill route={route} />
        <span className="min-w-[7rem] flex-1 text-xs text-white/50">
          {route.reason}
        </span>
      </div>

      {!compact && (
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <PreviewList
            icon={<Sparkles size={13} aria-hidden />}
            label="Entities"
            empty="No entity yet"
            items={route.entities.map((entity) => `${entity.name} - ${entity.type}`)}
          />
          <PreviewList
            icon={<ShieldCheck size={13} aria-hidden />}
            label="Claims"
            empty="No claim yet"
            items={route.claims.map((claim) => claim.text)}
          />
          <PreviewList
            icon={<ClipboardList size={13} aria-hidden />}
            label="Next"
            empty="Waiting"
            items={route.nextActions}
          />
        </div>
      )}

      {compact && (route.entities.length > 0 || route.claims.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {route.entities.slice(0, 4).map((entity) => (
            <span
              key={`${entity.type}:${entity.name}`}
              className="max-w-[12rem] truncate rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[11px] text-white/60"
              title={`${entity.name} - ${entity.type}`}
            >
              {entity.name}
            </span>
          ))}
          {route.claims.slice(0, 2).map((claim, index) => (
            <span
              key={`${index}:${claim.text}`}
              className="max-w-[18rem] truncate rounded border border-[#d97757]/20 bg-[#d97757]/5 px-1.5 py-0.5 text-[11px] text-[#e7b29e]"
              title={claim.text}
            >
              {claim.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfidencePill({ route }: { route: CaptureRoute }) {
  const Icon = route.needsConfirmation ? AlertTriangle : CheckCircle2;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px]",
        route.needsConfirmation
          ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
          : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
      )}
    >
      <Icon size={12} aria-hidden />
      {Math.round(route.confidence * 100)}% - {route.needsConfirmation ? "confirm" : "auto"}
    </span>
  );
}

function PreviewList({
  icon,
  label,
  empty,
  items,
}: {
  icon: ReactNode;
  label: string;
  empty: string;
  items: string[];
}) {
  return (
    <div className="min-w-0 rounded border border-white/[0.06] bg-white/[0.02] p-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-white/45">
        {icon}
        {label}
      </div>
      {items.length > 0 ? (
        <ul className="space-y-1 text-xs text-white/68">
          {items.slice(0, 3).map((item) => (
            <li key={item} className="truncate" title={item}>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-white/35">{empty}</p>
      )}
    </div>
  );
}

function intentLabel(intent: CaptureRoute["intent"]) {
  switch (intent) {
    case "capture_field_note":
      return "Field note";
    case "ask_question":
      return "Question";
    case "append_to_report":
      return "Report append";
    case "create_followup":
      return "Follow-up";
    case "expand_entity":
      return "Entity expansion";
  }
}
