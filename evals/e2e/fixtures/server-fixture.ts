/**
 * Server fixture for Playwright e2e tests.
 *
 * Spawns the Express server (server/index.ts) as a child process,
 * waits for health check, and tears down on completion.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const SERVER_PORT = 3101; // Use non-default port to avoid conflicts with dev server
const HEALTH_URL = `http://localhost:${SERVER_PORT}/health`;
const MAX_WAIT_MS = 30_000;
const POLL_MS = 500;

let serverProcess: ChildProcess | null = null;

export function getServerUrl(): string {
  return `http://localhost:${SERVER_PORT}`;
}

export function getApiUrl(path: string): string {
  return `${getServerUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

async function waitForHealth(): Promise<boolean> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
}

export async function startServer(): Promise<void> {
  if (serverProcess) return;

  const serverPath = resolve(__dirname, "../../../server/index.ts");
  serverProcess = spawn("npx", ["tsx", serverPath, "--port", String(SERVER_PORT)], {
    cwd: resolve(__dirname, "../../.."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      NODEBENCH_DEV_KEY: "test-dev-key-e2e",
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });

  // Log server output for debugging
  serverProcess.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) process.stdout.write(`[server] ${line}\n`);
  });
  serverProcess.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) process.stderr.write(`[server:err] ${line}\n`);
  });

  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`[server] exited with code ${code}`);
    }
    serverProcess = null;
  });

  const healthy = await waitForHealth();
  if (!healthy) {
    stopServer();
    throw new Error(`Server failed to start within ${MAX_WAIT_MS}ms`);
  }

  console.log(`[server-fixture] Server healthy on port ${SERVER_PORT}`);
}

export function stopServer(): void {
  if (!serverProcess) return;
  serverProcess.kill("SIGTERM");
  serverProcess = null;
  console.log("[server-fixture] Server stopped");
}
