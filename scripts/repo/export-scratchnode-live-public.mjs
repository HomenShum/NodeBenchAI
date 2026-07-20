import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const outIndex = rawArgs.indexOf("--out");
const outArg = outIndex >= 0 ? rawArgs[outIndex + 1] : null;
const force = args.has("--force");
const dryRun = args.has("--dry-run");
const targetDir = path.resolve(repoRoot, outArg || ".tmp/scratchnode-live-public-export");

export const copyEntries = Object.freeze([
  ["public/proto/home-v5.html", "public/proto/home-v5.html", transformHomeV5],
  ["public/proto/docs.html", "public/proto/docs.html", transformDocsHtml],
  ["public/og-scratchnode.png", "public/og-scratchnode.png"],
  ["public/og-scratchnode.svg", "public/og-scratchnode.svg"],
  ["api/scratchnode-config.js", "api/scratchnode-config.js"],
  ["docs/architecture/SCRATCHNODE_NODEBENCH_BOUNDARY.md", "docs/architecture/SCRATCHNODE_NODEBENCH_BOUNDARY.md"],
  ["docs/architecture/PRODUCT_SURFACE_RUNTIME_OWNERSHIP.md", "docs/architecture/PRODUCT_SURFACE_RUNTIME_OWNERSHIP.md"],
  ["docs/architecture/PROTO_SURFACE_REAL_BACKEND_DOGFOOD.md", "docs/architecture/PROTO_SURFACE_REAL_BACKEND_DOGFOOD.md"],
  ["apps/web/src/shared/agentOutputContract.ts", "contracts/agentOutputContract.ts"],
  ["apps/web/src/shared/riskAttackEvaluator.ts", "contracts/riskAttackEvaluator.ts"],
  ["evals/e2e/scratchnode-demo-route-gate.spec.ts", "evals/e2e/scratchnode-demo-route-gate.spec.ts"],
  ["evals/e2e/scratchnode-live-route-honesty.spec.ts", "evals/e2e/scratchnode-live-route-honesty.spec.ts"],
  ["evals/e2e/home-v5-output-contract.spec.ts", "evals/e2e/home-v5-output-contract.spec.ts"],
  ["evals/e2e/proto-live-backend-dogfood.spec.ts", "evals/e2e/proto-live-backend-dogfood.spec.ts"],
  ["LICENSE", "LICENSE"],
]);

export const forbiddenRelativePaths = Object.freeze([
  ".mcp.json",
  "packages/mcp-local/.mcpregistry_registry_token",
  "packages/mcp-local/.mcpregistry_github_token",
  "public/dogfood",
  "public/benchmarks",
  "public/proto/home-v4.html",
  "backend",
  "convex",
  "server",
  "apps",
  "packages",
  "mcp-services",
  "python-mcp-servers",
  "node_modules",
  ".env",
  ".vercel",
  ".worktrees",
  ".claude",
  ".serena",
]);

const forbiddenContentPatterns = [
  { label: "hard-coded development service secret", pattern: /nodebench_dev_secret/i },
  { label: "OpenAI-style secret key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { label: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/ },
  { label: "local Windows workspace path", pattern: /D:\\\\VSCode Projects/i },
];

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(relativePath, content) {
  const destination = path.join(targetDir, relativePath);
  ensureParent(destination);
  fs.writeFileSync(destination, content);
}

function transformHomeV5(content) {
  return content;
}

function transformDocsHtml(content) {
  return content
    .replaceAll('href="home-v4.html"', 'href="https://www.nodebenchai.com/proto/home-v4.html"')
    .replaceAll('href="home-v5.html"', 'href="/"');
}

function copyAllowlistedEntries() {
  const copied = [];
  for (const [sourceRelative, destinationRelative, transform] of copyEntries) {
    const source = path.join(repoRoot, sourceRelative);
    if (!fs.existsSync(source)) {
      throw new Error(`Missing allowlisted source: ${sourceRelative}`);
    }

    const destination = path.join(targetDir, destinationRelative);
    ensureParent(destination);

    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      fs.cpSync(source, destination, { recursive: true });
    } else if (transform) {
      fs.writeFileSync(destination, transform(readText(source)));
    } else {
      fs.copyFileSync(source, destination);
    }
    copied.push(`${sourceRelative} -> ${destinationRelative}`);
  }
  return copied;
}

function writeGeneratedFiles(copiedEntries) {
  writeText("README.md", buildReadme());
  writeText("CONTRIBUTING.md", buildContributing());
  writeText("SECURITY.md", buildSecurity());
  writeText("MANIFEST.md", buildManifest(copiedEntries));
  writeText("package.json", `${JSON.stringify(buildPackageJson(), null, 2)}\n`);
  writeText("vercel.json", `${JSON.stringify(buildVercelJson(), null, 2)}\n`);
  writeText("robots.txt", buildRobotsTxt());
  writeText("sitemap.xml", buildSitemapXml());
  writeText(".env.example", buildEnvExample());
  writeText(".gitignore", buildGitignore());
  writeText("docs/invariants.md", buildInvariantsDoc());
  writeText("docs/prototype-vs-production.md", buildPrototypeStatusDoc());
  writeText("contracts/scratchnode-live-api.json", `${JSON.stringify(buildApiContract(), null, 2)}\n`);
  writeVerifyScript();
}

function buildReadme() {
  return `# ScratchNode Live

**Live rooms that remember.**

ScratchNode is a public event-room prototype where people join with a code, chat normally, use \`/ask\` for sourced answers, and leave behind a public wiki. Private notes stay private and can sync into NodeBench later.

- No app required.
- No account required for public room join.
- Public chat stays human.
- \`/ask\` calls the agent.
- Private notes never enter the public feed.
- Hosts promote useful answers into the event wiki.

> ScratchNode Live is the public room. NodeBench AI is the private workspace.

## Try It

Production: https://scratchnode.live

Local static preview:

\`\`\`bash
npm run dev
\`\`\`

## Core Loop

1. Join with a room code.
2. Chat with the room.
3. Use \`/ask\` for a sourced public answer.
4. Save private notes.
5. Host promotes useful answers to FAQ.
6. Event compacts into a public wiki.
7. Private work continues in NodeBench.

## Status

This is a sanitized public frontend split. The Convex backend, NodeBench workspace, MCP services, internal evals, and deploy orchestration remain in the private \`nodebench-ai\` monorepo.

See [docs/prototype-vs-production.md](docs/prototype-vs-production.md).

## Release-Blocker Invariants

See [docs/invariants.md](docs/invariants.md).

## Architecture

\`\`\`text
scratchnode.live
  -> public event room shell
  -> /ask and private-note UI
  -> public docs and route honesty tests

NodeBench Runtime
  -> Convex durable state
  -> agent orchestration
  -> search, trace, cache, cost controls

nodebenchai.com
  -> private workspace continuation
\`\`\`

## Verify

\`\`\`bash
npm install
npm run verify
\`\`\`
`;
}

function buildContributing() {
  return `# Contributing

This repo is intentionally narrow. Keep ScratchNode simple:

- join room
- public chat
- \`/ask\`
- public answer card and trace
- private note
- FAQ suggest/promote
- wiki publish
- sign-in / my events entry points

Do not add NodeBench workspace depth, MCP services, Convex implementation, internal dogfood, or provider integrations to this public split.
`;
}

function buildSecurity() {
  return `# Security

Please report security issues privately to the maintainers instead of opening a public issue.

## Public Boundary

This repo should not contain secrets, deploy tokens, dogfood traces, internal MCP services, or backend implementation. The public frontend talks to a configured Convex deployment through documented public APIs.

## Privacy Invariant

Private notes must never enter public chat, public wiki, public traces, or public cache entries.
`;
}

function buildManifest(copiedEntries) {
  return `# ScratchNode Live Public Export

Generated from \`nodebench-ai\` on ${new Date().toISOString()}.

## Included

${copiedEntries.map((entry) => `- \`${entry}\``).join("\n")}

## Excluded On Purpose

- Convex implementation
- NodeBench private workspace implementation
- MCP/API/headless services
- internal dogfood and benchmark artifacts
- provider integrations
- deployment secrets and local config
- historical prototype files other than \`home-v5.html\` and public docs

## Backend Compatibility

The backend source of truth remains the private monorepo. Any Convex function rename or contract change must be deployed additively before this frontend is updated.
`;
}

function buildPackageJson() {
  return {
    name: "scratchnode-live",
    version: "0.1.0",
    private: true,
    type: "module",
    description: "Live event rooms that turn public chat and /ask answers into a wiki while private notes stay private.",
    scripts: {
      dev: "vercel dev",
      verify: "npm run verify:static",
      "verify:static": "node scripts/verify-public-export.mjs",
      "test:e2e": "playwright test evals/e2e/scratchnode-demo-route-gate.spec.ts evals/e2e/scratchnode-live-route-honesty.spec.ts evals/e2e/home-v5-output-contract.spec.ts --project=chromium --workers=1",
    },
    devDependencies: {
      "@playwright/test": "^1.53.0",
      vercel: "^41.6.0",
    },
  };
}

function buildVercelJson() {
  return {
    redirects: [
      {
        source: "/(.*)",
        has: [{ type: "host", value: "www.scratchnode.live" }],
        destination: "https://scratchnode.live/$1",
        permanent: true,
      },
    ],
    rewrites: [
      { source: "/api/scratchnode-config", destination: "/api/scratchnode-config.js" },
      { source: "/docs", destination: "/proto/docs.html" },
      { source: "/docs.html", destination: "/proto/docs.html" },
      { source: "/og-scratchnode.png", destination: "/og-scratchnode.png" },
      { source: "/og-scratchnode.svg", destination: "/og-scratchnode.svg" },
      { source: "/(.*)", destination: "/proto/home-v5.html" },
    ],
    headers: [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ],
  };
}

function buildRobotsTxt() {
  return `User-agent: *
Allow: /

Sitemap: https://scratchnode.live/sitemap.xml
`;
}

function buildSitemapXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://scratchnode.live/</loc></url>
  <url><loc>https://scratchnode.live/docs</loc></url>
</urlset>
`;
}

function buildEnvExample() {
  return `# ScratchNode Live public frontend

# Required. Public Convex deployment URL used by /api/scratchnode-config.
CONVEX_URL=https://your-project.convex.cloud

# Optional alias for local Vite-style environments.
VITE_CONVEX_URL=https://your-project.convex.cloud
`;
}

function buildGitignore() {
  return `node_modules/
.vercel/
.env
.env.*
!.env.example
playwright-report/
test-results/
.tmp/
.DS_Store
*.log
.mcp.json
.mcpregistry_registry_token
.mcpregistry_github_token
`;
}

function buildInvariantsDoc() {
  return `# Release-Blocker Invariants

These are product safety rules, not preferences.

1. Private notes never enter the public feed.
2. Normal chat never invokes the agent.
3. Agent answers always show their parent \`/ask\`.
4. Public users suggest FAQ entries; hosts promote them.
5. Public traces show "No private notes used."
6. Demo automation runs only on \`/demo_ver*\`.
7. Missing live rooms show an honest missing-room state, not mock chat.
`;
}

function buildPrototypeStatusDoc() {
  return `# Prototype vs Production

| Area | Public split | Production source of truth |
| --- | --- | --- |
| Event-room UI | \`public/proto/home-v5.html\` | This repo's public shell |
| Durable state | Public Convex API calls | Private \`nodebench-ai\` monorepo |
| Private notes | UI + public contract | Convex backend and NodeBench handoff |
| Agent runtime | Public answer cards and traces | NodeBench Runtime |
| Search/cache | Public contract docs | Typesense/Redis/Linkup/pi-ai in private backend |
| NodeBench workspace | External handoff URL | \`nodebenchai.com\` |

This repo should stay focused on the public live room. Backend runtime changes happen in \`nodebench-ai\` and are deployed additively before frontend contract changes.
`;
}

function buildApiContract() {
  return {
    convexFunctions: [
      "events:getEventBySlug",
      "events:joinEvent",
      "events:sendMessage",
      "events:createEvent",
      "events:updateEvent",
      "events:endEvent",
      "events:publishWiki",
      "events:rotateHostClaimCode",
      "events:upsertEventSource",
      "events:deleteEventSource",
      "events:suggestFAQ",
      "events:promoteFAQ",
      "notes:createPrivateNote",
      "notes:listMyPrivateNotes",
      "notes:updatePrivateNote",
      "notes:deletePrivateNote",
      "users:mergeGuestSession",
    ],
    localStorageKeys: [
      "sn_session_id",
      "sn_host_owner_key_v2",
      "sn_host_owner_key",
    ],
    privacyInvariants: [
      "private notes never create eventMessages rows",
      "public ask traces say no private notes used",
      "private note markers are owner-only",
    ],
  };
}

function writeVerifyScript() {
  const script = `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "public/proto/home-v5.html",
  "public/proto/docs.html",
  "api/scratchnode-config.js",
  "contracts/scratchnode-live-api.json",
  "docs/invariants.md",
  "vercel.json",
];

const missing = required.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)));
if (missing.length) {
  console.error("Missing required files:\\n" + missing.map((entry) => " - " + entry).join("\\n"));
  process.exit(1);
}

const forbidden = [
  ".mcp.json",
  "packages/mcp-local/.mcpregistry_registry_token",
  "public/dogfood",
  "public/benchmarks",
  "backend",
  "convex",
  "server",
  "apps",
  "packages",
];

const presentForbidden = forbidden.filter((relativePath) => fs.existsSync(path.join(root, relativePath)));
if (presentForbidden.length) {
  console.error("Forbidden paths present:\\n" + presentForbidden.map((entry) => " - " + entry).join("\\n"));
  process.exit(1);
}

console.log("ScratchNode public export verification passed.");
`;
  writeText("scripts/verify-public-export.mjs", script);
}

function scanOutputForSafetyIssues() {
  const failures = [];

  for (const relativePath of forbiddenRelativePaths) {
    if (fs.existsSync(path.join(targetDir, relativePath))) {
      failures.push(`Forbidden path present: ${relativePath}`);
    }
  }

  const files = listFiles(targetDir);
  for (const filePath of files) {
    const relativePath = path.relative(targetDir, filePath).replaceAll(path.sep, "/");
    const stat = fs.statSync(filePath);
    if (stat.size > 1_000_000) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    for (const { label, pattern } of forbiddenContentPatterns) {
      if (pattern.test(content)) {
        failures.push(`Forbidden content (${label}) in ${relativePath}`);
      }
    }
  }

  return failures;
}

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function isForceDeleteSafe(target) {
  const relative = path.relative(repoRoot, target);
  const insideRepo = !relative.startsWith("..") && !path.isAbsolute(relative);
  const normalized = target.replaceAll(path.sep, "/");
  return insideRepo && normalized.includes("/.tmp/");
}

function main() {
  if (args.has("--help")) {
    console.log("Usage: node scripts/repo/export-scratchnode-live-public.mjs --out .tmp/scratchnode-live-public-export [--force] [--dry-run]");
    return;
  }

  if (dryRun) {
    console.log(`Would export ScratchNode public repo to ${targetDir}`);
    console.log(copyEntries.map(([source, destination]) => `${source} -> ${destination}`).join("\n"));
    return;
  }

  if (fs.existsSync(targetDir)) {
    if (!force) {
      throw new Error(`Target exists: ${targetDir}. Re-run with --force to replace it.`);
    }
    if (!isForceDeleteSafe(targetDir)) {
      throw new Error(`Refusing to --force delete outside repo .tmp/: ${targetDir}`);
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const copiedEntries = copyAllowlistedEntries();
  writeGeneratedFiles(copiedEntries);

  const failures = scanOutputForSafetyIssues();
  if (failures.length) {
    console.error("Public export failed safety scan:");
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exit(1);
  }

  console.log(`Created ScratchNode public export at ${targetDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
