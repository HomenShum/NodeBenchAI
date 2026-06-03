import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const exportScript = path.join(repoRoot, "scripts", "repo", "export-scratchnode-live-public.mjs");

function runNodeScript(scriptPath: string, args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: node ${path.relative(repoRoot, scriptPath)} ${args.join(" ")}`.trim(),
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
}

describe("scratchnode public export", () => {
  test("generates an export whose public and owner-only event-log projections stay separated", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scratchnode-public-export-"));
    const outDir = path.join(tmpRoot, "export");
    try {
      runNodeScript(exportScript, ["--out", outDir], repoRoot);

      const readme = fs.readFileSync(path.join(outDir, "README.md"), "utf8");
      const invariants = fs.readFileSync(path.join(outDir, "docs", "invariants.md"), "utf8");
      const contract = JSON.parse(
        fs.readFileSync(path.join(outDir, "contracts", "scratchnode-live-api.json"), "utf8"),
      ) as {
        surface: string;
        framing: string;
        eventLogProjections: {
          publicEventLogJson: { visibility: string; includes: string[]; excludes: string[] };
          ownerPrivateNoteProjection: { visibility: string; includes: string[]; excludes: string[] };
        };
      };

      expect(readme).toMatch(/open-source event log assistant/i);
      expect(readme).toMatch(/memory layer for live events/i);
      expect(readme).not.toMatch(/\bproduction[-\s]+(?:ready|grade)\b/i);
      expect(invariants).toContain("Public event-log JSON contains public room moments only.");
      expect(invariants).toContain("Owner-only private note projections are separate from public event-log JSON.");

      expect(contract.surface).toBe("open-source event log assistant");
      expect(contract.framing).toBe("memory layer for live events");
      expect(contract.eventLogProjections.publicEventLogJson).toEqual({
        visibility: "public",
        includes: expect.arrayContaining([
          "event metadata",
          "public chat messages",
          "public /ask questions and answers",
          "host-promoted FAQ/wiki sections",
          "public source references",
          "typed manual location spots",
        ]),
        excludes: expect.arrayContaining([
          "private notes",
          "owner keys",
          "session ids",
          "handoff tokens",
          "NodeBench workspace artifacts",
        ]),
      });
      expect(contract.eventLogProjections.ownerPrivateNoteProjection).toEqual({
        visibility: "owner-only",
        includes: expect.arrayContaining([
          "owner private notes",
          "private note anchors",
          "private follow-ups",
          "NodeBench handoff context",
        ]),
        excludes: expect.arrayContaining([
          "public wiki JSON",
          "public /ask cache",
          "public answer traces",
          "other attendees' notes",
        ]),
      });

      runNodeScript(path.join(outDir, "scripts", "verify-public-export.mjs"), [], outDir);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
