/**
 * Base Detector Classes
 * Abstract base classes for streaming and batch detectors
 */

import type {
  IDetector,
  DetectorMetadata,
  DetectorContext,
  DetectorResult,
  DetectedOpportunity,
} from "./types";

/**
 * Abstract base class for all detectors
 * Provides common functionality and validation
 */
export abstract class BaseDetector implements IDetector {
  abstract readonly metadata: DetectorMetadata;

  /**
   * Main execution method - must be implemented by subclasses
   */
  abstract run(ctx: DetectorContext): Promise<DetectorResult>;

  /**
   * Default implementation of canRun
   * Can be overridden by subclasses
   */
  async canRun(ctx: DetectorContext): Promise<boolean> {
    // Check if detector is enabled
    if (!this.metadata.enabled) {
      return false;
    }

    // Check user settings
    if (ctx.userSettings) {
      // Check if detector is enabled for this user
      if (!ctx.userSettings.enabledDetectors.includes(this.metadata.detectorId)) {
        return false;
      }
    }

    // Check quiet hours (if applicable)
    if (ctx.userSettings?.quietHoursStart !== undefined && ctx.userSettings?.quietHoursEnd !== undefined) {
      const now = new Date();
      const currentHour = now.getHours();
      const quietStart = ctx.userSettings.quietHoursStart;
      const quietEnd = ctx.userSettings.quietHoursEnd;

      // Check if current time is in quiet hours
      if (quietStart < quietEnd) {
        // Normal case: e.g., 22:00 - 08:00
        if (currentHour >= quietStart && currentHour < quietEnd) {
          return false;
        }
      } else {
        // Wraps midnight: e.g., 22:00 - 08:00
        if (currentHour >= quietStart || currentHour < quietEnd) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Optional cleanup - can be overridden
   */
  async cleanup(): Promise<void> {
    // Default: no cleanup needed
  }

  /**
   * Helper: Create opportunity with defaults
   */
  protected createOpportunity(
    partial: Partial<Omit<DetectedOpportunity, "trigger" | "type">> & {
      type: string;
      trigger: {
        eventIds: string[];
        whyNow: string;
      };
    }
  ): DetectedOpportunity {
    const opportunityId =
      partial.opportunityId ||
      `${partial.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
      opportunityId,
      type: partial.type,
      trigger: {
        ...partial.trigger,
        detectorName: this.metadata.detectorId,
        detectorVersion: this.metadata.version,
      },
      evidencePointers: partial.evidencePointers || [],
      impactEstimate: partial.impactEstimate || {
        confidenceLevel: 0.8,
      },
      riskLevel: partial.riskLevel || "low",
      suggestedActions: partial.suggestedActions || [],
      metadata: partial.metadata,
      expiresAt: partial.expiresAt,
    };
  }

  /**
   * Helper: Create success result
   */
  protected createSuccessResult(
    opportunities: DetectedOpportunity[],
    stats?: {
      executionTime?: number;
      eventsProcessed?: number;
      artifactsAccessed?: number;
      warnings?: string[];
    }
  ): DetectorResult {
    return {
      success: true,
      opportunities,
      executionTime: stats?.executionTime || 0,
      eventsProcessed: stats?.eventsProcessed,
      artifactsAccessed: stats?.artifactsAccessed,
      warnings: stats?.warnings,
    };
  }

  /**
   * Helper: Create error result
   */
  protected createErrorResult(error: string): DetectorResult {
    return {
      success: false,
      opportunities: [],
      executionTime: 0,
      error,
    };
  }
}

/**
 * Streaming Detector
 * Processes events one-by-one in real-time
 *
 * Usage:
 * ```typescript
 * class MyDetector extends StreamingDetector {
 *   metadata = { ... };
 *   async processEvent(event, ctx) {
 *     // Process single event
 *     return opportunities;
 *   }
 * }
 * ```
 */
export abstract class StreamingDetector extends BaseDetector {
  /**
   * Process a single event
   * Must be implemented by subclasses
   */
  abstract processEvent(
    event: NonNullable<DetectorContext["event"]>,
    ctx: DetectorContext
  ): Promise<DetectedOpportunity[]>;

  /**
   * Run implementation for streaming detectors
   */
  async run(ctx: DetectorContext): Promise<DetectorResult> {
    const startTime = Date.now();

    try {
      // Validate that an event was provided
      if (!ctx.event) {
        return this.createErrorResult("Streaming detector requires an event");
      }

      // Check if we can run
      const canRun = await this.canRun(ctx);
      if (!canRun) {
        return this.createSuccessResult([], {
          executionTime: Date.now() - startTime,
          warnings: ["Detector cannot run (disabled or quiet hours)"],
        });
      }

      // Check if this detector handles this event type
      if (
        this.metadata.eventTypes &&
        !this.metadata.eventTypes.includes(ctx.event.eventType)
      ) {
        return this.createSuccessResult([], {
          executionTime: Date.now() - startTime,
          warnings: [`Event type ${ctx.event.eventType} not handled by this detector`],
        });
      }

      // Process the event
      const opportunities = await this.processEvent(ctx.event, ctx);

      return this.createSuccessResult(opportunities, {
        executionTime: Date.now() - startTime,
        eventsProcessed: 1,
      });
    } catch (error: any) {
      return this.createErrorResult(error.message || "Unknown error");
    }
  }
}

/**
 * Batch Detector
 * Processes events in batches on a schedule
 *
 * Usage:
 * ```typescript
 * class MyDetector extends BatchDetector {
 *   metadata = { schedule: { cron: "0 8 * * *" }, ... };
 *   async processBatch(events, ctx) {
 *     // Process multiple events
 *     return opportunities;
 *   }
 * }
 * ```
 */
export abstract class BatchDetector extends BaseDetector {
  /**
   * Process a batch of events
   * Must be implemented by subclasses
   */
  abstract processBatch(
    events: NonNullable<DetectorContext["event"]>[],
    ctx: DetectorContext
  ): Promise<DetectedOpportunity[]>;

  /**
   * Run implementation for batch detectors
   */
  async run(ctx: DetectorContext): Promise<DetectorResult> {
    const startTime = Date.now();

    try {
      // Check if we can run
      const canRun = await this.canRun(ctx);
      if (!canRun) {
        return this.createSuccessResult([], {
          executionTime: Date.now() - startTime,
          warnings: ["Detector cannot run (disabled or quiet hours)"],
        });
      }

      // Validate time window
      if (!ctx.timeWindow) {
        return this.createErrorResult("Batch detector requires a time window");
      }

      // Query events in time window
      if (!ctx.queryEvents) {
        return this.createErrorResult("Context missing queryEvents method");
      }

      const events = await ctx.queryEvents({
        startTime: ctx.timeWindow.startTime,
        endTime: ctx.timeWindow.endTime,
        eventTypes: this.metadata.eventTypes,
      });

      // Process the batch
      const opportunities = await this.processBatch(
        events as NonNullable<DetectorContext["event"]>[],
        ctx
      );

      return this.createSuccessResult(opportunities, {
        executionTime: Date.now() - startTime,
        eventsProcessed: events.length,
      });
    } catch (error: any) {
      return this.createErrorResult(error.message || "Unknown error");
    }
  }
}
