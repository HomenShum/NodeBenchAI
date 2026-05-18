import React from "react";
import {
  AbsoluteFill,
  Img,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
  staticFile,
} from "remotion";
import type { Scene, HighlightRegion } from "../storyboard";

interface SceneViewProps {
  scene: Scene;
  durationFrames: number;
  sceneIndex?: number;
  totalScenes?: number;
}

export const SceneView: React.FC<SceneViewProps> = ({ scene, durationFrames, sceneIndex = 0, totalScenes = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ─── Transition opacity ───
  const fadeInDuration = scene.transition === "fade" ? 20 : 8;
  const fadeOutStart = durationFrames - 15;
  const opacity = interpolate(
    frame,
    [0, fadeInDuration, fadeOutStart, durationFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // ─── Slide transition (from right) ───
  const slideX =
    scene.transition === "slide"
      ? interpolate(frame, [0, 15], [60, 0], {
          extrapolateRight: "clamp",
          extrapolateLeft: "clamp",
        })
      : 0;

  // ─── Zoom transition (scale from 1.05 → 1.0) ───
  const zoomScale =
    scene.transition === "zoom"
      ? interpolate(frame, [0, 20], [1.05, 1.0], {
          extrapolateRight: "clamp",
          extrapolateLeft: "clamp",
        })
      : 1.0;

  // ─── Ken Burns subtle drift on screenshots ───
  const kenBurnsScale = interpolate(
    frame,
    [0, durationFrames],
    [1.0, 1.02],
    { extrapolateRight: "clamp" }
  );
  const kenBurnsX = interpolate(
    frame,
    [0, durationFrames],
    [0, -8],
    { extrapolateRight: "clamp" }
  );

  // ─── Title overlay animation ───
  const titleOpacity = interpolate(
    frame,
    [10, 25, durationFrames - 30, durationFrames - 15],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const titleY = interpolate(frame, [10, 25], [15, 0], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  // ─── Caption bar animation ───
  const captionOpacity = interpolate(
    frame,
    [15, 30, durationFrames - 20, durationFrames - 10],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const isIntro = scene.id === "intro";
  const isOutro = scene.id === "outro";

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateX(${slideX}px) scale(${zoomScale})`,
      }}
    >
      {/* ─── Screenshot background ─── */}
      <AbsoluteFill
        style={{
          transform: `scale(${kenBurnsScale}) translateX(${kenBurnsX}px)`,
        }}
      >
        <Img
          src={staticFile(`screenshots/${scene.screenshot}`)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>

      {/* ─── Dark overlay for readability ─── */}
      <AbsoluteFill
        style={{
          background: isIntro || isOutro
            ? "radial-gradient(ellipse at center, rgba(21,20,19,0.6) 0%, rgba(21,20,19,0.85) 100%)"
            : "linear-gradient(180deg, rgba(21,20,19,0.15) 0%, rgba(21,20,19,0.3) 60%, rgba(21,20,19,0.75) 100%)",
        }}
      />

      {/* ─── Highlight regions with animated borders ─── */}
      {scene.highlights.map((h, idx) => (
        <HighlightBox key={idx} highlight={h} fps={fps} />
      ))}

      {/* ─── Title overlay (top-left) ─── */}
      {!isIntro && !isOutro && (
        <div
          style={{
            position: "absolute",
            top: 36,
            left: 48,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#d97757",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            NodeBench
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "#ffffff",
              marginTop: 4,
              fontFamily: "system-ui, sans-serif",
              textShadow: "0 2px 12px rgba(0,0,0,0.6)",
            }}
          >
            {scene.title}
          </div>
        </div>
      )}

      {/* ─── Intro/Outro centered title ─── */}
      {(isIntro || isOutro) && (
        <AbsoluteFill
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: 56,
              fontWeight: 800,
              color: "#ffffff",
              fontFamily: "system-ui, sans-serif",
              opacity: interpolate(frame, [15, 35], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              transform: `translateY(${interpolate(frame, [15, 35], [20, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })}px)`,
            }}
          >
            NodeBench
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 500,
              color: "#d97757",
              marginTop: 12,
              fontFamily: "system-ui, sans-serif",
              letterSpacing: "0.08em",
              opacity: interpolate(frame, [30, 50], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            {scene.caption}
          </div>
          {isIntro && (
            <div
              style={{
                fontSize: 15,
                color: "rgba(255,255,255,0.4)",
                marginTop: 28,
                fontFamily: "system-ui, sans-serif",
                letterSpacing: "0.05em",
                opacity: interpolate(frame, [45, 65], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              49 scenes · 7 minutes · Every feature covered
            </div>
          )}
          {isOutro && (
            <>
              <div
                style={{
                  fontSize: 16,
                  color: "rgba(255,255,255,0.5)",
                  marginTop: 32,
                  fontFamily: "system-ui, sans-serif",
                  opacity: interpolate(frame, [60, 80], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }),
                }}
              >
                5 surfaces · 4 view modes · 87 reports · 312 sources
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: "rgba(217,119,87,0.6)",
                  marginTop: 12,
                  fontFamily: "monospace",
                  letterSpacing: "0.08em",
                  opacity: interpolate(frame, [90, 110], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }),
                }}
              >
                nodebenchai.com
              </div>
            </>
          )}
        </AbsoluteFill>
      )}

      {/* ─── Global progress bar (very top) ─── */}
      {!isIntro && !isOutro && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: "rgba(255,255,255,0.05)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${((sceneIndex + frame / durationFrames) / totalScenes) * 100}%`,
              background: "linear-gradient(90deg, #d97757 0%, #e8a87c 100%)",
            }}
          />
        </div>
      )}

      {/* ─── Caption bar (bottom) ─── */}
      {!isIntro && !isOutro && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "16px 48px",
            background: "linear-gradient(transparent, rgba(21,20,19,0.9))",
            opacity: captionOpacity,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                fontSize: 17,
                color: "rgba(255,255,255,0.85)",
                fontFamily: "system-ui, sans-serif",
                fontWeight: 500,
              }}
            >
              {scene.caption}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: "monospace",
                  background: "rgba(255,255,255,0.06)",
                  padding: "2px 8px",
                  borderRadius: 3,
                }}
              >
                {sceneIndex + 1}/{totalScenes}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(217,119,87,0.7)",
                  fontFamily: "monospace",
                  letterSpacing: "0.1em",
                }}
              >
                {scene.id.toUpperCase().replace(/-/g, " · ")}
              </div>
            </div>
          </div>
          {/* Progress bar */}
          <div
            style={{
              marginTop: 8,
              height: 2,
              background: "rgba(255,255,255,0.1)",
              borderRadius: 1,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(frame / durationFrames) * 100}%`,
                background: "#d97757",
                borderRadius: 1,
              }}
            />
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ─── Animated highlight box ───
const HighlightBox: React.FC<{ highlight: HighlightRegion; fps: number }> = ({
  highlight,
  fps,
}) => {
  const frame = useCurrentFrame();
  const { width: videoWidth, height: videoHeight } = useVideoConfig();

  const appearProgress = spring({
    frame: frame - highlight.delay,
    fps,
    config: { damping: 15, stiffness: 120, mass: 0.8 },
  });

  if (frame < highlight.delay) return null;

  const boxOpacity = interpolate(appearProgress, [0, 1], [0, 1]);
  const boxScale = interpolate(appearProgress, [0, 1], [0.95, 1]);

  // Pulsing border
  const pulseOpacity = interpolate(
    Math.sin((frame - highlight.delay) * 0.08),
    [-1, 1],
    [0.4, 0.8]
  );

  return (
    <div
      style={{
        position: "absolute",
        left: `${highlight.x}%`,
        top: `${highlight.y}%`,
        width: `${highlight.w}%`,
        height: `${highlight.h}%`,
        opacity: boxOpacity,
        transform: `scale(${boxScale})`,
        transformOrigin: "center center",
      }}
    >
      {/* Highlight border */}
      <div
        style={{
          position: "absolute",
          inset: -2,
          border: `2px solid rgba(217, 119, 87, ${pulseOpacity})`,
          borderRadius: 8,
          boxShadow: `0 0 20px rgba(217, 119, 87, ${pulseOpacity * 0.3})`,
        }}
      />
      {/* Label */}
      <div
        style={{
          position: "absolute",
          top: -28,
          left: 0,
          fontSize: 13,
          fontWeight: 600,
          color: "#d97757",
          fontFamily: "system-ui, sans-serif",
          background: "rgba(21,20,19,0.85)",
          padding: "3px 10px",
          borderRadius: 4,
          whiteSpace: "nowrap",
          textShadow: "0 1px 4px rgba(0,0,0,0.5)",
        }}
      >
        {highlight.label}
      </div>
    </div>
  );
};
