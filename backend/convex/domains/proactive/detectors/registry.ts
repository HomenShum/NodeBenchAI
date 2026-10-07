/**
 * Detector Registry
 * Central registry for all proactive detectors
 *
 * Usage:
 * ```typescript
 * import { detectorRegistry } from "./registry";
 *
 * // Get all detectors
 * const detectors = detectorRegistry.getAll();
 *
 * // Get specific detector
 * const detector = detectorRegistry.get("meeting_prep_v1");
 *
 * // Get detectors for event type
 * const detectors = detectorRegistry.getForEventType("email_received");
 * ```
 */

import type { IDetector } from "./types";

class DetectorRegistry {
  private detectors: Map<string, IDetector> = new Map();

  /**
   * Register a detector
   */
  register(detector: IDetector): void {
    const detectorId = detector.metadata.detectorId;

    if (this.detectors.has(detectorId)) {
      console.warn(`[DetectorRegistry] Detector ${detectorId} is already registered. Overwriting.`);
    }

    this.detectors.set(detectorId, detector);
    console.log(`[DetectorRegistry] Registered detector: ${detectorId} v${detector.metadata.version}`);
  }

  /**
   * Unregister a detector
   */
  unregister(detectorId: string): boolean {
    const existed = this.detectors.delete(detectorId);
    if (existed) {
      console.log(`[DetectorRegistry] Unregistered detector: ${detectorId}`);
    }
    return existed;
  }

  /**
   * Get a specific detector by ID
   */
  get(detectorId: string): IDetector | undefined {
    return this.detectors.get(detectorId);
  }

  /**
   * Get all registered detectors
   */
  getAll(): IDetector[] {
    return Array.from(this.detectors.values());
  }

  /**
   * Get all enabled detectors
   */
  getAllEnabled(): IDetector[] {
    return this.getAll().filter((d) => d.metadata.enabled);
  }

  /**
   * Get detectors for a specific event type
   */
  getForEventType(eventType: string): IDetector[] {
    return this.getAll().filter((detector) => {
      // Streaming detectors with matching event types
      if (
        detector.metadata.mode === "streaming" &&
        detector.metadata.eventTypes?.includes(eventType)
      ) {
        return true;
      }
      return false;
    });
  }

  /**
   * Get all batch detectors
   */
  getBatchDetectors(): IDetector[] {
    return this.getAll().filter((d) => d.metadata.mode === "batch");
  }

  /**
   * Get all streaming detectors
   */
  getStreamingDetectors(): IDetector[] {
    return this.getAll().filter((d) => d.metadata.mode === "streaming");
  }

  /**
   * Get detectors by tier
   */
  getByTier(tier: "free" | "paid" | "enterprise"): IDetector[] {
    return this.getAll().filter((d) => d.metadata.tier === tier);
  }

  /**
   * Check if detector is registered
   */
  has(detectorId: string): boolean {
    return this.detectors.has(detectorId);
  }

  /**
   * Get detector metadata
   */
  getMetadata(detectorId: string) {
    const detector = this.get(detectorId);
    return detector?.metadata;
  }

  /**
   * List all detector IDs
   */
  listIds(): string[] {
    return Array.from(this.detectors.keys());
  }

  /**
   * Get registry stats
   */
  getStats() {
    const all = this.getAll();
    return {
      total: all.length,
      enabled: all.filter((d) => d.metadata.enabled).length,
      disabled: all.filter((d) => !d.metadata.enabled).length,
      streaming: this.getStreamingDetectors().length,
      batch: this.getBatchDetectors().length,
      byTier: {
        free: this.getByTier("free").length,
        paid: this.getByTier("paid").length,
        enterprise: this.getByTier("enterprise").length,
      },
    };
  }

  /**
   * Clear all detectors (for testing)
   */
  clear(): void {
    this.detectors.clear();
    console.log("[DetectorRegistry] Cleared all detectors");
  }
}

// Singleton instance
export const detectorRegistry = new DetectorRegistry();

/**
 * Helper: Register multiple detectors at once
 */
export function registerDetectors(detectors: IDetector[]): void {
  for (const detector of detectors) {
    detectorRegistry.register(detector);
  }
}

/**
 * Helper: Get detector statistics
 */
export function getDetectorStats() {
  return detectorRegistry.getStats();
}
