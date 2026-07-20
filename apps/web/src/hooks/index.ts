/**
 * hooks/ — All shared React hooks (canonical location)
 *
 * Feature-specific hooks live in their feature directories.
 * Hooks here are used across 2+ features or are infrastructure.
 */

// Infrastructure
export { useMcp } from "./useMcp";
export { useWebMcpProvider } from "./useWebMcpProvider";
export { useViewWebMcpTools } from "./useViewWebMcpTools";
export { useCockpitRouting, useCockpitSurfaceFromUrl } from "./useCockpitRouting";

// Navigation & interaction
export { useCommandPalette } from "./useCommandPalette";
export { useGlobalEventListeners } from "./useGlobalEventListeners";

// Voice pipeline
export { useVoiceIntentRouter } from "./useVoiceIntentRouter";
export { useVoiceRecording } from "./useVoiceRecording";
export { useVoiceInput } from "./useVoiceInput";
export { useVoiceOutput } from "./useVoiceOutput";

// UI utilities
export { useZoom } from "./useZoom";
export { useScreenCapture } from "./useScreenCapture";
export { useReducedMotion } from "./useReducedMotion";
export { useViewportMobile, COMPACT_LAYOUT_QUERY, TAILWIND_MD_QUERY } from "./useViewportMobile";
export { useRevealOnMount } from "./useRevealOnMount";
export { useStableQuery } from "./useStableQuery";
export { useTimeContext } from "./useTimeContext";
export { useInlineCitations } from "./useInlineCitations";

// Analytics
export { useEngagementTracking } from "./useEngagementTracking";
export { useIntentTelemetry } from "./useIntentTelemetry";
export { usePathTracking } from "./usePathTracking";

// Feedback
export { FeedbackListener } from "./FeedbackListener";
export { useFeedback } from "./useFeedback";
