/**
 * Unit tests for eventHelpers utility functions
 */

import { describe, it, expect } from "vitest";
import { isAllDayEvent } from "../eventHelpers";

describe("eventHelpers", () => {
  describe("isAllDayEvent", () => {
    it("should return true when allDay flag is true", () => {
      const event = { allDay: true };
      expect(isAllDayEvent(event)).toBe(true);
    });

    it("should return true for midnight to 11:59 PM events", () => {
      const startTime = new Date(2024, 0, 1, 0, 0, 0).getTime();
      const endTime = new Date(2024, 0, 1, 23, 59, 0).getTime();
      const event = { startTime, endTime };
      expect(isAllDayEvent(event)).toBe(true);
    });

    it("should return false for events with non-midnight start", () => {
      const startTime = new Date(2024, 0, 1, 9, 0, 0).getTime();
      const endTime = new Date(2024, 0, 1, 17, 0, 0).getTime();
      const event = { startTime, endTime };
      expect(isAllDayEvent(event)).toBe(false);
    });

    it("should return false for events with non-11:59 PM end", () => {
      const startTime = new Date(2024, 0, 1, 0, 0, 0).getTime();
      const endTime = new Date(2024, 0, 1, 17, 0, 0).getTime();
      const event = { startTime, endTime };
      expect(isAllDayEvent(event)).toBe(false);
    });

    it("should return false when startTime is missing", () => {
      const endTime = new Date(2024, 0, 1, 23, 59, 0).getTime();
      const event = { endTime };
      expect(isAllDayEvent(event)).toBe(false);
    });

    it("should return false when endTime is missing", () => {
      const startTime = new Date(2024, 0, 1, 0, 0, 0).getTime();
      const event = { startTime };
      expect(isAllDayEvent(event)).toBe(false);
    });

    it("should return false for null event", () => {
      expect(isAllDayEvent(null)).toBe(false);
    });

    it("should return false for undefined event", () => {
      expect(isAllDayEvent(undefined)).toBe(false);
    });

    it("should return false for empty object", () => {
      expect(isAllDayEvent({})).toBe(false);
    });
  });
});

