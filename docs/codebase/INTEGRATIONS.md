# INTEGRATIONS — what this app talks to, and what breaks when it cannot

Ordered by how much of the product stops working without it.

## 1. Convex — the backend, not "a" backend

**What it is.** A hosted platform that provides the database, the function
runtime (queries, mutations, actions), the scheduler, file storage, and the
websocket that pushes query results to every subscribed browser.

**Where it is wired.** `apps/web/src/main.tsx:156` builds the client;
`backend/convex/convex.config.ts` registers Convex components;
`backend/convex/schema.ts` defines the tables.

**Configuration.** `VITE_CONVEX_URL` in `.env.local` for the browser;
`CONVEX_DEPLOY_KEY` for deploys. Server-side secrets (see below) live in the
**Convex deployment's** environment, set with `npx convex env set`, not in
`.env.local`.

**What breaks without it.** Everything. `/redesign/chat` renders the
"Convex backend not configured" card and no product route works. This repo
ships no local or fixture backend for the product surfaces — the only
Convex-free thing you can run is the standalone `demo/graph-rail/index.html`.

**The trap.** `.env.example` ships
`VITE_CONVEX_URL=https://your-project.convex.cloud`. That is a placeholder, not a
deployment. It is rejected on purpose by `apps/web/src/lib/convexUrl.ts`, which
matches Convex's own deployment-name rule (`[a-z]+-[a-z]+-[0-9]+`) rather than
inventing a heuristic. If you loosen that check, you re-create a defect where
the app mounts against a dead socket and shows no remedy.

## 2. Google Gemini — the model and the only tool

**What it is.** The model behind every answer, called directly over HTTPS —
no SDK — at `generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent?alt=sse`.
Google's built-in `google_search` grounding is switched on per run and is the
**only** tool on this path.

**Where it is wired.** `backend/convex/domains/redesign/chatRuns.ts:2077`.

**Configuration.** `GEMINI_API_KEY`, set **in the Convex deployment**. Putting it
in `.env.local` does nothing for chat, because the call is made server-side.

**What breaks without it.** `runStreamingChat` throws
`"GEMINI_API_KEY not configured in Convex env"` on its first line, the run is
marked `status: "error"`, and the user sees that sentence. The app still loads.

**Failure handling.** 45-second `AbortController` timeout, non-2xx surfaces the
status plus the first 200 characters of the body, and the read loop re-checks
cancellation on every chunk.

## 3. Convex Auth — identity, and the anonymous-account rule

**Where it is wired.** `@convex-dev/auth` via `<ConvexAuthProvider>` in
`main.tsx`; `getAuthUserId` in `requirePaidChatUserId`
(`chatRuns.ts:159`).

**The rule worth knowing.** Anonymous sessions are supported and can read public
artefacts, but **cannot start a paid run**. The check is "does this user have at
least one non-anonymous `authAccounts` row", not "is there a session".

## 4. Everything else — optional, and scoped

| Integration | Env | What it powers | Without it |
|---|---|---|---|
| Linkup | `LINKUP_API_KEY` | Fallback web search when Gemini grounding is not used | That fallback is skipped |
| OpenAI / Anthropic / OpenRouter | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Non-canonical agent surfaces under `features/agents` and `workers/node` | Those surfaces degrade; chat is unaffected |
| ElevenLabs | `ELEVENLABS_API_KEY` | Voice worker (`workers/node`) | `npm run dev:voice` fails; nothing else |
| Polar | Convex component | Billing | Billing screens degrade |
| Twilio | 3 vars | SMS. **Registered only when all three are present** (`convex.config.ts`) | Component is simply not registered |
| Resend | — | Transactional email | Email sending fails |
| ntfy / Notion | `*_NTFY_URL`, `NOTION_*` | Operational alerting and a daily ops dashboard | Silent no-ops by design |
| Vercel | `vercel.json`, `api/*.js`, `middleware.ts` | Hosting, serverless functions, edge middleware | Only affects deployment |

## 5. Outbound MCP — this repo is also an MCP server

Separate from the app: `packages/` publishes several Model Context Protocol
servers (`nodebench-mcp`, `nodebench-mcp-power`, `nodebench-mcp-admin`,
`convex-mcp-nodebench` with 36 tools, `openclaw-mcp-nodebench`). A hosted
instance runs at `NODEBENCH_MCP_URL`.

These are products in their own right with their own tests
(`npm run test:run:mcp-local`, `test:run:convex-mcp`, `test:run:openclaw-mcp`).
They are **not** in the `/redesign/chat` request path — do not read them to
understand how a chat answer is produced.

## The one-line rule for secrets

Browser-visible config is `VITE_*` in `.env.local`. Everything the server uses
(`GEMINI_API_KEY`, provider keys, Twilio) belongs in the Convex deployment
environment. Putting a server key in `.env.local` will not make chat work, and
prefixing it `VITE_` would ship it to every visitor.
