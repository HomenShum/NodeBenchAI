/**
 * NemoClaw Telegram Bot Transport
 *
 * Replaces VPS + SSH tunnel with Telegram as the message channel.
 * Phone → Telegram → Bot (polling from laptop) → NemoClaw Agent → response + screenshots
 *
 * Setup:
 *   1. Message @BotFather on Telegram, create a bot, get token
 *   2. Set NEMOCLAW_TELEGRAM_TOKEN in .env.local
 *   3. Set NEMOCLAW_TELEGRAM_OWNER_ID to your Telegram user ID (message @userinfobot)
 *   4. Start: npx tsx server/nemoclaw/telegramBot.ts
 */

import { NemoClawAgent } from './agentRunner.js';
import { takeScreenshot } from './desktopControl.js';
import { ActionJudge, type JudgeVerdict } from './judge.js';
import { auditLog } from './auditLog.js';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ── Telegram Bot API (minimal, no dependencies) ──────────────────

const TELEGRAM_API = 'https://api.telegram.org/bot';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    photo?: Array<{ file_id: string; width: number; height: number }>;
    caption?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message: { message_id: number; chat: { id: number } };
    data: string;
  };
}

interface TelegramConfig {
  token: string;
  ownerId: number; // Only respond to this user
  workspacePath: string;
}

class TelegramTransport {
  private config: TelegramConfig;
  private agent: NemoClawAgent;
  private judge: ActionJudge;
  private offset = 0;
  private running = false;
  private pendingApprovals = new Map<string, {
    action: string;
    args: any;
    resolve: (approved: boolean) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(config: TelegramConfig) {
    this.config = config;
    this.agent = new NemoClawAgent({
      workspacePath: config.workspacePath,
    });
    this.judge = new ActionJudge();
  }

  private async api(method: string, body?: any): Promise<any> {
    const url = `${TELEGRAM_API}${this.config.token}/${method}`;
    const options: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);
    const data = await res.json() as any;
    if (!data.ok) {
      console.error(`[telegram] API error (${method}):`, data.description);
    }
    return data;
  }

  private async sendMessage(chatId: number, text: string, options?: {
    replyMarkup?: any;
    parseMode?: string;
  }): Promise<any> {
    // Telegram has 4096 char limit — split if needed
    const chunks = this.splitMessage(text, 4000);
    let lastResult;
    for (const chunk of chunks) {
      lastResult = await this.api('sendMessage', {
        chat_id: chatId,
        text: chunk,
        parse_mode: options?.parseMode || 'Markdown',
        reply_markup: options?.replyMarkup,
      });
    }
    return lastResult;
  }

  private splitMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Try to split at newline
      let splitAt = remaining.lastIndexOf('\n', maxLen);
      if (splitAt < maxLen / 2) splitAt = maxLen; // No good newline, hard split
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }
    return chunks;
  }

  private async sendPhoto(chatId: number, imagePath: string, caption?: string): Promise<void> {
    const url = `${TELEGRAM_API}${this.config.token}/sendPhoto`;

    // Compress screenshot to JPEG, max 1280px wide
    const compressedPath = path.join(os.tmpdir(), `nemoclaw_tg_${Date.now()}.jpg`);
    try {
      // Try using sharp for compression
      const sharpModule = await import('sharp').catch(() => null);
      if (sharpModule) {
        await sharpModule.default(imagePath)
          .resize(1280, null, { withoutEnlargement: true })
          .jpeg({ quality: 70 })
          .toFile(compressedPath);
      } else {
        // Fallback: use ffmpeg for conversion
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        await execAsync(
          `ffmpeg -y -i "${imagePath}" -vf "scale=1280:-1" -q:v 5 "${compressedPath}"`,
          { timeout: 10000 }
        );
      }
    } catch {
      // Last resort: send original
      await fs.copyFile(imagePath, compressedPath);
    }

    // Telegram sendPhoto requires multipart/form-data
    const fileBuffer = await fs.readFile(compressedPath);
    const boundary = '----NemoClawBoundary' + Date.now();
    const parts: Buffer[] = [];

    // chat_id field
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`
    ));

    // caption field
    if (caption) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.slice(0, 1024)}\r\n`
      ));
    }

    // photo field
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="screenshot.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
    ));
    parts.push(fileBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    });

    // Cleanup
    await fs.unlink(compressedPath).catch(() => {});
  }

  private isOwner(userId: number): boolean {
    return userId === this.config.ownerId;
  }

  /**
   * Handle incoming message from owner
   */
  private async handleMessage(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg || !msg.text) return;

    // Auth: only respond to owner
    if (!this.isOwner(msg.from.id)) {
      await this.sendMessage(msg.chat.id, 'Unauthorized.');
      auditLog.log('auth_denied', { userId: msg.from.id, username: msg.from.username });
      return;
    }

    const text = msg.text.trim();
    const chatId = msg.chat.id;

    // Built-in commands
    if (text === '/start') {
      await this.sendMessage(chatId,
        '*NemoClaw* is connected to your laptop.\n\n' +
        'Commands:\n' +
        '/screen — Take screenshot\n' +
        '/windows — List open windows\n' +
        '/processes — Top processes by memory\n' +
        '/status — Agent status\n' +
        '/reset — Reset conversation\n\n' +
        'Or just type what you want me to do.'
      );
      return;
    }

    if (text === '/screen') {
      await this.sendMessage(chatId, 'Taking screenshot...');
      const screenshot = await takeScreenshot();
      await this.sendPhoto(chatId, screenshot.path, `${screenshot.width}x${screenshot.height}`);
      auditLog.log('screenshot', { source: 'telegram_command' });
      return;
    }

    if (text === '/windows') {
      const { getOpenWindows } = await import('./desktopControl.js');
      const windows = await getOpenWindows();
      const list = windows.slice(0, 15).map((w, i) => `${i + 1}. ${w.title}`).join('\n');
      await this.sendMessage(chatId, `*Open windows:*\n\`\`\`\n${list}\n\`\`\``, { parseMode: 'Markdown' });
      return;
    }

    if (text === '/processes') {
      const { getRunningProcesses } = await import('./processControl.js');
      const procs = await getRunningProcesses();
      const list = procs.slice(0, 10).map(p => `${p.name} — ${p.memory}MB`).join('\n');
      await this.sendMessage(chatId, `*Top processes:*\n\`\`\`\n${list}\n\`\`\``, { parseMode: 'Markdown' });
      return;
    }

    if (text === '/status') {
      const summary = this.agent.getSummary();
      await this.sendMessage(chatId,
        `*NemoClaw Status*\n` +
        `Messages: ${summary.messageCount}\n` +
        `Workspace: ${this.config.workspacePath}\n` +
        `Uptime: ${Math.floor(process.uptime() / 60)}m`
      );
      return;
    }

    if (text === '/reset') {
      this.agent.reset();
      await this.sendMessage(chatId, 'Conversation reset.');
      return;
    }

    // Regular message — run through agent
    await this.api('sendChatAction', { chat_id: chatId, action: 'typing' });

    try {
      auditLog.log('user_message', { text, source: 'telegram' });

      const response = await this.agent.run(text);

      auditLog.log('agent_response', {
        intent: response.intent,
        toolsUsed: response.toolsUsed,
        turnCount: response.turnCount,
      });

      // Send text response
      if (response.text) {
        const meta = [response.intent, `${response.turnCount} turns`, `${response.toolsUsed.length} tools`]
          .filter(Boolean).join(' · ');

        await this.sendMessage(chatId, response.text + `\n\n_${meta}_`);
      }

      // Send screenshots
      if (response.images?.length) {
        // Send first image (most recent/relevant)
        const imgPath = path.join(os.tmpdir(), `nemoclaw_tg_resp_${Date.now()}.png`);
        const imgBuffer = Buffer.from(response.images[0], 'base64');
        await fs.writeFile(imgPath, imgBuffer);
        await this.sendPhoto(chatId, imgPath);
        await fs.unlink(imgPath).catch(() => {});
      }

    } catch (e: any) {
      auditLog.log('error', { error: e.message, source: 'agent_run' });
      await this.sendMessage(chatId, `Error: ${e.message}`);
    }
  }

  /**
   * Handle callback query (inline button press — for judge approvals)
   */
  private async handleCallback(update: TelegramUpdate): Promise<void> {
    const cb = update.callback_query;
    if (!cb || !this.isOwner(cb.from.id)) return;

    const [action, approvalId] = cb.data.split(':');
    const pending = this.pendingApprovals.get(approvalId);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingApprovals.delete(approvalId);
      pending.resolve(action === 'approve');

      await this.api('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: action === 'approve' ? 'Approved' : 'Denied',
      });

      // Edit the message to show result
      await this.api('editMessageText', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: action === 'approve'
          ? `Approved: ${pending.action}(${JSON.stringify(pending.args).slice(0, 100)})`
          : `Denied: ${pending.action}`,
      });

      auditLog.log('approval_response', {
        action: pending.action,
        approved: action === 'approve',
      });
    } else {
      await this.api('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: 'Expired',
      });
    }
  }

  /**
   * Request approval from user via inline buttons
   */
  async requestApproval(chatId: number, action: string, args: any): Promise<boolean> {
    const approvalId = `ap_${Date.now()}`;

    return new Promise<boolean>((resolve) => {
      // Auto-deny after 60 seconds
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(approvalId);
        resolve(false);
        auditLog.log('approval_timeout', { action, approvalId });
      }, 60000);

      this.pendingApprovals.set(approvalId, { action, args, resolve, timeout });

      this.sendMessage(chatId,
        `*Permission required*\n\n` +
        `Action: \`${action}\`\n` +
        `Args: \`${JSON.stringify(args).slice(0, 200)}\`\n\n` +
        `Allow this action?`,
        {
          replyMarkup: {
            inline_keyboard: [[
              { text: 'Approve', callback_data: `approve:${approvalId}` },
              { text: 'Deny', callback_data: `deny:${approvalId}` },
            ]],
          },
        }
      );
    });
  }

  /**
   * Long-polling loop
   */
  async start(): Promise<void> {
    this.running = true;

    // Verify bot token
    const me = await this.api('getMe');
    if (!me.ok) {
      console.error('[nemoclaw-telegram] Invalid bot token');
      process.exit(1);
    }

    console.log(`\n  NemoClaw Telegram Bot: @${me.result.username}`);
    console.log(`  Owner ID: ${this.config.ownerId}`);
    console.log(`  Workspace: ${this.config.workspacePath}`);
    console.log(`  Waiting for messages...\n`);

    // Notify owner that bot is online
    await this.sendMessage(this.config.ownerId,
      '*NemoClaw is online*\n' +
      `Workspace: \`${this.config.workspacePath}\`\n` +
      `Send /start for commands.`
    );

    while (this.running) {
      try {
        const updates = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 30, // Long poll — Telegram holds connection for 30s
          allowed_updates: ['message', 'callback_query'],
        });

        if (updates.ok && updates.result?.length) {
          for (const update of updates.result) {
            this.offset = update.update_id + 1;

            if (update.callback_query) {
              await this.handleCallback(update);
            } else if (update.message) {
              await this.handleMessage(update);
            }
          }
        }
      } catch (e: any) {
        console.error('[nemoclaw-telegram] Poll error:', e.message);
        // Wait before retry
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  stop(): void {
    this.running = false;
    // Clear pending approvals
    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout);
      pending.resolve(false);
    }
    this.pendingApprovals.clear();
  }
}

export { TelegramTransport };

// ── Standalone entry point ──────────────────────────────────────

const isMainModule = process.argv[1]?.includes('telegramBot');
if (isMainModule) {
  const token = process.env.NEMOCLAW_TELEGRAM_TOKEN;
  const ownerId = parseInt(process.env.NEMOCLAW_TELEGRAM_OWNER_ID || '0');

  if (!token) {
    console.error('Set NEMOCLAW_TELEGRAM_TOKEN (from @BotFather)');
    process.exit(1);
  }
  if (!ownerId) {
    console.error('Set NEMOCLAW_TELEGRAM_OWNER_ID (from @userinfobot)');
    process.exit(1);
  }

  const bot = new TelegramTransport({
    token,
    ownerId,
    workspacePath: process.cwd(),
  });

  process.on('SIGINT', () => { bot.stop(); process.exit(0); });
  process.on('SIGTERM', () => { bot.stop(); process.exit(0); });

  bot.start().catch(console.error);
}
