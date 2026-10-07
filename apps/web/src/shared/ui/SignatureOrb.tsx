import React, { useMemo } from "react";
import { prefersReducedMotion } from "../../utils/a11y";

export type OrbVariant = "hero" | "signature" | "loading" | "ambient" | "indicator" | "empty";
export type OrbSize = "xs" | "sm" | "md" | "lg";

export interface SignatureOrbProps {
  variant?: OrbVariant;
  message?: string;
  className?: string;
  size?: OrbSize;
}

const SIGNATURE_POINTS: Array<{ id: string; x: number; y: number }> = [
  { id: "n1", x: 50, y: 8 },
  { id: "n2", x: 82, y: 18 },
  { id: "n3", x: 92, y: 50 },
  { id: "n4", x: 78, y: 80 },
  { id: "n5", x: 50, y: 92 },
  { id: "n6", x: 20, y: 78 },
  { id: "n7", x: 8, y: 50 },
  { id: "n8", x: 22, y: 20 },
];

function getSignatureSizeClass(size: OrbSize): string {
  switch (size) {
    case "xs":
      return "h-9 w-9";
    case "sm":
      return "h-20 w-20";
    case "lg":
      return "h-48 w-48 md:h-56 md:w-56";
    default:
      return "h-36 w-36 md:h-44 md:w-44";
  }
}

export function SignatureOrb({
  variant = "loading",
  message,
  className = "",
  size = "md",
}: SignatureOrbProps) {
  const reduceMotion = useMemo(() => prefersReducedMotion(), []);
  const signatureSizeClass = getSignatureSizeClass(size);

  switch (variant) {
    case "hero":
      return (
        <div className={`relative flex items-center justify-center ${className}`}>
          <div className="w-44 h-44 md:w-56 md:h-56 relative flex items-center justify-center">
            <div
              className={`absolute inset-0 will-change-transform ${reduceMotion ? "" : "motion-safe:animate-spin-slow"}`}
            >
              <div className="absolute inset-0 rounded-full border border-edge scale-100" />
              <div className="absolute inset-0 rounded-full border border-primary/25 scale-[1.3]" />
            </div>
            <div className="absolute inset-0 rounded-full bg-primary/10 blur-2xl scale-[1.3]" />
            <div
              className={`relative w-32 h-32 md:w-40 md:h-40 rounded-full bg-surface border border-edge overflow-hidden shadow-sm ${reduceMotion ? "" : "motion-safe:animate-pulse-subtle"}`}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-primary/10 rounded-full" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-primary shadow-[0_0_16px_rgba(94,106,210,0.55)]" />
              </div>
            </div>
          </div>
        </div>
      );

    case "signature":
      return (
        <div className={`relative flex items-center justify-center ${className}`}>
          <div className={`${signatureSizeClass} relative flex items-center justify-center`}>
            <svg
              className="absolute inset-0 h-full w-full text-primary/20"
              viewBox="0 0 100 100"
              aria-hidden="true"
            >
              <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="1" />
              <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="1" />
              <circle cx="50" cy="50" r="22" fill="none" stroke="currentColor" strokeWidth="1" />
              {SIGNATURE_POINTS.map((point) => (
                <line
                  key={`line-${point.id}`}
                  x1="50"
                  y1="50"
                  x2={point.x}
                  y2={point.y}
                  stroke="currentColor"
                  strokeWidth="0.8"
                  strokeLinecap="round"
                />
              ))}
            </svg>

            <div className="absolute inset-0 rounded-full bg-primary/10 blur-[32px]" aria-hidden="true" />
            <div
              className={`absolute inset-[2px] rounded-full border border-edge ${reduceMotion ? "" : "motion-safe:animate-spin-slow"}`}
              style={reduceMotion ? undefined : { animationDuration: "24s" }}
            />
            <div
              className={`absolute inset-[14%] rounded-full border border-primary/25 ${reduceMotion ? "" : "motion-safe:animate-spin-slow"}`}
              style={
                reduceMotion
                  ? undefined
                  : {
                      animationDirection: "reverse",
                      animationDuration: "18s",
                    }
              }
            />

            <div className="relative h-[48%] w-[48%] rounded-full border border-edge bg-surface shadow-sm flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 via-transparent to-primary/10" />
              <div className={`h-2.5 w-2.5 rounded-full bg-primary ${reduceMotion ? "" : "motion-safe:animate-pulse-subtle"}`} />
            </div>

            {SIGNATURE_POINTS.map((point, index) => (
              <span
                key={point.id}
                className={`absolute h-2.5 w-2.5 rounded-full bg-primary/75 border border-primary/30 ${reduceMotion ? "" : "motion-safe:animate-pulse-subtle"}`}
                style={{
                  left: `${point.x}%`,
                  top: `${point.y}%`,
                  transform: "translate(-50%, -50%)",
                  animationDelay: `${index * 140}ms`,
                }}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>
      );

    case "loading":
      return (
        <div
          className={`flex flex-col items-center justify-center gap-3 ${className}`}
          role="status"
          aria-label="Loading"
        >
          <div className="w-16 h-16 relative flex items-center justify-center">
            <div
              className={`absolute inset-0 rounded-full border-2 border-edge border-t-primary ${reduceMotion ? "" : "motion-safe:animate-spin"}`}
              style={reduceMotion ? undefined : { animationDuration: "1.2s" }}
            />
            <div className="w-2 h-2 rounded-full bg-primary/70" />
          </div>
        </div>
      );

    case "ambient":
      return (
        <div
          className={`absolute pointer-events-none ${className}`}
          aria-hidden="true"
        >
          <div className="w-[300px] h-[300px] rounded-full bg-primary/10 blur-[80px]" />
        </div>
      );

    case "indicator":
      return (
        <span
          className={`relative inline-flex items-center justify-center ${className}`}
          role="status"
          aria-label="Active"
        >
          {!reduceMotion && (
            <span className="absolute w-3 h-3 rounded-full bg-primary/35 motion-safe:animate-ping" />
          )}
          <span className="relative w-2 h-2 rounded-full bg-primary" />
        </span>
      );

    case "empty":
      return (
        <div
          className={`flex flex-col items-center justify-center gap-4 py-8 ${className}`}
        >
          <div className="w-24 h-24 relative flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-edge scale-100 opacity-60" />
            <div className="absolute inset-0 rounded-full border border-primary/20 scale-[1.25] opacity-40" />
            <div className="w-14 h-14 rounded-full bg-surface-secondary border border-edge flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-primary/45" />
            </div>
          </div>
          {message && (
            <p className="text-sm text-content-muted text-center max-w-xs">
              {message}
            </p>
          )}
        </div>
      );

    default:
      return null;
  }
}

export default SignatureOrb;
