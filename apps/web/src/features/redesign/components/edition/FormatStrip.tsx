/**
 * FormatStrip — Phase 7c + Phase 9a.  Renders a compact strip beneath
 * the §1 header reading:
 *
 *   Today's edition · {dateString} · PDF · Listen · Copy share-link
 *
 * Buttons are quiet anchors with monospace caption styling, focus
 * rings, and aria-labels — never icon-only.
 *
 * Phase 9a: Listen button generates audio of the daily edition via
 * `api.domains.integrations.voice.editionTts.generateEditionAudio`.
 * Same-day clicks return the cached storage URL — no extra ElevenLabs
 * cost.  Audio renders inline via `<audio controls>` once available.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - HONEST_STATUS  loading/success/error states surfaced; never
 *                    pretend audio is ready when it isn't.
 *   - BOUND          one in-flight call at a time per component.
 *
 * Source spec: docs/architecture/HOME_EDITORIAL_REDESIGN.md Phase 7c +
 *              docs/architecture/EDITION_INGESTION_FLYWHEEL.md Phase 9a
 * Rules: reexamine_a11y, agentic_reliability.
 */

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { showToast } from "../Toast";

interface Props {
  /** ISO-ish date string for the current edition (YYYY-MM-DD). */
  dateString: string;
  /** Stable identifier the share URL embeds. */
  editionId: string;
}

const SHARE_BASE_URL = "https://www.nodebenchai.com/redesign";

function buildShareUrl(editionId: string): string {
  return `${SHARE_BASE_URL}?edition=1&share=${encodeURIComponent(editionId)}`;
}

function buildPrintUrl(editionId: string): string {
  // Same-origin print route — keeps the user's auth state for any
  // gated content and avoids opening a new tab to a public URL.
  return `/redesign/edition/print?id=${encodeURIComponent(editionId)}`;
}

type ListenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; audioUrl: string; cached: boolean }
  | { status: "error"; message: string };

export function FormatStrip({ dateString, editionId }: Props) {
  const [listenState, setListenState] = useState<ListenState>({ status: "idle" });
  const generateAudio = useAction(
    api.domains.integrations.voice.editionTts.generateEditionAudio,
  );

  const onCopyShare = async () => {
    const url = buildShareUrl(editionId);
    let copied = false;
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (copied) {
      showToast({
        tone: "success",
        message: "Copied! Share link in clipboard.",
        durationMs: 2500,
      });
    } else {
      // HONEST_STATUS — don't claim success when the clipboard API
      // failed.  Surface the URL so the user can copy manually.
      showToast({
        tone: "warning",
        message: `Clipboard unavailable. Link: ${url}`,
        durationMs: 6000,
      });
    }
  };

  const onPrintPdf = () => {
    if (typeof window === "undefined") return;
    // Open in a new tab so the print prompt doesn't disrupt the
    // user's reading position; the print route is a same-origin
    // route so cookies travel.
    window.open(buildPrintUrl(editionId), "_blank", "noopener");
  };

  const onListen = async () => {
    if (listenState.status === "loading") return; // BOUND: one in-flight call
    setListenState({ status: "loading" });
    try {
      const result = await generateAudio({ dateKey: dateString });
      if (!result.ok || !result.audioUrl) {
        const reason = result.error ?? "Audio generation failed";
        setListenState({ status: "error", message: reason });
        showToast({
          tone: "warning",
          message: `Listen unavailable: ${reason}`,
          durationMs: 5000,
        });
        return;
      }
      setListenState({
        status: "ready",
        audioUrl: result.audioUrl,
        cached: !!result.cached,
      });
      if (result.cached) {
        showToast({
          tone: "success",
          message: "Loaded today's audio from cache.",
          durationMs: 2500,
        });
      } else {
        showToast({
          tone: "success",
          message: "Generated audio for today's edition.",
          durationMs: 3000,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setListenState({ status: "error", message: msg });
      showToast({
        tone: "warning",
        message: `Listen failed: ${msg}`,
        durationMs: 5000,
      });
    }
  };

  return (
    <div
      className="rd-edition-format-strip"
      data-format-strip
      role="group"
      aria-label="Edition format options"
    >
      <span
        className="rd-edition-format-strip__caption"
        data-format-strip-caption
      >
        Today's edition · {dateString}
      </span>
      <span aria-hidden="true" className="rd-edition-format-strip__sep">
        ·
      </span>
      <button
        type="button"
        className="rd-edition-format-strip__btn"
        aria-label="Open print-friendly edition (PDF)"
        data-format-pdf
        onClick={onPrintPdf}
      >
        PDF
      </button>
      <span aria-hidden="true" className="rd-edition-format-strip__sep">
        ·
      </span>
      <button
        type="button"
        className="rd-edition-format-strip__btn"
        aria-label={
          listenState.status === "loading"
            ? "Generating audio for today's edition"
            : "Listen to today's edition"
        }
        aria-busy={listenState.status === "loading" || undefined}
        data-format-listen
        data-listen-status={listenState.status}
        onClick={onListen}
        disabled={listenState.status === "loading"}
      >
        {listenState.status === "loading" ? "Generating audio…" : "Listen"}
      </button>
      <span aria-hidden="true" className="rd-edition-format-strip__sep">
        ·
      </span>
      <button
        type="button"
        className="rd-edition-format-strip__btn"
        aria-label="Copy share link to clipboard"
        data-format-share
        onClick={onCopyShare}
      >
        Copy share-link
      </button>
      {listenState.status === "ready" && (
        <div
          className="rd-edition-format-strip__audio"
          data-format-audio
          style={{ width: "100%", marginTop: 8 }}
        >
          <audio
            controls
            preload="metadata"
            src={listenState.audioUrl}
            data-format-audio-el
            style={{ width: "100%" }}
          >
            Your browser does not support the audio element.
          </audio>
        </div>
      )}
    </div>
  );
}
