import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePostEngagement } from "../../backend/convex/domains/social/linkedinPosting.js";

type CampaignPost = {
  id: string;
  sequence: number;
  rfsId: string | null;
  title: string;
  file: string;
  postType: string;
  claimStatus: "planned";
  priority: number;
};

type CampaignManifest = {
  schemaVersion: "nodekit.rfs-showcase-campaign/v1";
  campaignId: string;
  source: { label: string; url: string; verifiedAt: string };
  defaultTarget: "personal";
  defaultPersona: "FOUNDER";
  requiresHumanApproval: true;
  posts: CampaignPost[];
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const campaignRoot = resolve(repoRoot, "docs/campaigns/nodekit-rfs-showcase");
const manifest = JSON.parse(readFileSync(resolve(campaignRoot, "campaign.json"), "utf8")) as CampaignManifest;

const errors: string[] = [];
const seenIds = new Set<string>();
const forbiddenVerifiedClaims = [
  /\bnodekit (autonomously )?(built|deployed|certified)\b/i,
  /\bwe (autonomously )?(built|deployed|certified)\b/i,
  /\bis production[- ]certified\b/i,
  /\bis live at\b/i,
  /\b(?:is|was|now) taste[- ]certified\b/i,
];

if (manifest.schemaVersion !== "nodekit.rfs-showcase-campaign/v1") errors.push("manifest: wrong schemaVersion");
if (manifest.defaultTarget !== "personal") errors.push("manifest: launch packet must target the founder personal profile");
if (manifest.defaultPersona !== "FOUNDER") errors.push("manifest: persona must be FOUNDER");
if (manifest.requiresHumanApproval !== true) errors.push("manifest: human approval must remain required");
if (!/^https:\/\/www\.ycombinator\.com\/rfs/.test(manifest.source.url)) errors.push("manifest: official YC RFS source is required");

const payloads = manifest.posts
  .slice()
  .sort((a, b) => a.sequence - b.sequence)
  .map((post) => {
    if (seenIds.has(post.id)) errors.push(`${post.id}: duplicate post id`);
    seenIds.add(post.id);
    if (post.claimStatus !== "planned") errors.push(`${post.id}: blueprint claimStatus must remain planned`);
    if (post.rfsId !== null && !/^(0[1-9]|1[0-6])$/.test(post.rfsId)) errors.push(`${post.id}: invalid RFS id`);

    const content = readFileSync(resolve(campaignRoot, post.file), "utf8").trim();
    const gate = validatePostEngagement(content);
    if (!gate.passed) {
      for (const failure of gate.failures) errors.push(`${post.id}: ${failure}`);
    }
    if (post.rfsId !== null && !new RegExp(`Blueprint ${post.rfsId}/16`, "i").test(content)) {
      errors.push(`${post.id}: missing explicit Blueprint ${post.rfsId}/16 label`);
    }
    if (post.rfsId !== null && !/not (a |the )?(deployed-product claim|claim|finished interface)/i.test(content)) {
      errors.push(`${post.id}: missing explicit non-completion disclaimer`);
    }
    for (const pattern of forbiddenVerifiedClaims) {
      if (pattern.test(content)) errors.push(`${post.id}: contains unsupported verified claim ${pattern.source}`);
    }

    return {
      content,
      postType: post.postType,
      persona: manifest.defaultPersona,
      target: manifest.defaultTarget,
      source: "manual" as const,
      priority: post.priority,
      metadata: {
        campaignId: manifest.campaignId,
        campaignPostId: post.id,
        rfsId: post.rfsId,
        claimStatus: post.claimStatus,
        sourceUrl: manifest.source.url,
        sourceVerifiedAt: manifest.source.verifiedAt,
        requiresHumanApproval: manifest.requiresHumanApproval,
        gateSoftWarnings: gate.softWarnings,
      },
    };
  });

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "nodekit.rfs-showcase-queue-bundle/v1",
    campaignId: manifest.campaignId,
    generatedFrom: "docs/campaigns/nodekit-rfs-showcase/campaign.json",
    payloads,
  }, null, 2)}\n`);
}
