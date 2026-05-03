import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const runConvexAction = vi.fn();
const runConvexMutation = vi.fn();
const runConvexQuery = vi.fn();

vi.mock("../lib/convex-client.js", () => ({
  runConvexAction,
  runConvexMutation,
  runConvexQuery,
}));

describe("public research routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { createApp } = await import("../app.js");
    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify(body),
    });
    return { response, json: await response.json() };
  }

  it("resolves entities through the public research mutation", async () => {
    runConvexMutation.mockResolvedValue({
      entityId: "ent_1",
      entityKey: "company:openai.com",
      canonicalName: "OpenAI",
      confidence: 0.86,
    });

    const { response, json } = await post("/v1/public-research/entities/resolve", {
      entityType: "company",
      name: "OpenAI",
      domain: "openai.com",
    });

    expect(response.status).toBe(200);
    expect(runConvexMutation).toHaveBeenCalledWith("domains/publicResearch/core:resolveEntity", {
      entityType: "company",
      name: "OpenAI",
      domain: "openai.com",
    });
    expect(json.entityKey).toBe("company:openai.com");
  });

  it("returns compact context packs for app-local scoring", async () => {
    runConvexQuery.mockResolvedValue({
      entity_key: "company:openai.com",
      use_case: "job_match",
      summary: "OpenAI builds AI products.",
      sources: [{ url: "https://openai.com", title: "OpenAI" }],
      private_boundary: "Public pack only. Private fit scoring must remain in the calling app.",
    });

    const { response, json } = await post("/v1/public-research/context/pack", {
      entityKey: "company:openai.com",
      useCase: "job_match",
    });

    expect(response.status).toBe(200);
    expect(runConvexQuery).toHaveBeenCalledWith("domains/publicResearch/core:getContextPack", {
      entityKey: "company:openai.com",
      useCase: "job_match",
    });
    expect(json.contextPack.private_boundary).toContain("Private fit scoring");
  });

  it("starts company research through the public research action", async () => {
    runConvexAction.mockResolvedValue({
      entity: { entityKey: "company:openai.com", canonicalName: "OpenAI" },
      claims: [],
      sources: [],
    });

    const { response, json } = await post("/v1/public-research/research/company", {
      companyName: "OpenAI",
      domain: "openai.com",
      visibility: "private_guided",
    });

    expect(response.status).toBe(200);
    expect(runConvexAction).toHaveBeenCalledWith("domains/publicResearch/actions:researchCompany", {
      companyName: "OpenAI",
      domain: "openai.com",
      visibility: "private_guided",
    });
    expect(json.dossier.entity.entityKey).toBe("company:openai.com");
  });

  it("rejects invalid public claim submissions before Convex", async () => {
    const { response, json } = await post("/v1/public-research/claims/submit-public", {
      entity: { entityType: "company", name: "OpenAI" },
      claim: "OpenAI has docs.",
      claimType: "product",
      sourceUrl: "not-a-url",
      evidenceSnippet: "docs",
    });

    expect(response.status).toBe(400);
    expect(json.error).toBe("validation_error");
    expect(runConvexMutation).not.toHaveBeenCalled();
  });
});
