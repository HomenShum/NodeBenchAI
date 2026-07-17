import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ArrowUp, Camera, CheckSquare, FileText, Loader2, Mic, Paperclip, Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { LENSES, type LensId } from "@/features/controlPlane/components/searchTypes";
import type { ProductDraftFile } from "@/features/product/lib/productSession";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import {
  useRollbackInterceptor,
  type RollbackOutcome,
} from "@/features/chat/hooks/useRollbackInterceptor";
import { ToggleGroup, ToggleGroupItem } from "@/components/ai-ui/toggle-group";

export type ProductComposerMode = "ask" | "note" | "task";

export type ProductResearchLane = {
  id: string;
  label: string;
  note: string;
};

type ProductIntakeComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFilesSelected: (files: File[]) => Promise<void> | void;
  onSecondaryAction?: (() => void) | null;
  secondaryActionLabel?: string | null;
  secondaryActionAriaLabel?: string | null;
  files: ProductDraftFile[];
  lens: LensId;
  onLensChange: (lens: LensId) => void;
  operatorContextLabel?: string | null;
  operatorContextHint?: string | null;
  uploadingFiles?: boolean;
  submitPending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  helperText?: string;
  submitLabel?: string;
  className?: string;
  variant?: "page" | "drawer" | "chat";
  showLensSelector?: boolean;
  showOperatorContextChip?: boolean;
  showOperatorContextHint?: boolean;
  autoFocus?: boolean;
  mode?: ProductComposerMode;
  onModeChange?: (mode: ProductComposerMode) => void;
  showCaptureModes?: boolean;
  onSaveCapture?: (mode: Exclude<ProductComposerMode, "ask">, value: string) => Promise<void> | void;
  captureSavePending?: boolean;
  compact?: boolean;
  chatUtilityLabel?: string | null;
  researchLanes?: readonly ProductResearchLane[];
  selectedResearchLane?: string;
  onResearchLaneChange?: (laneId: string) => void;
  /**
   * When provided, the composer intercepts rollback shortcuts (`/rollback`,
   * `/rollback 3`, "undo that", "revert that", etc.) before invoking
   * `onSubmit`. The interceptor calls the `rollbackToCheckpoint` Convex
   * action and surfaces a toast. Leave undefined to disable. (A-PR-A.4)
   */
  rollbackThreadId?: string | null;
  /** Optional callback fired after a rollback dispatches (success or failure). */
  onRollbackComplete?: (outcome: RollbackOutcome) => void;
};

export function ProductIntakeComposer({
  value,
  onChange,
  onSubmit,
  onFilesSelected,
  onSecondaryAction = null,
  secondaryActionLabel = null,
  secondaryActionAriaLabel = null,
  files,
  lens,
  onLensChange,
  operatorContextLabel,
  operatorContextHint,
  uploadingFiles = false,
  submitPending = false,
  disabled = false,
  placeholder = "Paste your notes, links, and ask here...",
  helperText = "Paste the full packet in one box, then drop PDFs, screenshots, or resumes below.",
  submitLabel = "Run",
  className,
  variant = "page",
  showLensSelector = true,
  showOperatorContextChip = true,
  showOperatorContextHint = true,
  autoFocus = false,
  mode = "ask",
  onModeChange,
  showCaptureModes = false,
  onSaveCapture,
  captureSavePending = false,
  compact = false,
  chatUtilityLabel = "M+1",
  researchLanes,
  selectedResearchLane,
  onResearchLaneChange,
  rollbackThreadId = null,
  onRollbackComplete,
}: ProductIntakeComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [captureAttachmentPending, setCaptureAttachmentPending] = useState(false);
  const [voicePending, setVoicePending] = useState(false);
  const isChatVariant = variant === "chat";
  const isDrawerVariant = variant === "drawer";
  const isCaptureMode = mode !== "ask";
  const isCompactChatVariant = isChatVariant && compact;
  const showIntegratedCaptureModes = showCaptureModes && Boolean(onModeChange && onSaveCapture);
  const showResearchLaneControls =
    !isChatVariant &&
    !isCaptureMode &&
    Boolean(researchLanes?.length && selectedResearchLane && onResearchLaneChange);

  const {
    isRecording,
    audioBlob,
    duration,
    error: voiceError,
    startRecording,
    stopRecording,
    clearRecording,
  } = useVoiceRecording();
  const realtimeVoice = useVoiceInput({
    mode: "browser",
    continuous: false,
    onTranscript: (text) => {
      if (text.trim()) onChange(text);
    },
    onEnd: (finalText) => {
      if (finalText.trim()) onChange(finalText);
    },
  });
  const { isCapturing, captureScreen, clearScreenshot } = useScreenCapture();

  const captureModes: Array<{ id: ProductComposerMode; label: string; icon: typeof FileText }> = [
    { id: "ask", label: "Ask", icon: Search },
    { id: "note", label: "Note", icon: FileText },
    { id: "task", label: "Task", icon: CheckSquare },
  ];
  const voiceActive =
    voicePending ||
    isRecording ||
    realtimeVoice.isListening ||
    realtimeVoice.isTranscribing;
  const showChatHelperText =
    !isChatVariant || isCaptureMode || dragActive || files.length > 0 || voiceActive || captureAttachmentPending;
  const showChatTextareaShell = isChatVariant;
  const utilityPillLabel = useMemo(() => {
    const normalized = chatUtilityLabel?.trim();
    if (normalized) return normalized;
    return "M+1";
  }, [chatUtilityLabel]);
  const secondaryChatActionLabel = useMemo(() => {
    const normalized = secondaryActionLabel?.trim();
    if (normalized) return normalized;
    return "Attach from Files";
  }, [secondaryActionLabel]);

  const attachmentLabel = useMemo(() => {
    if (isCaptureMode) {
      return mode === "note"
        ? "Quick notes save directly from this composer. Switch back to Ask for files and report runs."
        : "Quick tasks save directly from this composer. Switch back to Ask for files and report runs.";
    }
    if (files.length === 0) return helperText;
    return `${files.length} attachment${files.length === 1 ? "" : "s"} ready for the next run.`;
  }, [files.length, helperText, isCaptureMode, mode]);

  const effectivePlaceholder = useMemo(() => {
    if (mode === "note") return "Capture a thought worth keeping...";
    if (mode === "task") return "Capture a task, follow-up, or reminder...";
    return placeholder;
  }, [mode, placeholder]);
  const textareaAriaLabel =
    mode === "ask"
      ? showResearchLaneControls
        ? "Ask anything - a company, a market, or a question"
        : "Paste notes, links, or your ask"
      : `Write your ${mode}`;

  const primaryLabel = useMemo(() => {
    if (mode === "note") return captureSavePending ? "Saving..." : "Save note";
    if (mode === "task") return captureSavePending ? "Saving..." : "Save task";
    return submitPending ? "Running..." : submitLabel;
  }, [captureSavePending, mode, submitLabel, submitPending]);
  const primaryActionKey = useMemo(() => {
    if (mode === "note") return "save_note";
    if (mode === "task") return "save_task";
    if (submitPending) return "running";
    return submitLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }, [mode, submitLabel, submitPending]);

  const primaryDisabled =
    disabled ||
    captureAttachmentPending ||
    (mode === "ask"
      ? submitPending || !value.trim()
      : captureSavePending || !value.trim() || !onSaveCapture);

  // A-PR-A.4: rollback interceptor — short-circuits `/rollback`,
  // `/rollback N`, "undo that", "revert that", etc. before the LLM is
  // invoked. Disabled when no `rollbackThreadId` is provided so non-chat
  // composer instances behave exactly as before.
  const rollbackInterceptor = useRollbackInterceptor({
    threadId: rollbackThreadId ?? null,
    onRollback: onRollbackComplete,
    disabled: !rollbackThreadId,
  });

  const handlePrimaryAction = () => {
    if (primaryDisabled || !value.trim()) return;
    if (mode === "ask") {
      // Rollback shortcut takes precedence over the LLM submit. The
      // interceptor returns true when it consumed the input; the
      // composer is responsible for clearing the input afterward.
      if (rollbackThreadId) {
        const consumed = rollbackInterceptor.tryIntercept(value);
        void consumed.then((didIntercept) => {
          if (didIntercept) {
            onChange("");
          }
        });
        // We optimistically detect synchronously to decide whether to
        // bail from the LLM submit. Async dispatch continues in parallel.
        if (rollbackInterceptor.detect(value)) {
          return;
        }
      }
      onSubmit();
      return;
    }
    if (onSaveCapture) {
      void onSaveCapture(mode, value);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handlePrimaryAction();
    }
  };

  const attachGeneratedFile = async (file: File, successMessage: string) => {
    setCaptureAttachmentPending(true);
    try {
      await Promise.resolve(onFilesSelected([file]));
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to attach capture");
    } finally {
      setCaptureAttachmentPending(false);
    }
  };

  const openNativeFilePicker = () => {
    setAttachmentMenuOpen(false);
    fileInputRef.current?.click();
  };

  const handleAttachmentTrigger = () => {
    if (disabled || isCaptureMode || uploadingFiles || captureAttachmentPending) return;
    if (isChatVariant) {
      setAttachmentMenuOpen((current) => !current);
      return;
    }
    openNativeFilePicker();
  };

  const handleVoiceCapture = async () => {
    if (disabled || isCaptureMode || captureAttachmentPending) return;
    if (realtimeVoice.isListening || realtimeVoice.isTranscribing) {
      realtimeVoice.stop();
      return;
    }
    if (realtimeVoice.isSupported) {
      realtimeVoice.toggle();
      return;
    }
    if (isRecording) {
      setVoicePending(false);
      stopRecording();
      return;
    }
    setVoicePending(true);
    try {
      await startRecording();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start recording");
    } finally {
      setVoicePending(false);
    }
  };

  const handleScreenshotCapture = async () => {
    if (disabled || isCaptureMode || captureAttachmentPending) return;
    const screenshotData = await captureScreen();
    if (!screenshotData) return;
    try {
      const blob = await fetch(screenshotData).then((response) => response.blob());
      const file = new File([blob], `nodebench-screenshot-${Date.now()}.png`, {
        type: "image/png",
      });
      await attachGeneratedFile(file, "Screenshot attached");
    } finally {
      clearScreenshot();
    }
  };

  const handleDragState = (event: DragEvent<HTMLDivElement>, active: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || isCaptureMode) return;
    setDragActive(active);
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (disabled || isCaptureMode) return;
    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (!dropped.length) return;
    await onFilesSelected(dropped);
  };

  useEffect(() => {
    if (!voiceError) return;
    toast.error(voiceError);
  }, [voiceError]);

  useEffect(() => {
    if (!realtimeVoice.error) return;
    toast.error(realtimeVoice.error);
  }, [realtimeVoice.error]);

  useEffect(() => {
    if (!isCaptureMode || !isRecording) return;
    stopRecording();
  }, [isCaptureMode, isRecording, stopRecording]);

  useEffect(() => {
    if (!audioBlob) return;
    const extension = audioBlob.type.includes("webm")
      ? "webm"
      : audioBlob.type.includes("mp4")
        ? "m4a"
        : audioBlob.type.includes("ogg")
          ? "ogg"
          : "webm";
    const filename = `voice-memo-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
    const file = new File([audioBlob], filename, {
      type: audioBlob.type || "audio/webm",
      lastModified: Date.now(),
    });
    void Promise.resolve(onFilesSelected([file]))
      .then(() => {
        toast.success(`Voice memo attached (${Math.max(1, Math.round(duration))}s)`);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to attach voice memo");
      })
      .finally(() => {
        clearRecording();
      });
  }, [audioBlob, clearRecording, duration, onFilesSelected]);

  useEffect(() => {
    if (!attachmentMenuOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (attachmentMenuRef.current?.contains(target)) return;
      if (attachmentMenuButtonRef.current?.contains(target)) return;
      setAttachmentMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAttachmentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("touchstart", handlePointerDown, true);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("touchstart", handlePointerDown, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [attachmentMenuOpen]);

  useEffect(() => {
    if (!isCaptureMode) return;
    setAttachmentMenuOpen(false);
  }, [isCaptureMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("nodebench:voice-listening", {
        detail: { isListening: voiceActive },
      }),
    );
  }, [voiceActive]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxHeight = isDrawerVariant ? 224 : isChatVariant ? 112 : 320;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [isChatVariant, isDrawerVariant, value]);

  useEffect(() => {
    if (!autoFocus) return;
    textareaRef.current?.focus();
  }, [autoFocus]);

  return (
    <div
      data-nb-composer-root="intake"
      data-nb-composer-mode={mode}
      data-nb-composer-primary-action={primaryActionKey}
      data-nb-composer-placeholder={effectivePlaceholder}
      className={`${
        isDrawerVariant
          ? "rounded-[24px] p-2"
          : isChatVariant
            ? isCompactChatVariant
              ? "rounded-none p-0"
              : "rounded-[20px] p-0.5"
            : "rounded-[28px] p-2.5 sm:p-3"
      } border ${
        isChatVariant
          ? isCompactChatVariant
            ? "border-transparent bg-transparent shadow-none backdrop-blur-none"
            : "border-black/[0.045] bg-white/84 shadow-[0_20px_54px_-42px_rgba(15,23,42,0.18)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#111821]/78 dark:shadow-[0_24px_64px_-44px_rgba(0,0,0,0.9)]"
          : "border-gray-200 bg-white shadow-[0_18px_60px_-42px_rgba(15,23,42,0.32)] dark:border-[var(--nb-border-strong)] dark:bg-[var(--nb-surface-overlay)] dark:shadow-[0_28px_90px_-56px_rgba(0,0,0,0.82)]"
      } ${className ?? ""}`}
      onDragEnter={(event) => handleDragState(event, true)}
      onDragOver={(event) => handleDragState(event, true)}
      onDragLeave={(event) => handleDragState(event, false)}
      onDrop={handleDrop}
    >
      {showIntegratedCaptureModes ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(value) => value && onModeChange?.(value as ProductComposerMode)}
            aria-label="Composer mode"
            className={`inline-flex items-center gap-1 rounded-full p-1 ${
              isChatVariant
                ? "border border-gray-200 bg-gray-50/85 dark:border-white/[0.08] dark:bg-white/[0.03]"
                : "border border-gray-200 bg-gray-50/80 dark:border-white/[0.08] dark:bg-white/[0.03]"
            }`}
          >
            {captureModes.map(({ id, label, icon: Icon }) => (
              <ToggleGroupItem
                key={id}
                value={id}
                data-state={mode === id ? "active" : "inactive"}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-fast ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 motion-reduce:transform-none motion-reduce:transition-none ${
                  mode === id
                    ? isChatVariant
                      ? "border-gray-200 bg-white text-gray-900 shadow-sm dark:border-white/[0.12] dark:bg-white/[0.1] dark:text-white"
                      : "border-gray-200 bg-white text-gray-900 shadow-sm dark:border-white/[0.12] dark:bg-white/[0.08] dark:text-gray-50"
                    : isChatVariant
                      ? "border-transparent text-gray-500 hover:border-gray-200 hover:bg-white hover:text-gray-900 dark:text-gray-400 dark:hover:border-white/[0.08] dark:hover:bg-white/[0.04] dark:hover:text-white"
                      : "border-transparent text-gray-500 hover:border-gray-200 hover:bg-white/60 hover:text-gray-900 dark:text-gray-400 dark:hover:border-white/[0.08] dark:hover:bg-white/[0.04] dark:hover:text-gray-100"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : null}

      <div
        data-nb-composer="intake"
        data-nb-composer-variant={variant}
        data-nb-composer-mode={mode}
        className={`nb-composer-surface ${
            isDrawerVariant
              ? "rounded-[18px] px-3 py-2.5"
              : isChatVariant
                ? isCompactChatVariant
                  ? "rounded-[30px] px-3.5 py-2.5"
                  : "rounded-[24px] px-3 py-2"
                : "rounded-[22px] px-3 py-3 sm:px-4"
        } border transition-all duration-normal ${
          dragActive
            ? isChatVariant
              ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/8 dark:bg-[var(--accent-primary)]/10"
              : "border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 dark:bg-[var(--accent-primary)]/10"
              : isChatVariant
                ? isCompactChatVariant
                  ? "border-white/[0.12] bg-[#171f28]/98 shadow-[0_22px_48px_-30px_rgba(0,0,0,0.84),inset_0_1px_0_rgba(255,255,255,0.05)] dark:border-white/[0.12] dark:bg-[#171f28]/98"
                  : "border-black/[0.045] bg-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-white/[0.06] dark:bg-[#0f151d]/92"
                : "border-gray-200 bg-white dark:border-white/[0.1] dark:bg-[#11161c]"
        }`}
      >
        {showChatTextareaShell ? (
          <div
            className={`rounded-[22px] border border-black/[0.045] bg-black/[0.015] px-1.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.56)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${
              isCompactChatVariant ? "mb-0.5" : "mb-1"
            }`}
          >
            <textarea
              ref={textareaRef}
              id="product-intake-query"
              name="productIntakeQuery"
              aria-label={textareaAriaLabel}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={effectivePlaceholder}
              rows={isDrawerVariant ? 3 : isChatVariant ? 1 : 4}
              disabled={disabled}
              className={`${
                isCompactChatVariant ? "min-h-[24px]" : "min-h-[28px]"
              } max-h-[320px] w-full resize-none bg-transparent text-[15px] leading-6 outline-none transition-[height] duration-fast ease-out disabled:cursor-not-allowed motion-reduce:transition-none ${
                isCompactChatVariant
                  ? "text-[14.5px] font-medium leading-[1.34rem]"
                  : "text-[15px] leading-[1.45rem]"
              } text-gray-100 placeholder:text-gray-300`}
            />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            id="product-intake-query"
            name="productIntakeQuery"
            aria-label={textareaAriaLabel}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={effectivePlaceholder}
            rows={isDrawerVariant ? 3 : isChatVariant ? 1 : 4}
            disabled={disabled}
            className={`${
              isDrawerVariant
                ? "min-h-[72px]"
                : isChatVariant
                  ? isCompactChatVariant
                    ? "min-h-[24px]"
                    : "min-h-[28px]"
                  : "min-h-[96px]"
            } max-h-[320px] w-full resize-none bg-transparent text-[15px] leading-6 outline-none transition-[height] duration-fast ease-out disabled:cursor-not-allowed motion-reduce:transition-none ${
              isChatVariant
                ? `${isCompactChatVariant ? "text-[14.5px] leading-[1.34rem] font-medium" : "text-[15px] leading-[1.45rem]"} text-gray-900 placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-400`
                : "text-gray-900 placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-400"
            }`}
          />
        )}

        <div className={`mt-0.5 flex flex-wrap items-center gap-1.5 ${
          isChatVariant
            ? `${showChatHelperText ? "justify-between" : "justify-end"} pt-0.5`
            : "justify-between border-t border-gray-200/80 pt-3 dark:border-white/[0.08]"
        }`}>
          <div className={`min-w-0 items-start gap-2 text-left text-xs ${
            isChatVariant
              ? showChatHelperText
                ? "flex text-gray-400 dark:text-gray-300"
                : "hidden"
              : "flex text-gray-500 dark:text-gray-300"
          }`}>
            {showResearchLaneControls ? (
              <ToggleGroup
                type="single"
                value={selectedResearchLane}
                onValueChange={(value) => value && onResearchLaneChange?.(value)}
                aria-label="Research lane"
                className="flex min-w-0 flex-wrap items-center gap-2"
              >
                {researchLanes!.map((lane) => {
                  const active = selectedResearchLane === lane.id;
                  return (
                    <ToggleGroupItem
                      key={lane.id}
                      value={lane.id}
                      data-testid="home-research-lane"
                      data-state={active ? "active" : "inactive"}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/35 ${
                        active
                          ? "border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/10 text-[#ad5f45] shadow-sm dark:text-[#ffd7ca]"
                          : "border-gray-200 bg-white/75 text-gray-500 hover:border-gray-300 hover:text-gray-800 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-400 dark:hover:border-white/[0.14] dark:hover:text-gray-100"
                      }`}
                    >
                      <span>{lane.label}</span>
                      <span className="font-mono text-[10px] opacity-70">&middot; {lane.note}</span>
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            ) : (
              <>
                <Sparkles className={`mt-0.5 shrink-0 text-[var(--accent-primary)] ${isChatVariant ? "h-3.5 w-3.5" : "h-4 w-4"}`} />
                <div className="min-w-0">
                  <div className="leading-5">
                    {attachmentLabel}
                    {!isChatVariant && !isCaptureMode && dragActive ? " Drop files to attach them." : null}
                    {!isChatVariant && !isCaptureMode && !dragActive ? " Drag files or attach them below." : null}
                  </div>
                  {voiceActive ? (
                    <div className="mt-1 text-[11px] font-medium text-[var(--accent-primary)]">
                    {realtimeVoice.isListening
                        ? "Listening for realtime capture..."
                        : realtimeVoice.isTranscribing
                          ? "Transcribing realtime capture..."
                          : voicePending
                        ? "Starting voice memo..."
                        : "Recording voice memo... "}
                      {!voicePending && isRecording ? `${Math.floor(duration / 60)}:${`${duration % 60}`.padStart(2, "0")}` : null}
                    </div>
                  ) : null}
                </div>
              </>
            )}
            {isRecording ? (
              <div className="sr-only" aria-live="polite">
                Recording voice memo... {Math.floor(duration / 60)}:{`${duration % 60}`.padStart(2, "0")}
              </div>
            ) : null}
          </div>
          <div className={`flex items-center ${isChatVariant ? "gap-1.5" : "gap-2"}`}>
            {!isCaptureMode ? (
              <>
                <div className="relative">
                  <button
                    ref={attachmentMenuButtonRef}
                    type="button"
                    onClick={handleAttachmentTrigger}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-full text-xs font-medium transition-all duration-fast ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 disabled:opacity-40 motion-reduce:transform-none motion-reduce:transition-none ${
                      isChatVariant
                        ? `${isCompactChatVariant ? "order-1 h-10 w-10 border-0 bg-transparent" : "order-1 h-9 w-9 border-0 bg-transparent"} text-gray-400 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-100 dark:hover:bg-transparent dark:hover:text-white`
                        : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100"
                    }`}
                    disabled={disabled || uploadingFiles || captureAttachmentPending}
                    aria-label={uploadingFiles ? "Uploading files" : isChatVariant ? "Open attachments" : "Attach files"}
                    aria-haspopup={isChatVariant ? "menu" : undefined}
                    aria-expanded={isChatVariant ? attachmentMenuOpen : undefined}
                  >
                    {isChatVariant ? <Plus className="h-4.5 w-4.5" /> : <Paperclip className="h-3.5 w-3.5" />}
                    <span className={isChatVariant ? "sr-only" : "hidden whitespace-nowrap sm:inline"}>
                      {uploadingFiles ? "Uploading..." : "Attach files"}
                    </span>
                  </button>
                  {isChatVariant && attachmentMenuOpen ? (
                    <div
                      ref={attachmentMenuRef}
                      role="menu"
                      aria-label="Attachment options"
                      className="absolute bottom-[calc(100%+10px)] left-0 z-20 min-w-[214px] overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#12171f]/96 p-2 text-left shadow-[0_24px_64px_-28px_rgba(0,0,0,0.9)] backdrop-blur-2xl"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={openNativeFilePicker}
                        className="flex w-full items-center gap-3 rounded-[18px] px-3.5 py-3 text-sm text-gray-100 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/35"
                      >
                        <Paperclip className="h-4 w-4 text-gray-300" />
                        <div className="min-w-0">
                          <div className="font-medium">Upload files</div>
                          <div className="text-xs text-gray-400">Add local files to this thread.</div>
                        </div>
                      </button>
                      {onSecondaryAction ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAttachmentMenuOpen(false);
                            onSecondaryAction();
                          }}
                          className="mt-1 flex w-full items-center gap-3 rounded-[18px] px-3.5 py-3 text-sm text-gray-100 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/35"
                        >
                          <FileText className="h-4 w-4 text-[var(--accent-primary)]" />
                          <div className="min-w-0">
                            <div className="font-medium">{secondaryChatActionLabel}</div>
                            <div className="text-xs text-gray-400">
                              {secondaryActionAriaLabel?.trim() || "Reuse a file from your vault."}
                            </div>
                          </div>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAttachmentMenuOpen(false);
                          void handleScreenshotCapture();
                        }}
                        className="mt-1 flex w-full items-center gap-3 rounded-[18px] px-3.5 py-3 text-sm text-gray-100 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/35"
                      >
                        <Camera className="h-4 w-4 text-gray-300" />
                        <div className="min-w-0">
                          <div className="font-medium">Capture screenshot</div>
                          <div className="text-xs text-gray-400">Drop a fresh screenshot straight into chat.</div>
                        </div>
                      </button>
                    </div>
                  ) : null}
                </div>
                {isChatVariant ? (
                  <div
                    aria-label={`Composer utility ${utilityPillLabel}`}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold tracking-[0.01em] ${
                      isCompactChatVariant
                        ? "order-2 h-10 border-white/[0.1] bg-white/[0.06] text-gray-100 shadow-[0_10px_22px_-18px_rgba(0,0,0,0.9)]"
                        : "border-black/[0.05] bg-white/84 text-gray-700 shadow-[0_16px_32px_-28px_rgba(15,23,42,0.18)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:shadow-none"
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                    <span>{utilityPillLabel}</span>
                  </div>
                ) : null}
                {!isChatVariant ? (
                  <button
                    type="button"
                    onClick={() => void handleScreenshotCapture()}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-all duration-fast ease-out hover:bg-gray-100 hover:text-gray-900 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 disabled:opacity-40 motion-reduce:transform-none motion-reduce:transition-none dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100"
                    disabled={disabled || isCapturing || captureAttachmentPending}
                    aria-label={isCapturing ? "Capturing screenshot" : "Attach screenshot"}
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span className="hidden whitespace-nowrap sm:inline">{isCapturing ? "Capturing..." : "Screenshot"}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleVoiceCapture()}
                  data-state={voiceActive ? "active" : "inactive"}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-full text-xs font-medium transition-all duration-fast ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 disabled:opacity-40 motion-reduce:transform-none motion-reduce:transition-none ${
                    voiceActive
                      ? "bg-[var(--accent-primary)] text-white shadow-sm hover:bg-[var(--accent-primary-hover)]"
                        : isChatVariant
                          ? `${isCompactChatVariant ? "order-3 h-10 w-10 border-0 bg-transparent" : "order-3 h-9 w-9"} text-gray-300 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-100 dark:hover:bg-transparent dark:hover:text-white`
                          : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100"
                    }`}
                  disabled={disabled || captureAttachmentPending}
                  aria-label={
                    realtimeVoice.isListening || realtimeVoice.isTranscribing || isRecording
                      ? "Stop voice input"
                      : realtimeVoice.isSupported
                        ? `Voice input using ${realtimeVoice.mode} mode`
                        : "Voice input fallback recorder"
                  }
                  title={
                    realtimeVoice.isListening || realtimeVoice.isTranscribing || isRecording
                      ? "Stop voice input"
                      : realtimeVoice.isSupported
                        ? `Voice input (${realtimeVoice.mode})`
                        : "Voice input fallback recorder"
                  }
                  aria-pressed={voiceActive}
                >
                  <Mic className="h-4.5 w-4.5" />
                  <span className={isChatVariant ? "sr-only" : "hidden whitespace-nowrap sm:inline"}>
                    {isRecording ? "Stop" : voicePending ? "Starting..." : "Voice"}
                  </span>
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={primaryDisabled}
              aria-busy={mode === "ask" ? submitPending : captureSavePending}
              data-nb-composer-primary-action={primaryActionKey}
              className={`inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-all duration-fast ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                isChatVariant ? "disabled:active:scale-100" : "disabled:opacity-40 disabled:active:scale-100"
                } motion-reduce:transform-none motion-reduce:transition-none ${
                  isChatVariant
                    ? `${isCompactChatVariant ? "order-4 ml-auto h-12 min-w-12 border border-white/12" : "order-4 ml-auto h-11 min-w-11 border border-black/[0.06] dark:border-white/12"} px-0 text-[#12161d] shadow-[0_12px_28px_-18px_rgba(255,255,255,0.34)] hover:bg-white/90 focus-visible:ring-white/50`
                    : "bg-[var(--accent-primary)] px-4 py-2 text-white hover:bg-[var(--accent-primary-hover)] focus-visible:ring-[var(--accent-primary)]/50"
                } ${
                isChatVariant
                  ? submitPending && mode === "ask"
                    ? "bg-white opacity-100 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#111821]"
                    : value.trim()
                      ? "bg-white focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#111821]"
                      : "bg-white/[0.24] text-white/60 shadow-none focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#111821]"
                  : "focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#11161c]"
              }`}
              aria-label={primaryLabel}
            >
              <span className={isChatVariant ? "hidden whitespace-nowrap sm:inline" : "whitespace-nowrap"}>{primaryLabel}</span>
              {mode === "ask" && submitPending ? (
                <span aria-hidden="true" className="h-3.5 w-3.5 rounded-[3px] bg-current" />
              ) : mode !== "ask" && captureSavePending ? (
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
              ) : isChatVariant ? (
                <ArrowUp className="h-4.5 w-4.5" />
              ) : value.trim() ? (
                mode === "ask" && !isChatVariant ? (
                  <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium leading-none">
                    Ctrl+Enter
                  </kbd>
                ) : null
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {showOperatorContextChip && operatorContextLabel ? (
          <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 dark:border-white/[0.12] dark:bg-[#171c22] dark:text-gray-300">
            <span className="font-medium">Using your context</span>
            <span className="text-gray-400 dark:text-gray-500">{operatorContextLabel}</span>
          </div>
        ) : null}

        {showOperatorContextHint && operatorContextHint ? (
          <div className="mt-3 rounded-2xl border border-gray-200/80 bg-gray-50 px-3 py-2 text-left text-xs leading-5 text-gray-500 dark:border-white/[0.08] dark:bg-[#11161c] dark:text-gray-400">
            {operatorContextHint}
          </div>
        ) : null}

        {showLensSelector && !isCaptureMode ? (
          <ToggleGroup
            type="single"
            value={lens}
            onValueChange={(value) => value && onLensChange(value as LensId)}
            aria-label="Lens"
            className={`no-scrollbar -mx-1 mt-3 flex items-center justify-start gap-0.5 overflow-x-auto rounded-full p-1 px-1 sm:justify-center sm:overflow-visible ${
              isChatVariant
                ? "border border-gray-200 bg-gray-50/85 dark:border-white/[0.08] dark:bg-white/[0.02]"
                : "border border-gray-200 bg-gray-50/60 dark:border-white/[0.08] dark:bg-white/[0.02]"
            }`}
          >
            {LENSES.map((option) => (
              <ToggleGroupItem
                key={option.id}
                value={option.id}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-all duration-fast ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 motion-reduce:transform-none motion-reduce:transition-none ${
                  lens === option.id
                    ? isChatVariant
                      ? "bg-white text-gray-900 shadow-sm ring-1 ring-black/5 dark:bg-white/[0.08] dark:text-white dark:ring-white/10"
                      : "bg-white text-gray-900 shadow-sm ring-1 ring-black/5 dark:bg-white/[0.08] dark:text-gray-50 dark:ring-white/10"
                    : isChatVariant
                      ? "text-gray-500 hover:bg-white hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.04] dark:hover:text-white"
                      : "text-gray-500 hover:bg-white/60 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.04] dark:hover:text-gray-100"
                }`}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}

        {files.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {files.map((file, index) => (
              <span
                key={`${file.name}-${index}`}
                className={`rounded-full border px-3 py-1 text-xs ${
                  isChatVariant
                    ? "border-gray-200 bg-white text-gray-600 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-300"
                    : "border-gray-200 bg-white text-gray-500 dark:border-white/[0.12] dark:bg-[#171c22] dark:text-gray-300"
                }`}
              >
                {file.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          if (!selected.length) return;
          void Promise.resolve(onFilesSelected(selected)).finally(() => {
            if (fileInputRef.current) fileInputRef.current.value = "";
          });
        }}
      />
    </div>
  );
}
