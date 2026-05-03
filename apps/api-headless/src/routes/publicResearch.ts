import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { runConvexAction, runConvexMutation, runConvexQuery } from "../lib/convex-client.js";
import { requireScope } from "../middleware/auth.js";

const router = Router();

const entityTypeSchema = z.enum(["company", "person", "role", "product", "investor", "school", "source"]);

const entitySignalSchema = z.object({
  entityId: z.string().optional(),
  entityType: entityTypeSchema.optional(),
  name: z.string().optional(),
  domain: z.string().optional(),
  url: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  linkedinUrl: z.string().optional(),
  githubUrl: z.string().optional(),
});

const requirePublicResearchRead = requireScope("public_research:read");
const requirePublicResearchWrite = requireScope("public_research:write");

router.post("/entities/resolve", requirePublicResearchWrite, async (req: Request, res: Response) => {
  const parsed = entitySignalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.issues, requestId: req.requestId });
    return;
  }
  const result = await runConvexMutation("domains/publicResearch/core:resolveEntity", parsed.data);
  res.json({ requestId: req.requestId, ...result });
});

router.post("/research/company", requirePublicResearchWrite, async (req: Request, res: Response) => {
  const parsed = z.object({
    companyName: z.string().min(1),
    domain: z.string().optional(),
    goal: z.string().optional(),
    visibility: z.enum(["public", "private_guided"]).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.issues, requestId: req.requestId });
    return;
  }
  const result = await runConvexAction("domains/publicResearch/actions:researchCompany", parsed.data);
  res.json({ requestId: req.requestId, generatedAt: new Date().toISOString(), dossier: result });
});

router.post("/research/person", requirePublicResearchWrite, async (req: Request, res: Response) => {
  const parsed = z.object({
    personName: z.string().min(1),
    goal: z.string().optional(),
    visibility: z.enum(["public", "private_guided"]).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.issues, requestId: req.requestId });
    return;
  }
  const result = await runConvexAction("domains/publicResearch/actions:researchPerson", parsed.data);
  res.json({ requestId: req.requestId, generatedAt: new Date().toISOString(), dossier: result });
});

router.post("/research/role", requirePublicResearchWrite, async (req: Request, res: Response) => {
  const parsed = z.object({
    roleTitle: z.string().min(1),
    companyName: z.string().optional(),
    goal: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.issues, requestId: req.requestId });
    return;
  }
  const result = await runConvexAction("domains/publicResearch/actions:researchRole", parsed.data);
  res.json({ requestId: req.requestId, generatedAt: new Date().toISOString(), contextPack: result });
});

router.post("/search-public-sources", requirePublicResearchWrite, async (req: Request, res: Response) => {
  const parsed = z.object({
    query: z.string().min(1),
    entity: entitySignalSchema.optional(),
    maxResults: z.number().int().min(1).max(20).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.issues, requestId: req.requestId });
    return;
  }
  const result = await runConvexAction("domains/publicResearch/actions:searchPublicSources", parsed.data);
  res.json({ requestId: req.requestId, generatedAt: new Date().toISOString(), result });
});

router.post("/research/start", requirePublicResearchWrite, async (req: Request, res: Response) => {
  const parsed = z.object({
    entity: entitySignalSchema,
    kind: entityTypeSchema.optional(),
    goal: z.string().optional(),
    visibility: z.enum(["public", "private_guided"]).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.issues, requestId: req.requestId });
    return;
  }
  const result = await runConvexMutation("domains/publicResearch/core:startResearchRun", parsed.data);
  res.status(202).json({ requestId: req.requestId, ...result });
});

router.get("/research/:runId", requirePublicResearchRead, async (req: Request, res: Response) => {
  const result = await runConvexQuery("domains/publicResearch/core:getResearchStatus", {
    researchRunId: req.params.runId,
  });
  if (!result) {
    res.status(404).json({ error: "not_found", requestId: req.requestId });
    return;
  }
  res.json({ requestId: req.requestId, run: result });
});

router.get("/dossiers/:entityKey", requirePublicResearchRead, async (req: Request, res: Response) => {
  const result = await runConvexQuery("domains/publicResearch/core:getEntityDossier", {
    entityKey: req.params.entityKey,
  });
  if (!result) {
    res.status(404).json({ error: "not_found", requestId: req.requestId });
    return;
  }
  res.json({ requestId: req.requestId, dossier: result });
});

router.post("/context/pack", requirePublicResearchRead, async (req: Request, res: Response) => {
  const parsed = z.object({
    entityKey: z.string().optional(),
    entityType: entityTypeSchema.optional(),
    name: z.string().optional(),
    useCase: z.enum(["job_match", "interview_prep", "sales_research", "general"]).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.issues, requestId: req.requestId });
    return;
  }
  const result = await runConvexQuery("domains/publicResearch/core:getContextPack", parsed.data);
  res.json({ requestId: req.requestId, contextPack: result });
});

router.post("/claims/submit-public", requirePublicResearchWrite, async (req: Request, res: Response) => {
  const parsed = z.object({
    entity: entitySignalSchema,
    claim: z.string().min(1),
    claimType: z.string().min(1),
    sourceUrl: z.string().url(),
    sourceTitle: z.string().optional(),
    evidenceSnippet: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    submittedBySurface: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.issues, requestId: req.requestId });
    return;
  }
  const result = await runConvexMutation("domains/publicResearch/core:submitPublicClaim", parsed.data);
  res.json({ requestId: req.requestId, ...result });
});

router.post("/claims/verify", requirePublicResearchWrite, async (req: Request, res: Response) => {
  const parsed = z.object({
    claimId: z.string().min(1),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.issues, requestId: req.requestId });
    return;
  }
  const result = await runConvexMutation("domains/publicResearch/core:verifyClaim", parsed.data);
  res.json({ requestId: req.requestId, ...result });
});

router.post("/private-links", requirePublicResearchWrite, async (req: Request, res: Response) => {
  const parsed = z.object({
    ownerKey: z.string().min(1),
    entity: entitySignalSchema,
    privateSignalKind: z.string().min(1),
    privateSignalSummary: z.string().min(1),
    publicPurpose: z.string().min(1),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.issues, requestId: req.requestId });
    return;
  }
  const result = await runConvexMutation("domains/publicResearch/core:linkPrivateSignalToPublicEntity", parsed.data);
  res.json({ requestId: req.requestId, ...result });
});

router.get("/latest", requirePublicResearchRead, async (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 8);
  const result = await runConvexQuery("domains/publicResearch/core:listLatestPublicEntityResearch", {
    limit: Number.isFinite(limit) ? limit : 8,
  });
  res.json({ requestId: req.requestId, results: result });
});

export default router;
