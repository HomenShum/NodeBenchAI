/**
 * StreamingTranscript — Renders dual-layer transcription text
 *
 * Shows stable (committed) text in full opacity and interim (unstable)
 * text in reduced opacity with a pulsing cursor. Displays speech state
 * indicator and confidence badge when available.
 */

import { memo } from "react";
import type { SpeechState } from "../../../hooks/useStreamingTranscription";

interface StreamingTranscriptProps {
  stableText: string;
  interimText: string;
  speechState: SpeechState;
  confidence: number;
  className?: string;
}

const STATE_LABELS: Record<SpeechState, string> = {
  idle: "",
  connecting: "Connecting...",
  listening: "Listening",
  speech_started: "Hearing you",
  speech_ended: "Processing",
  error: "Error",
};

const STATE_DOT_CLASS: Record<SpeechState, string> = {
  idle: "bg-content-muted",
  connecting: "bg-amber-400 animate-pulse",
  listening: "bg-emerald-500 animate-pulse",
  speech_started: "bg-emerald-400",
  speech_ended: "bg-amber-400",
  error: "bg-red-500",
};

export const StreamingTranscript = memo(function StreamingTranscript({
  stableText,
  interimText,
  speechState,
  confidence,
  className = "",
}: StreamingTranscriptProps) {
  if (!stableText && !interimText && speechState === "idle") return null;

  const stateLabel = STATE_LABELS[speechState];
  const showConfidence = confidence > 0 && confidence < 1 && stableText;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {/* Speech state indicator */}
      {stateLabel && (
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${STATE_DOT_CLASS[speechState]}`}
            aria-hidden="true"
          />
          <span className="text-xs text-content-muted font-mono">
            {stateLabel}
          </span>
          {showConfidence && (
            <span
              className="text-[10px] text-content-muted tabular-nums"
              title={`Confidence: ${Math.round(confidence * 100)}%`}
            >
              {Math.round(confidence * 100)}%
            </span>
          )}
        </div>
      )}

      {/* Transcript text with dual layers */}
      <div className="text-sm leading-relaxed" aria-live="polite" aria-atomic="false">
        {stableText && (
          <span className="text-content">{stableText}</span>
        )}
        {interimText && (
          <>
            {stableText && " "}
            <span className="text-content-muted italic">
              {interimText}
              <span
                className="inline-block w-0.5 h-[1em] ml-0.5 bg-current animate-pulse align-text-bottom"
                aria-hidden="true"
              />
            </span>
          </>
        )}
      </div>
    </div>
  );
});
