/**
 * Unit tests for statusHelpers utility functions
 */

import { describe, it, expect } from "vitest";
import {
  statusChipClasses,
  statusLabel,
  isTaskStatus,
  eventStatusBar,
  kanbanStatusBar,
  priorityClasses,
} from "../statusHelpers";

describe("statusHelpers", () => {
  describe("statusChipClasses", () => {
    it("should return correct classes for in_progress status", () => {
      expect(statusChipClasses("in_progress")).toBe(
        "bg-blue-50 text-blue-700 border-blue-200",
      );
    });

    it("should return correct classes for done status", () => {
      expect(statusChipClasses("done")).toBe(
        "bg-indigo-50 text-content-secondary border-indigo-200",
      );
    });

    it("should return correct classes for blocked status", () => {
      expect(statusChipClasses("blocked")).toBe(
        "bg-rose-50 text-rose-700 border-rose-200",
      );
    });

    it("should return correct classes for todo status", () => {
      expect(statusChipClasses("todo")).toBe(
        "bg-slate-50 text-slate-700 border-slate-200",
      );
    });

    it("should return default classes for undefined status", () => {
      expect(statusChipClasses(undefined)).toBe(
        "bg-slate-50 text-slate-700 border-slate-200",
      );
    });

    it("should return default classes for unknown status", () => {
      expect(statusChipClasses("unknown")).toBe(
        "bg-slate-50 text-slate-700 border-slate-200",
      );
    });
  });

  describe("statusLabel", () => {
    it("should return correct label for in_progress", () => {
      expect(statusLabel("in_progress")).toBe("IN PROGRESS");
    });

    it("should return correct label for done", () => {
      expect(statusLabel("done")).toBe("DONE");
    });

    it("should return correct label for blocked", () => {
      expect(statusLabel("blocked")).toBe("BLOCKED");
    });

    it("should return correct label for todo", () => {
      expect(statusLabel("todo")).toBe("TODO");
    });

    it("should return default label for undefined", () => {
      expect(statusLabel(undefined)).toBe("TODO");
    });

    it("should return default label for unknown status", () => {
      expect(statusLabel("unknown")).toBe("TODO");
    });
  });

  describe("isTaskStatus", () => {
    it("should return true for valid task statuses", () => {
      expect(isTaskStatus("todo")).toBe(true);
      expect(isTaskStatus("in_progress")).toBe(true);
      expect(isTaskStatus("done")).toBe(true);
      expect(isTaskStatus("blocked")).toBe(true);
    });

    it("should return false for invalid statuses", () => {
      expect(isTaskStatus("invalid")).toBe(false);
      expect(isTaskStatus("")).toBe(false);
      expect(isTaskStatus("confirmed")).toBe(false);
    });
  });

  describe("eventStatusBar", () => {
    it("should return correct color for confirmed", () => {
      expect(eventStatusBar("confirmed")).toBe("bg-indigo-500/60");
    });

    it("should return correct color for tentative", () => {
      expect(eventStatusBar("tentative")).toBe("bg-amber-500/60");
    });

    it("should return correct color for cancelled", () => {
      expect(eventStatusBar("cancelled")).toBe("bg-rose-500/60");
    });

    it("should return default color for undefined", () => {
      expect(eventStatusBar(undefined)).toBe("bg-[var(--border-color)]");
    });

    it("should return default color for unknown status", () => {
      expect(eventStatusBar("unknown")).toBe("bg-[var(--border-color)]");
    });
  });

  describe("kanbanStatusBar", () => {
    it("should return correct color for todo", () => {
      expect(kanbanStatusBar("todo")).toBe("bg-slate-400/70");
    });

    it("should return correct color for in_progress", () => {
      expect(kanbanStatusBar("in_progress")).toBe("bg-blue-400/70");
    });

    it("should return correct color for done", () => {
      expect(kanbanStatusBar("done")).toBe("bg-indigo-500/80");
    });

    it("should return correct color for blocked", () => {
      expect(kanbanStatusBar("blocked")).toBe("bg-rose-500/80");
    });

    it("should return default color for undefined", () => {
      expect(kanbanStatusBar(undefined)).toBe("bg-[var(--border-color)]");
    });

    it("should return default color for unknown status", () => {
      expect(kanbanStatusBar("unknown")).toBe("bg-[var(--border-color)]");
    });
  });

  describe("priorityClasses", () => {
    it("should return correct classes for low priority", () => {
      expect(priorityClasses("low")).toBe(
        "bg-green-500/10 text-green-700 border-green-400/30",
      );
      expect(priorityClasses("Low")).toBe(
        "bg-green-500/10 text-green-700 border-green-400/30",
      );
      expect(priorityClasses("LOW")).toBe(
        "bg-green-500/10 text-green-700 border-green-400/30",
      );
    });

    it("should return correct classes for medium priority", () => {
      expect(priorityClasses("medium")).toBe(
        "bg-yellow-500/10 text-yellow-700 border-yellow-400/30",
      );
      expect(priorityClasses("Medium")).toBe(
        "bg-yellow-500/10 text-yellow-700 border-yellow-400/30",
      );
    });

    it("should return correct classes for high priority", () => {
      expect(priorityClasses("high")).toBe(
        "bg-orange-500/10 text-orange-700 border-orange-400/30",
      );
      expect(priorityClasses("High")).toBe(
        "bg-orange-500/10 text-orange-700 border-orange-400/30",
      );
    });

    it("should return correct classes for urgent priority", () => {
      expect(priorityClasses("urgent")).toBe(
        "bg-red-500/10 text-red-700 border-red-400/30",
      );
      expect(priorityClasses("Urgent")).toBe(
        "bg-red-500/10 text-red-700 border-red-400/30",
      );
    });

    it("should return default classes for undefined", () => {
      expect(priorityClasses(undefined)).toBe(
        "bg-surface text-content-secondary border-edge",
      );
    });

    it("should return default classes for empty string", () => {
      expect(priorityClasses("")).toBe(
        "bg-surface text-content-secondary border-edge",
      );
    });

    it("should return default classes for unknown priority", () => {
      expect(priorityClasses("unknown")).toBe(
        "bg-surface text-content-secondary border-edge",
      );
    });
  });
});

