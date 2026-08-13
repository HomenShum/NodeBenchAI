# STACK — what this is built out of, and what each piece is for

Versions are read from `package.json`, `.nvmrc` and `tsconfig.app.json` at the
commit that carries this file. If a number here disagrees with those files,
those files are right.

## Runtime and language

| Thing | Version | Why it is here |
|---|---|---|
| Node | 22 (`.nvmrc`) | Runs the build, the tests, the local voice worker and every `scripts/*.mjs`. |
| TypeScript | 5.9.3 | The whole repo. Strict, but `noImplicitAny` is **off** — see CONVENTIONS.md. |
| npm | 11.5.2 (`packageManager`) | Single lockfile, workspaces are not used; `packages/*` are installed by `npm --prefix`. |

## The browser application

| Thing | Version | Why it is here |
|---|---|---|
| React | 19.1.1 | The UI. |
| Vite | 8.x | Dev server and production build. Entry is `apps/web/index.html` → `apps/web/src/main.tsx`. |
| react-router-dom | 7.x | Provides `BrowserRouter`, `useLocation`, `useNavigate` — **but no `<Route>` elements exist in this repo**. `apps/web/src/App.tsx` is a hand-written if-ladder over `location.pathname`. |
| Tailwind CSS | 3.x | Utility styling, plus three hand-written stylesheets scoped to the chat surface (`features/redesign/tokens.css`, `primitives.css`, `agent-workspace.css`). |
| Radix UI + `class-variance-authority` + `tailwind-merge` | — | The primitive layer under `apps/web/src/components/ui`. |
| `vite-plugin-pwa` / Workbox | 1.2 / 7.4 | Ships a service worker. It is deliberately disabled in dev and under Playwright — see `main.tsx` lines 254-268, which explains why. |

## The backend

| Thing | Version | Why it is here |
|---|---|---|
| Convex | 1.31.3 | **The whole backend.** Database, query/mutation/action runtime, scheduler, file storage, and the websocket that pushes query results to the browser. There is no Express server, no REST API and no SSE endpoint on the product path. |
| `@convex-dev/auth` | 0.0.80 | Sign-in. Anonymous sessions exist and are deliberately *not* allowed to start paid runs. |
| Convex components | `agent`, `workflow`, `workpool`, `rag`, `presence`, `prosemirror-sync`, `persistent-text-streaming`, `polar`, `twilio`, `oss-stats` | Registered in `backend/convex/convex.config.ts`. Twilio registers only when its three env vars are present. |

Convex is worth one extra sentence because it changes how you read everything
else: a Convex **query** is a subscription, so the frontend gets live updates by
calling `useQuery` and nothing else. When you go looking for the streaming
transport, there isn't one.

## Models and external intelligence

| Thing | Where |
|---|---|
| Google Gemini (`streamGenerateContent`, `google_search` grounding) | The canonical chat path, `backend/convex/domains/redesign/chatRuns.ts:2077`. Needs `GEMINI_API_KEY` **in the Convex deployment**, not in `.env.local`. |
| `ai` (Vercel AI SDK) + `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@openrouter/ai-sdk-provider` | Other agent surfaces (`apps/web/src/features/agents`, `workers/node`). Not used by the canonical chat path. |
| `@modelcontextprotocol/sdk` | The MCP servers in `packages/` — see INTEGRATIONS.md. |

## Test and verification tooling

| Thing | Version | Why it is here |
|---|---|---|
| Vitest | 3.2.6 | Unit and contract tests, run in **four separate segments** by `scripts/testing/runSegmentedVitest.mjs` because one flat run exceeds the time budget. |
| Playwright | 1.59.1 | Browser checks under `evals/e2e/`. |
| Storybook | 9.1.10 | Already present. Do not add another documentation surface; use this one or none. |
| ESLint 9 + typescript-eslint | — | `npm run lint:eslint`. Note `npm run lint` is something else entirely: it runs two typechecks, `convex dev --once`, and a full build. |

## Deploy targets

Vercel (`vercel.json`, `api/*.js` serverless functions, `middleware.ts` at the
edge), Convex Cloud for the backend, Render/Railway manifests for the MCP
services, and Capacitor for the mobile shell. None of these are needed to read
or test the code.
