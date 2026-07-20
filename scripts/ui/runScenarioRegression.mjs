import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function killProcessTree(proc) {
  if (!proc || typeof proc.pid !== "number") return;
  try {
    proc.kill("SIGTERM");
  } catch {
    // ignore
  }

  const exited = await Promise.race([
    new Promise((resolve) => proc.once("exit", () => resolve(true))),
    sleep(8000).then(() => false),
  ]);
  if (exited) return;

  if (process.platform === "win32") {
    try {
      const taskkill = spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      await Promise.race([new Promise((resolve) => taskkill.on("exit", resolve)), sleep(8000)]);
      return;
    } catch {
      // ignore
    }
  }

  try {
    proc.kill("SIGKILL");
  } catch {
    // ignore
  }
}

async function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.setTimeout(1200, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await sleep(350);
  }
  throw new Error(`Timed out waiting for server at ${host}:${port}`);
}

async function findOpenPort(host, startPort, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const port = startPort + i;
    const ok = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, host, () => srv.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  throw new Error(`No open port found near ${startPort}`);
}

async function main() {
  const host = "127.0.0.1";
  const port = await findOpenPort(host, 5173, 30);
  const baseURL = `http://${host}:${port}`;

  const repoRoot = process.cwd();
  const nodeCmd = process.execPath;
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

  // Ensure preview serves up-to-date public dogfood artifacts (preview reads from dist/).
  // eslint-disable-next-line no-console
  console.log(`Building for preview: node ${viteBin} build`);
  const buildProc = spawn(nodeCmd, [viteBin, "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env },
    windowsHide: true,
    shell: false,
  });
  const buildCode = await new Promise((resolve) => buildProc.on("exit", resolve));
  if (buildCode !== 0) process.exit(Number(buildCode ?? 1));

  // eslint-disable-next-line no-console
  console.log(`Starting preview server: node ${viteBin} preview --host ${host} --port ${port}`);
  const serverProc = spawn(nodeCmd, [viteBin, "preview", "--host", host, "--port", String(port), "--strictPort"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    windowsHide: true,
    shell: false,
  });
  serverProc.stdout.on("data", (buf) => process.stdout.write(String(buf)));
  serverProc.stderr.on("data", (buf) => process.stderr.write(String(buf)));

  try {
    await waitForPort(host, port, 240_000);

    // eslint-disable-next-line no-console
    console.log(`Running scenario regression suite (BASE_URL=${baseURL})...`);
    const scenCmd = `${npxCmd} playwright test evals/e2e/scenario-regression.spec.ts --project=chromium --workers=1`;
    const scen = spawn(scenCmd, {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, BASE_URL: baseURL },
      windowsHide: true,
      shell: true,
    });
    const code = await new Promise((resolve) => scen.on("exit", resolve));
    if (code !== 0) process.exitCode = Number(code ?? 1);
  } finally {
    await killProcessTree(serverProc);
  }
}

await main();
