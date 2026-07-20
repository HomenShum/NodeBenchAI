import { describe, it, expect } from "vitest";
import { reorderTaskPillsForTightRows } from "../tasks";
import type { Pill } from "../metaPillMappers";

const p = (kind: Pill["kind"], label: string, icon = ""): Pill => ({ kind, label, icon });

describe("reorderTaskPillsForTightRows", () => {
  it("keeps ideal order when already sorted", () => {
    const input: Pill[] = [
      p("type", "Task"),
      p("when", "Due today"),
      p("details", "P1"),
      p("project", "Alpha"),
      p("link", "example.com"),
      p("updated", "Updated 1d ago"),
    ];
    const out = reorderTaskPillsForTightRows(input);
    expect(out).toMatchSnapshot();
  });

  it("moves details before project when needed", () => {
    const input: Pill[] = [
      p("type", "Task"),
      p("when", "Due tomorrow"),
      p("project", "Beta"),
      p("details", "High"),
      p("link", "example.org"),
    ];
    const out = reorderTaskPillsForTightRows(input);
    expect(out).toMatchSnapshot();
  });

  it("handles missing type/when gracefully", () => {
    const input: Pill[] = [
      p("project", "Gamma"),
      p("details", "Low"),
      p("updated", "Updated 2h ago"),
    ];
    const out = reorderTaskPillsForTightRows(input);
    expect(out).toMatchSnapshot();
  });

  it("respects max truncation", () => {
    const input: Pill[] = [
      p("type", "Task"),
      p("project", "Delta"),
      p("details", "P2"),
      p("when", "Due next week"),
      p("link", "example.com"),
      p("updated", "Updated 5m ago"),
    ];
    const out = reorderTaskPillsForTightRows(input, 4);
    expect(out).toMatchSnapshot();
  });
});
