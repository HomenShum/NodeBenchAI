FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS base

WORKDIR /app

# Match the declared package manager and share the public install policy.
RUN npm install --global npm@11.5.2 --no-audit --no-fund
COPY package.json package-lock.json .npmrc ./

FROM base AS build

# The compiler and TypeScript source runner are development dependencies.
RUN npm ci

# Compile the standard-tree worker and every source tree reached by its imports.
COPY workers/node/ workers/node/
COPY packages/ packages/
COPY backend/convex/ backend/convex/
COPY apps/web/src/ apps/web/src/
COPY shared/ shared/
COPY scripts/ui/runDogfoodGeminiQa.mjs scripts/ui/runDogfoodGeminiQa.mjs
COPY tsconfig.json ./
RUN npm run build:voice

FROM base AS runtime
RUN npm ci --omit=dev

COPY --from=build /app/dist/ dist/
# Convex generates this runtime shim as JavaScript, so tsc type-checks against
# its declaration file but does not emit the implementation into dist.
COPY --from=build /app/backend/convex/_generated/api.js dist/backend/convex/_generated/api.js
COPY packages/mcp-local/package.json dist/packages/mcp-local/package.json

# Keep the file-backed MCP distribution checks honest without copying the
# package wholesale (it contains a tracked registry credential file).
COPY --from=build /app/packages/mcp-local/package.json packages/mcp-local/package.json
COPY --from=build /app/packages/mcp-local/scripts/install.sh packages/mcp-local/scripts/install.sh
COPY --from=build /app/packages/mcp-local/smithery.yaml packages/mcp-local/smithery.yaml
COPY --from=build /app/packages/mcp-local/.claude/plugin.json packages/mcp-local/.claude/plugin.json
COPY --from=build /app/packages/mcp-local/.cursor/plugin.json packages/mcp-local/.cursor/plugin.json
COPY --from=build /app/packages/mcp-local/README.md packages/mcp-local/README.md
COPY --from=build /app/packages/mcp-local/server.json packages/mcp-local/server.json
COPY --from=build /app/packages/mcp-local/rules/ packages/mcp-local/rules/
COPY --from=build /app/apps/web/src/features/mcp/views/McpLedgerPage.tsx apps/web/src/features/mcp/views/McpLedgerPage.tsx
COPY --from=build /app/scripts/ui/runDogfoodGeminiQa.mjs scripts/ui/runDogfoodGeminiQa.mjs

ENV PORT=3100
ENV NODE_ENV=production
ENV NODEBENCH_MCP_PACKAGE_ROOT=/app/packages/mcp-local
ENV NODEBENCH_REPO_ROOT=/app
EXPOSE 3100

CMD ["node", "dist/workers/node/index.js"]
