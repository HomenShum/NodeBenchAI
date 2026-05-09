/**
 * FormatStrip — Phase 7c.  Renders a compact strip beneath the §1
 * header reading:
 *
 *   Today's edition · {dateString} · PDF · Copy share-link
 *
 * Buttons are quiet anchors with monospace caption styling, focus
 * rings, and aria-labels — never icon-only.  The PDF action navigates
 * to a print-friendly route at `/redesign/edition/print?id=...` so
 * the user's browser print dialog renders the PDF (no heavy server
 * dependency per spec §7c "do NOT introduce new heavy dependencies").
 *
 * The "Copy share-link" action writes
 * `https://www.nodebenchai.com/redesign?edition=1&share={editionId}`
 * to the system clipboard via `navigator.clipboard.writeText` and
 * shows a transient `Copied!` toast (per `Toast.tsx`'s contract).
 *
 * "Listen" + "watch" are deferred to Phase 8 per spec §6 — no
 * stubs (per `agentic_reliability.md` HONEST_STATUS: don't render
 * disabled placeholders that imply functionality which doesn't exist).
 *
 * Source spec: docs/architecture/HOME_EDITORIAL_REDESIGN.md Phase 7c
 * Rules: reexamine_a11y, agentic_reliability.
 */

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

export function FormatStrip({ dateString, editionId }: Props) {
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
        aria-label="Copy share link to clipboard"
        data-format-share
        onClick={onCopyShare}
      >
        Copy share-link
      </button>
    </div>
  );
}
