/**
 * Voice feature surfaces — Phase 5-B reusable components for the Realtime
 * Adapter telemetry surfaces.
 *
 * See: docs/architecture/REALTIME_VOICE_INTEGRATION.md
 *
 * Usage (drop into MeSurface, AgentTelemetryDashboard, or Inbox):
 *   import { VoiceAuditFeed, VoiceCostBadge } from "@/features/voice";
 *   <VoiceCostBadge userId={user._id} />
 *   <VoiceAuditFeed userId={user._id} limit={20} />
 *
 * Both components are READ-ONLY — they subscribe to the Convex queries
 * landed in PR #274 (`realtimeAudit:listForUser`, `costLedger:checkCap`)
 * and gracefully render skeleton + empty states when no data is available.
 */

export { VoiceAuditFeed } from "./components/VoiceAuditFeed";
export { VoiceCostBadge } from "./components/VoiceCostBadge";
