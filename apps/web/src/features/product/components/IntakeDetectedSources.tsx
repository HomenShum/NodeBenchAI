/**
 * IntakeDetectedSources — live affordance showing the classifier's read of
 * the current intake blob. Renders nothing when the intake is empty, so it
 * takes zero space until the user starts typing or drops files.
 *
 * Design posture:
 *   - design_reduction.md: silent until useful, renders inline, no modal
 *   - analyst_diagnostic.md: "would hiding the problem make it invisible?"
 *     Here the summary is the VISIBLE signal that the classifier is
 *     wired — if it stays empty when the user pastes a LinkedIn URL, a
 *     bug is obvious at first glance.
 */

import { useMemo } from "react";
import {
  classifyIntake,
  summarizeSources,
  type IntakeSource,
} from "./intakeSourceClassifier";

type SimpleFile = { name: string; size?: number };

export type IntakeDetectedSourcesProps = {
  text: string;
  files: ReadonlyArray<SimpleFile>;
  className?: string;
};

function SourcePill({ source }: { source: IntakeSource }) {
  const label =
    source.kind === "linkedin_url"
      ? `LinkedIn${source.slug ? " · " + source.slug : ""}`
      : source.kind === "github_url"
        ? `GitHub${source.owner ? " · " + source.owner : ""}`
        : source.kind === "twitter_url"
          ? `X/Twitter${source.handle ? " · " + source.handle : ""}`
          : source.kind === "product_hunt_url"
            ? `Product Hunt${source.slug ? " · " + source.slug : ""}`
            : source.kind === "press_release_url"
              ? `Press · ${source.host}`
              : source.kind === "generic_url"
                ? `Web · ${source.host || "link"}`
                : source.kind === "pitch_deck_file"
                  ? `Pitch · ${source.fileName}`
                  : source.kind === "bio_file"
                    ? `Bio · ${source.fileName}`
                    : source.kind === "recruiter_note"
                      ? "Recruiter note"
                      : source.kind === "founder_note"
                        ? "Founder note"
                        : "Free text";

  const tone =
    source.kind === "linkedin_url" || source.kind === "github_url"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
      : source.kind === "press_release_url"
        ? "border-violet-500/30 bg-violet-500/10 text-violet-200"
        : source.kind === "pitch_deck_file"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
          : source.kind === "bio_file"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            : source.kind === "recruiter_note" || source.kind === "founder_note"
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
              : "border-white/[0.1] bg-white/[0.02] text-white/60";

  return (
    <span
      className={
        "inline-flex max-w-[14rem] items-center rounded border px-1.5 py-0.5 text-[11px] " +
        tone
      }
      title={
        "url" in source
          ? source.url
          : "fileName" in source
            ? source.fileName
            : "text" in source
              ? source.text.slice(0, 180)
              : undefined
      }
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

export function IntakeDetectedSources({
  text,
  files,
  className,
}: IntakeDetectedSourcesProps) {
  const sources = useMemo(
    () =>
      classifyIntake({
        text,
        files: files.map((f) => ({ name: f.name, size: f.size })),
      }),
    [text, files],
  );

  if (sources.length === 0) return null;

  const summary = summarizeSources(sources);

  return (
    <div
      className={
        "flex flex-wrap items-center gap-1.5 text-[11px] text-white/60 " +
        (className ?? "")
      }
      role="region"
      aria-label="Detected intake sources"
    >
      <span className="font-mono uppercase tracking-[0.15em] text-white/50">
        Detected
      </span>
      <span className="text-white/40">·</span>
      <span className="text-white/70">{summary}</span>
      <div className="flex flex-wrap gap-1">
        {sources.slice(0, 8).map((s, i) => (
          <SourcePill key={i} source={s} />
        ))}
        {sources.length > 8 ? (
          <span className="text-[11px] text-white/50">
            +{sources.length - 8} more
          </span>
        ) : null}
      </div>
    </div>
  );
}
