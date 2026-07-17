import { memo, useEffect } from "react";
import { Globe, Link2, Lock, FileDown, FileText, Printer, ExternalLink, X, Check } from "lucide-react";
import { Sheet, SheetContent, SheetOverlay, SheetPortal } from "@/components/ai-ui/sheet";

export type ReportVisibility = "private" | "public";

export interface ReportShareSheetProps {
  open: boolean;
  onClose: () => void;
  entityName: string;
  shareUrl: string;
  visibility: ReportVisibility;
  onVisibilityChange: (next: ReportVisibility) => void;
  linkCopied?: boolean;
  onCopyLink: () => void;
  onDownloadMarkdown: () => void;
  onDownloadPdf: () => void;
  onDownloadDocx?: () => void;
  termsHref?: string;
}

const haptic = (pattern: number | number[] = 10) => {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
};

export const ReportShareSheet = memo(function ReportShareSheet({
  open,
  onClose,
  entityName,
  shareUrl,
  visibility,
  onVisibilityChange,
  linkCopied,
  onCopyLink,
  onDownloadMarkdown,
  onDownloadPdf,
  onDownloadDocx,
  termsHref = "/legal",
}: ReportShareSheetProps) {
  useEffect(() => {
    if (!open) return;
    haptic(12);
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) { haptic(6); onClose(); } }}>
      <SheetPortal>
        <SheetOverlay asChild className="z-[60] bg-black/40 backdrop-blur-md">
          <button
            type="button"
            aria-label="Close share panel"
            onClick={() => {
              haptic(6);
              onClose();
            }}
          />
        </SheetOverlay>
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-end justify-center">
          <SheetContent
            aria-label={`Share ${entityName}`}
            showCloseButton={false}
            onPointerDownOutside={(event) => event.preventDefault()}
            className="pointer-events-auto relative w-full max-w-[520px] rounded-t-[26px] border-t border-[var(--nb-border-faint)] bg-[var(--nb-surface-overlay)] px-2 pb-[calc(env(safe-area-inset-bottom)+96px)] pt-2 shadow-[0_-24px_60px_-30px_rgba(0,0,0,0.95)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full motion-reduce:animate-none sm:mb-4 sm:max-w-[360px] sm:rounded-[22px] sm:border sm:pb-[max(12px,env(safe-area-inset-bottom))]"
          >
            <div>
            <div className="mx-auto mt-1 mb-2 h-[5px] w-[36px] rounded-full bg-white/[0.18]" aria-hidden="true" />
            <div className="mb-2 flex items-center justify-between px-3">
              <h2 className="nb-text-title truncate text-gray-50">Share {entityName}</h2>
              <button
                type="button"
                onClick={() => {
                  haptic(6);
                  onClose();
                }}
                aria-label="Close"
                className="nb-pressable inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-white/[0.08] hover:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-3 px-2">
              <span className="px-1 nb-text-meta text-gray-300">Visibility</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <VisibilityOption
                  icon={Lock}
                  label="Only me"
                  description="Private to your account."
                  active={visibility === "private"}
                  onSelect={() => {
                    haptic(6);
                    onVisibilityChange("private");
                  }}
                />
                <VisibilityOption
                  icon={Globe}
                  label="Public"
                  description="Anyone with the link."
                  active={visibility === "public"}
                  onSelect={() => {
                    haptic(6);
                    onVisibilityChange("public");
                  }}
                />
              </div>
            </div>

            <div className="px-2">
              <span className="px-1 nb-text-meta text-gray-300">Actions</span>
              <ul className="mt-1 flex flex-col">
                <ActionRow
                  icon={linkCopied ? Check : Link2}
                  label={linkCopied ? "Link copied" : "Copy link"}
                  onSelect={() => {
                    haptic(10);
                    onCopyLink();
                  }}
                  subtitle={shareUrl}
                  accent={linkCopied ? "success" : undefined}
                />
                <ActionRow
                  icon={Printer}
                  label="Download as PDF"
                  subtitle="Uses your browser's print → save as PDF."
                  onSelect={() => {
                    haptic(8);
                    onDownloadPdf();
                  }}
                />
                <ActionRow
                  icon={FileText}
                  label="Download as Markdown"
                  subtitle=".md with full report body."
                  onSelect={() => {
                    haptic(8);
                    onDownloadMarkdown();
                  }}
                />
                {onDownloadDocx ? (
                  <ActionRow
                    icon={FileDown}
                    label="Download as Word (.doc)"
                    subtitle="Opens in Microsoft Word, Pages, or Google Docs."
                    onSelect={() => {
                      haptic(8);
                      onDownloadDocx();
                    }}
                  />
                ) : null}
              </ul>
            </div>

            <div className="mt-3 flex items-center justify-center gap-1 px-2 pb-1 text-[11px] text-gray-500">
              <a
                href={termsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-gray-300"
              >
                Terms of service
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            </div>
          </SheetContent>
        </div>
      </SheetPortal>
    </Sheet>
  );
});

interface VisibilityOptionProps {
  icon: typeof Lock;
  label: string;
  description: string;
  active: boolean;
  onSelect: () => void;
}

const VisibilityOption = memo(function VisibilityOption({
  icon: Icon,
  label,
  description,
  active,
  onSelect,
}: VisibilityOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`nb-pressable flex flex-col items-start gap-1 rounded-[16px] border px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
        active
          ? "border-white/30 bg-white/[0.08] text-white"
          : "border-[var(--nb-border-faint)] bg-white/[0.02] text-gray-300 hover:border-[var(--nb-border-soft)] hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${active ? "text-white" : "text-gray-400"}`} />
        <span className="text-[13px] font-semibold">{label}</span>
      </div>
      <span className="text-[11px] leading-4 text-gray-400">{description}</span>
    </button>
  );
});

interface ActionRowProps {
  icon: typeof Link2;
  label: string;
  subtitle?: string;
  onSelect: () => void;
  disabled?: boolean;
  accent?: "success";
}

function ActionRow({ icon: Icon, label, subtitle, onSelect, disabled, accent }: ActionRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className={`nb-pressable flex min-h-[48px] w-full items-start gap-3 rounded-[14px] px-3 py-3.5 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
          disabled
            ? "cursor-not-allowed opacity-40"
            : accent === "success"
              ? "text-emerald-300 hover:bg-emerald-500/10"
              : "text-gray-100 hover:bg-white/[0.06]"
        }`}
      >
        <Icon className={`h-5 w-5 shrink-0 ${accent === "success" ? "text-emerald-400" : "text-gray-300"}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium">{label}</div>
          {subtitle ? <div className="mt-0.5 truncate text-[11px] text-gray-400">{subtitle}</div> : null}
        </div>
      </button>
    </li>
  );
}
