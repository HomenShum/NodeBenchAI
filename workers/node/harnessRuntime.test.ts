/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";

import { HarnessRuntime, decideHarnessRouting } from "./harnessRuntime.js";
import type { McpTool } from "../packages/mcp-local/src/types.js";

function createTool(name: string, handler: McpTool["handler"]): McpTool {
  return {
    name,
    description: name,
    inputSchema: { type: "object", properties: {} },
    handler,
  };
}

describe("HarnessRuntime", () => {
  it("routes routine queries through the executive lane", () => {
    const routing = decideHarnessRouting({
      query: "What is Ramp fintech?",
      classification: "company_search",
      entities: ["Ramp"],
    });

    expect(routing.routingMode).toBe("executive");
    expect(routing.reasoningEffort).toBe("medium");
    expect(routing.routingSource).toBe("automatic");
  });

  it("routes planning and explicit go-deeper requests through the advisor lane", () => {
    const planningRouting = decideHarnessRouting({
      query: "Help me plan the feature rollout.",
      classification: "plan_proposal",
      entities: [],
    });
    const forcedRouting = decideHarnessRouting({
      query: "What is Ramp fintech? Go deeper and show tradeoffs.",
      classification: "company_search",
      entities: ["Ramp"],
    });

    expect(planningRouting.routingMode).toBe("advisor");
    expect(planningRouting.routingSource).toBe("automatic");
    expect(forcedRouting.routingMode).toBe("advisor");
    expect(forcedRouting.routingSource).toBe("user_forced");
  });

  it("routes prep-brief requests through the advisor lane", () => {
    const routing = decideHarnessRouting({
      query: "Prep me for tomorrow's call with Stripe.",
      classification: "company_search",
      entities: ["Stripe"],
    });

    expect(routing.routingMode).toBe("advisor");
    expect(routing.routingSource).toBe("automatic");
    expect(routing.reasoningEffort).toBe("high");
  });

  it("queues steering and applies it to the next steerable step", async () => {
    const observedArgs = new Map<string, Record<string, unknown>>();
    const runtime = new HarnessRuntime([
      createTool("call_llm", async (args) => {
        const prompt = typeof args?.prompt === "string" ? args.prompt : "";
        if (prompt.includes('Classify this query. Return ONLY valid JSON.')) {
          return {
            response: JSON.stringify({
              type: "company_search",
              entities: ["Ramp"],
              entity: "Ramp",
            }),
          };
        }
        return { response: "" };
      }),
      createTool("linkup_search", async (args) => {
        observedArgs.set("linkup_search", args);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { hits: 2 };
      }),
      createTool("web_search", async (args) => {
        observedArgs.set(`web_search:${observedArgs.size}`, args);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { hits: 3 };
      }),
      createTool("run_recon", async (args) => {
        observedArgs.set("run_recon", args);
        return { recon: true };
      }),
      createTool("enrich_entity", async (args) => {
        observedArgs.set("enrich_entity", args);
        return { enriched: true };
      }),
    ]);

    const session = runtime.createSession({ lens: "founder" });
    const queued = runtime.queueSteering(session.id, { btw: "Focus on GTM and monetization." }, "test");
    expect(queued).not.toBeNull();
    expect(runtime.getPendingSteeringCount(session.id)).toBe(1);

    const result = await runtime.run(session.id, "What is Ramp fintech?");

    expect(result.planSteps).toBeGreaterThan(0);
    expect(runtime.getPendingSteeringCount(session.id)).toBe(0);
    expect(
      result.trace.some((event) => event.step === "steering_dequeued" && event.status === "ok"),
    ).toBe(true);
    expect(
      result.trace.some((event) => event.step === "skill_extract"),
    ).toBe(true);
    expect(
      result.trace.some((event) => event.step === "distill_export"),
    ).toBe(true);

    const steerableArgs = observedArgs.get("run_recon") ?? observedArgs.get("enrich_entity");
    expect(steerableArgs?._steering).toEqual({ btw: "Focus on GTM and monetization." });
  });
});
