/**
 * NemoClaw Chat Gateway
 *
 * WebSocket + HTTP chat server accessible from phone via tunnel.
 * Provides a simple chat interface that routes to the NemoClaw agent.
 * Sends screenshots/video back to the user as base64 in messages.
 */

import express, { Router } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { NemoClawAgent } from './agentRunner.js';
import { takeScreenshot } from './desktopControl.js';
import path from 'path';
import fs from 'fs/promises';
import http from 'http';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[]; // base64 encoded
  timestamp: number;
  metadata?: {
    intent?: string;
    toolsUsed?: string[];
    turnCount?: number;
  };
}

interface ChatSession {
  id: string;
  agent: NemoClawAgent;
  messages: ChatMessage[];
  createdAt: number;
  lastActivityAt: number;
}

const MAX_SESSIONS = 10;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const MAX_AUTH_FAILURES = 10; // Rate limit auth failures
const AUTH_WINDOW_MS = 60 * 1000; // per minute
const sessions = new Map<string, ChatSession>();
const authFailures = new Map<string, { count: number; windowStart: number }>();

/**
 * Validate bearer token against NEMOCLAW_TOKEN env var.
 * If NEMOCLAW_TOKEN is not set, auth is disabled (local-only mode).
 */
function validateToken(token: string | undefined, clientIp: string): { valid: boolean; reason?: string } {
  const expectedToken = process.env.NEMOCLAW_TOKEN;

  // No token configured = local-only mode (no auth required)
  if (!expectedToken) return { valid: true };

  // Rate limit auth failures by IP
  const now = Date.now();
  const failures = authFailures.get(clientIp);
  if (failures) {
    if (now - failures.windowStart > AUTH_WINDOW_MS) {
      // Reset window
      authFailures.set(clientIp, { count: 0, windowStart: now });
    } else if (failures.count >= MAX_AUTH_FAILURES) {
      return { valid: false, reason: 'Too many auth failures. Try again later.' };
    }
  }

  if (!token || token !== expectedToken) {
    // Track failure
    const entry = authFailures.get(clientIp) || { count: 0, windowStart: now };
    entry.count++;
    authFailures.set(clientIp, entry);

    // Evict old entries (bounded memory)
    if (authFailures.size > 200) {
      const oldest = [...authFailures.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart)[0];
      if (oldest) authFailures.delete(oldest[0]);
    }

    return { valid: false, reason: 'Invalid token' };
  }

  return { valid: true };
}

function extractToken(req: { headers: Record<string, any>; url?: string }): string | undefined {
  // Bearer token from Authorization header
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader && typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1];
  }
  // Token from query param (for WebSocket connections from browser)
  if (req.url) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (token) return token;
    } catch {}
  }
  return undefined;
}

function getClientIp(req: { headers: Record<string, any>; socket?: { remoteAddress?: string } }): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

function generateSessionId(): string {
  return `nemo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSession(workspacePath: string): ChatSession {
  // Evict oldest if at capacity
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt)[0];
    if (oldest) sessions.delete(oldest[0]);
  }

  const session: ChatSession = {
    id: generateSessionId(),
    agent: new NemoClawAgent({ workspacePath }),
    messages: [],
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  sessions.set(session.id, session);
  return session;
}

/**
 * Create Express router for NemoClaw chat API
 */
export function createChatRouter(workspacePath: string): Router {
  const router = Router();

  // Auth middleware — all routes except health require valid token
  router.use((req, res, next) => {
    if (req.path === '/health') return next(); // Health is public
    const token = extractToken(req);
    const clientIp = getClientIp(req);
    const auth = validateToken(token, clientIp);
    if (!auth.valid) {
      res.status(401).json({ error: auth.reason || 'Unauthorized' });
      return;
    }
    next();
  });

  // Health check
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      sessions: sessions.size,
      uptime: process.uptime(),
    });
  });

  // Create new chat session
  router.post('/session', (_req, res) => {
    const session = createSession(workspacePath);
    res.json({
      sessionId: session.id,
      message: 'NemoClaw session created. Send messages to /nemoclaw/chat.',
    });
  });

  // Send a chat message
  router.post('/chat', async (req, res) => {
    const { sessionId, message, images } = req.body;

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // Get or create session
    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      session = createSession(workspacePath);
    }
    session.lastActivityAt = Date.now();

    // Store user message
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: message,
      images,
      timestamp: Date.now(),
    };
    session.messages.push(userMsg);

    try {
      // Run agent
      const response = await session.agent.run(message, images);

      // Store assistant message
      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: response.text,
        images: response.images,
        timestamp: Date.now(),
        metadata: {
          intent: response.intent,
          toolsUsed: response.toolsUsed,
          turnCount: response.turnCount,
        },
      };
      session.messages.push(assistantMsg);

      res.json({
        sessionId: session.id,
        message: assistantMsg,
      });
    } catch (e: any) {
      res.status(500).json({
        sessionId: session.id,
        error: e.message,
      });
    }
  });

  // Get current screenshot (quick look at screen)
  router.get('/screen', async (_req, res) => {
    try {
      const screenshot = await takeScreenshot();
      res.json({
        width: screenshot.width,
        height: screenshot.height,
        image: screenshot.base64,
        timestamp: screenshot.timestamp,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get chat history
  router.get('/history/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ messages: session.messages });
  });

  // List sessions
  router.get('/sessions', (_req, res) => {
    const sessionList = [...sessions.values()].map(s => ({
      id: s.id,
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
    }));
    res.json({ sessions: sessionList });
  });

  return router;
}

/**
 * Create WebSocket handler for real-time chat
 * Attach to existing HTTP server
 */
export function createChatWebSocket(
  server: http.Server,
  workspacePath: string
): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/nemoclaw/ws',
  });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    // Auth check for WebSocket
    const token = extractToken({ headers: req.headers as Record<string, any>, url: req.url });
    const clientIp = getClientIp({ headers: req.headers as Record<string, any>, socket: req.socket });
    const auth = validateToken(token, clientIp);
    if (!auth.valid) {
      ws.close(4001, auth.reason || 'Unauthorized');
      return;
    }

    const session = createSession(workspacePath);

    // Send session info
    ws.send(JSON.stringify({
      type: 'session_created',
      sessionId: session.id,
      message: 'Connected to NemoClaw. Send messages as JSON: { "type": "chat", "message": "..." }',
    }));

    ws.on('message', async (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString());
        session.lastActivityAt = Date.now();

        if (parsed.type === 'chat') {
          // Send typing indicator
          ws.send(JSON.stringify({ type: 'typing', sessionId: session.id }));

          // Run agent
          const response = await session.agent.run(parsed.message, parsed.images);

          // Send response
          ws.send(JSON.stringify({
            type: 'response',
            sessionId: session.id,
            message: {
              content: response.text,
              images: response.images,
              metadata: {
                intent: response.intent,
                toolsUsed: response.toolsUsed,
                turnCount: response.turnCount,
              },
            },
          }));
        } else if (parsed.type === 'screenshot') {
          const screenshot = await takeScreenshot();
          ws.send(JSON.stringify({
            type: 'screenshot',
            image: screenshot.base64,
            width: screenshot.width,
            height: screenshot.height,
          }));
        } else if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e: any) {
        ws.send(JSON.stringify({
          type: 'error',
          error: e.message,
        }));
      }
    });

    ws.on('close', () => {
      // Keep session alive for reconnection
      // Will be cleaned up by timeout
    });

    // Heartbeat
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
      } else {
        clearInterval(heartbeat);
      }
    }, 30000);
  });

  return wss;
}

/**
 * Mobile-friendly chat HTML page
 * Served at /nemoclaw for direct browser access from phone
 */
export function getChatHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>NemoClaw</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { --bg: #151413; --surface: #1e1d1c; --border: rgba(255,255,255,0.06); --text: #e8e4de; --muted: #8a8580; --accent: #d97757; }
    body { background: var(--bg); color: var(--text); font-family: 'SF Pro', -apple-system, system-ui, sans-serif; height: 100dvh; display: flex; flex-direction: column; }
    .header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; backdrop-filter: blur(20px); background: rgba(21,20,19,0.9); position: sticky; top: 0; z-index: 10; }
    .header h1 { font-size: 17px; font-weight: 600; }
    .header .status { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
    .header .screen-btn { margin-left: auto; padding: 6px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--muted); font-size: 13px; cursor: pointer; }
    .messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; -webkit-overflow-scrolling: touch; }
    .msg { max-width: 85%; padding: 10px 14px; border-radius: 16px; font-size: 15px; line-height: 1.4; word-break: break-word; }
    .msg.user { align-self: flex-end; background: var(--accent); color: white; border-bottom-right-radius: 4px; }
    .msg.assistant { align-self: flex-start; background: var(--surface); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
    .msg img { max-width: 100%; border-radius: 8px; margin-top: 8px; }
    .msg .meta { font-size: 11px; color: var(--muted); margin-top: 6px; }
    .typing { align-self: flex-start; color: var(--muted); font-size: 14px; padding: 8px 14px; }
    .input-bar { padding: 8px 12px; border-top: 1px solid var(--border); display: flex; gap: 8px; background: var(--bg); position: sticky; bottom: 0; padding-bottom: env(safe-area-inset-bottom, 8px); }
    .input-bar textarea { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 10px 16px; color: var(--text); font-size: 16px; resize: none; outline: none; font-family: inherit; max-height: 120px; }
    .input-bar textarea::placeholder { color: var(--muted); }
    .input-bar button { width: 40px; height: 40px; border-radius: 50%; background: var(--accent); border: none; color: white; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .input-bar button:disabled { opacity: 0.5; }
    .screenshot-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 100; display: none; align-items: center; justify-content: center; padding: 20px; }
    .screenshot-modal.active { display: flex; }
    .screenshot-modal img { max-width: 100%; max-height: 90vh; border-radius: 12px; }
    .screenshot-modal .close { position: absolute; top: 16px; right: 16px; width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,0.1); border: none; color: white; font-size: 20px; cursor: pointer; }
    pre { background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 8px; overflow-x: auto; font-size: 13px; margin-top: 6px; font-family: 'JetBrains Mono', monospace; }
    code { font-family: 'JetBrains Mono', monospace; font-size: 13px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="status"></div>
    <h1>NemoClaw</h1>
    <button class="screen-btn" onclick="requestScreenshot()">Screen</button>
  </div>

  <div class="messages" id="messages"></div>

  <div class="screenshot-modal" id="screenshotModal" onclick="this.classList.remove('active')">
    <button class="close">&times;</button>
    <img id="screenshotImg" />
  </div>

  <div class="input-bar">
    <textarea id="input" placeholder="Tell NemoClaw what to do..." rows="1"
      oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"
      onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage()}"></textarea>
    <button onclick="sendMessage()" id="sendBtn">&#x2191;</button>
  </div>

  <script>
    let ws, sessionId, reconnectTimer;
    const messagesEl = document.getElementById('messages');

    // Extract token from URL param or localStorage
    const urlToken = new URLSearchParams(location.search).get('token');
    if (urlToken) { localStorage.setItem('nemoclaw_token', urlToken); history.replaceState({}, '', location.pathname); }
    const token = localStorage.getItem('nemoclaw_token') || '';

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host + '/nemoclaw/ws?token=' + encodeURIComponent(token));

      ws.onopen = () => {
        document.querySelector('.status').style.background = '#4ade80';
        if (reconnectTimer) clearInterval(reconnectTimer);
      };

      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'session_created') {
          sessionId = data.sessionId;
        } else if (data.type === 'response') {
          removeTyping();
          addMessage('assistant', data.message.content, data.message.images, data.message.metadata);
        } else if (data.type === 'typing') {
          showTyping();
        } else if (data.type === 'screenshot') {
          showScreenshot(data.image);
        } else if (data.type === 'error') {
          removeTyping();
          addMessage('assistant', 'Error: ' + data.error);
        }
      };

      ws.onclose = () => {
        document.querySelector('.status').style.background = '#ef4444';
        reconnectTimer = setInterval(() => {
          try { connect(); } catch {}
        }, 3000);
      };
    }

    function sendMessage() {
      const input = document.getElementById('input');
      const text = input.value.trim();
      if (!text || !ws || ws.readyState !== 1) return;

      addMessage('user', text);
      ws.send(JSON.stringify({ type: 'chat', message: text }));
      input.value = '';
      input.style.height = 'auto';
      document.getElementById('sendBtn').disabled = true;
      setTimeout(() => { document.getElementById('sendBtn').disabled = false; }, 1000);
    }

    function requestScreenshot() {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'screenshot' }));
      }
    }

    function showScreenshot(base64) {
      document.getElementById('screenshotImg').src = 'data:image/png;base64,' + base64;
      document.getElementById('screenshotModal').classList.add('active');
    }

    function addMessage(role, content, images, metadata) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;

      // Simple markdown-like rendering
      let html = content
        .replace(/\`\`\`(\\w+)?\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\n/g, '<br>');

      div.innerHTML = html;

      if (images && images.length) {
        images.forEach(img => {
          const imgEl = document.createElement('img');
          imgEl.src = 'data:image/png;base64,' + img;
          imgEl.onclick = () => showScreenshot(img);
          div.appendChild(imgEl);
        });
      }

      if (metadata) {
        const meta = document.createElement('div');
        meta.className = 'meta';
        const parts = [];
        if (metadata.intent) parts.push(metadata.intent);
        if (metadata.toolsUsed?.length) parts.push(metadata.toolsUsed.length + ' tools');
        if (metadata.turnCount) parts.push(metadata.turnCount + ' turns');
        meta.textContent = parts.join(' · ');
        div.appendChild(meta);
      }

      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() {
      if (!document.querySelector('.typing')) {
        const div = document.createElement('div');
        div.className = 'typing';
        div.textContent = 'NemoClaw is working...';
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }

    function removeTyping() {
      document.querySelectorAll('.typing').forEach(el => el.remove());
    }

    connect();
  </script>
</body>
</html>`;
}
