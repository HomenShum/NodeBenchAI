/**
 * Entities Domain - Entity Lifecycle & Decay Management
 * Deep Agents 3.0
 *
 * This domain manages the complete entity lifecycle:
 * - Freshness tracking with exponential decay
 * - Completeness assessment
 * - Quality scoring
 * - Engagement metrics
 * - Automatic staleness detection and re-research triggering
 */

export * from "./entityLifecycle";
export * from "./decayManager";
