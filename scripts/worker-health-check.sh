#!/usr/bin/env bash
# Smoke-check a nodebench-server worker deployment via /mcp/health.
# Usage: worker-health-check.sh <base-url> [p99-budget-ms]
#
# Checks, in order:
#   1. readiness — /mcp/health answers HTTP 200 within the retry window
#   2. content signal — body carries "p99-latency-ms" and status "healthy"
#      (workers/node/mcpGateway.ts healthHandler)
#   3. SLO — p99-latency-ms at or below the budget (default 30000, from
#      HEALTH_CONFIG.latencyP99Critical in backend/convex/config/autonomousConfig.ts)
set -euo pipefail

BASE_URL="${1:?usage: worker-health-check.sh <base-url> [p99-budget-ms]}"
P99_BUDGET_MS="${2:-30000}"
HEALTH_URL="${BASE_URL%/}/mcp/health"

# 1. Readiness: up to 10 attempts, 15s apart (new Cloud Run revisions cold-start).
BODY=""
for attempt in $(seq 1 10); do
  if BODY=$(curl -fsS --max-time 20 "$HEALTH_URL"); then
    break
  fi
  BODY=""
  echo "Attempt $attempt/10: $HEALTH_URL not ready yet, retrying in 15s..."
  sleep 15
done
if [ -z "$BODY" ]; then
  echo "::error::$HEALTH_URL never returned HTTP 200 after 10 attempts"
  exit 1
fi

# 2. Content signal + 3. SLO gate (node: present locally and on runners).
echo "$BODY" | node -e '
  const budget = Number(process.argv[1]);
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    let h;
    try { h = JSON.parse(raw); } catch { fail("response is not JSON: " + raw); }
    if (h.status !== "healthy" || typeof h["p99-latency-ms"] !== "number") {
      fail("missing content signal (status=healthy + p99-latency-ms). Body: " + raw);
    }
    if (h["p99-latency-ms"] > budget) {
      fail(`p99-latency-ms=${h["p99-latency-ms"]} exceeds budget ${budget}ms`);
    }
    console.log(`OK: healthy, p99-latency-ms=${h["p99-latency-ms"]} (budget ${budget}ms)`);
  });
  function fail(msg) { console.error("::error::" + msg); process.exit(1); }
' "$P99_BUDGET_MS"
