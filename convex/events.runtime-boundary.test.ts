import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const eventsSource = readFileSync(join(here, "events.ts"), "utf8");

function functionBlock(name: string): string {
  const start = eventsSource.indexOf(`export const ${name} = mutation({`);
  expect(start, `${name} mutation should exist`).toBeGreaterThanOrEqual(0);
  const next = eventsSource.indexOf("\nexport const ", start + 1);
  return eventsSource.slice(start, next > start ? next : undefined);
}

describe("scratchnode public runtime boundaries", () => {
  it("keeps public /ask isolated from private user notes", () => {
    const askAgent = functionBlock("askAgent");

    expect(askAgent).not.toContain("userNotes");
    expect(askAgent).not.toContain("getPrivate");
    expect(askAgent).toContain("requireMember");
    expect(askAgent).toContain("liveEventSources");
    expect(askAgent).toContain("deterministic_synthesis");
  });

  it("keeps wiki publishing host-gated and sourced from public answers", () => {
    const publishWiki = functionBlock("publishWiki");

    expect(publishWiki).toContain("requireHost");
    expect(publishWiki).toContain("liveEventAnswers");
    expect(publishWiki).toContain("liveEventWikiVersions");
    expect(publishWiki).not.toContain("userNotes");
  });

  it("keeps host claim idempotent for the same owner key before rejecting claimed rooms", () => {
    const claimHost = functionBlock("claimHost");
    const ownerLookup = claimHost.indexOf('withIndex("by_event_owner"');
    const eventLookup = claimHost.indexOf('withIndex("by_event"');

    expect(ownerLookup).toBeGreaterThanOrEqual(0);
    expect(eventLookup).toBeGreaterThan(ownerLookup);
    expect(claimHost).toContain("host_already_claimed");
  });
});
