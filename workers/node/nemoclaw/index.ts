/**
 * NemoClaw — Local Autonomous Agent Infrastructure
 *
 * Chat from your phone → control your laptop.
 * Screenshot, click, type, scroll, launch apps, read/write code,
 * record video, and more — all via a mobile-friendly chat interface.
 *
 * Architecture:
 *   Phone (browser) ──WebSocket──→ Express Server ──→ NemoClaw Agent
 *                                                        ├── Desktop Control (pyautogui)
 *                                                        ├── Video Capture (ffmpeg)
 *                                                        ├── Process Control (apps, browser)
 *                                                        └── Codebase Context (files, git)
 *
 * Usage:
 *   npx tsx server/nemoclaw/index.ts           # Standalone mode
 *   # Or integrated into server/index.ts       # Alongside MCP gateway
 */

import express from 'express';
import http from 'http';
import cors from 'cors';
import { createChatRouter, createChatWebSocket, getChatHtml } from './chatGateway.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export { createChatRouter, createChatWebSocket, getChatHtml } from './chatGateway.js';
export { NemoClawAgent } from './agentRunner.js';
export { desktopTools } from './desktopControl.js';
export { videoTools } from './videoCapture.js';
export { processTools } from './processControl.js';
export { codebaseTools } from './codebaseContext.js';

const DEFAULT_PORT = 3101;

/**
 * Start NemoClaw as a standalone server
 */
export async function startNemoClawServer(options: {
  port?: number;
  workspacePath?: string;
  enableTunnel?: boolean;
} = {}): Promise<{
  server: http.Server;
  port: number;
  tunnelUrl?: string;
}> {
  const port = options.port || DEFAULT_PORT;
  const workspacePath = options.workspacePath || process.cwd();

  const app = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '10mb' })); // Allow large image payloads

  // Serve mobile chat UI
  app.get('/nemoclaw', (_req, res) => {
    res.type('html').send(getChatHtml());
  });

  // Mount chat API
  app.use('/nemoclaw', createChatRouter(workspacePath));

  // Root redirect
  app.get('/', (_req, res) => {
    res.redirect('/nemoclaw');
  });

  // Health
  app.get('/health', (_req, res) => {
    res.json({ service: 'nemoclaw', status: 'ok', uptime: process.uptime() });
  });

  const server = http.createServer(app);

  // Mount WebSocket
  createChatWebSocket(server, workspacePath);

  // Start server
  await new Promise<void>((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      console.log(`\n  NemoClaw running on http://localhost:${port}/nemoclaw`);
      console.log(`  WebSocket: ws://localhost:${port}/nemoclaw/ws`);
      console.log(`  Screenshot: GET http://localhost:${port}/nemoclaw/screen\n`);
      resolve();
    });
  });

  // Optional: start tunnel for phone access
  let tunnelUrl: string | undefined;
  if (options.enableTunnel) {
    tunnelUrl = await startTunnel(port);
  }

  return { server, port, tunnelUrl };
}

/**
 * Start a tunnel for remote access (phone)
 * Tries cloudflared first, falls back to localtunnel
 */
async function startTunnel(port: number): Promise<string | undefined> {
  // Try cloudflared
  try {
    const { stdout } = await execAsync(`cloudflared tunnel --url http://localhost:${port} 2>&1 &`, {
      timeout: 15000,
    });
    const match = stdout.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      console.log(`  Tunnel (cloudflared): ${match[0]}/nemoclaw`);
      return match[0];
    }
  } catch { /* cloudflared not available */ }

  // Try localtunnel
  try {
    const { stdout } = await execAsync(`npx localtunnel --port ${port}`, {
      timeout: 15000,
    });
    const match = stdout.match(/https:\/\/[a-z0-9-]+\.loca\.lt/);
    if (match) {
      console.log(`  Tunnel (localtunnel): ${match[0]}/nemoclaw`);
      return match[0];
    }
  } catch { /* localtunnel not available */ }

  console.log('  Tunnel: not available (install cloudflared or use npx localtunnel)');
  console.log(`  Local network: http://${getLocalIP()}:${port}/nemoclaw`);
  return undefined;
}

/**
 * Get local network IP for same-wifi phone access
 */
function getLocalIP(): string {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

/**
 * Mount NemoClaw into an existing Express app + HTTP server
 * Use this when integrating with server/index.ts
 */
export function mountNemoClaw(
  app: express.Application,
  server: http.Server,
  workspacePath: string
): void {
  // Serve mobile chat UI
  app.get('/nemoclaw', (_req, res) => {
    res.type('html').send(getChatHtml());
  });

  // Mount chat API
  app.use('/nemoclaw', createChatRouter(workspacePath));

  // Mount WebSocket
  createChatWebSocket(server, workspacePath);

  console.log('  NemoClaw mounted at /nemoclaw');
}

// Run standalone if executed directly
const isMainModule = process.argv[1]?.includes('nemoclaw');
if (isMainModule) {
  const port = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || String(DEFAULT_PORT));
  const enableTunnel = process.argv.includes('--tunnel');
  const workspacePath = process.argv.find(a => a.startsWith('--workspace='))?.split('=')[1] || process.cwd();

  startNemoClawServer({ port, workspacePath, enableTunnel }).catch(console.error);
}
