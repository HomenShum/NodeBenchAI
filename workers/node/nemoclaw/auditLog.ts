/**
 * NemoClaw Audit Log
 *
 * Every tool call, every approval, every error — logged to disk.
 * File-based, append-only, rotated daily. No external dependencies.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

interface AuditEntry {
  timestamp: string;
  event: string;
  data: Record<string, any>;
}

const LOG_DIR = path.join(os.homedir(), '.nemoclaw', 'logs');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_LOG_FILES = 30; // Keep 30 days

class AuditLogger {
  private logDir: string;
  private currentStream: fs.WriteStream | null = null;
  private currentDate: string = '';

  constructor(logDir: string = LOG_DIR) {
    this.logDir = logDir;
    this.ensureDir();
  }

  private ensureDir(): void {
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
    } catch { /* exists */ }
  }

  private getDateStr(): string {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  }

  private getStream(): fs.WriteStream {
    const today = this.getDateStr();

    if (today !== this.currentDate || !this.currentStream) {
      if (this.currentStream) {
        this.currentStream.end();
      }
      this.currentDate = today;
      const logPath = path.join(this.logDir, `nemoclaw-${today}.jsonl`);
      this.currentStream = fs.createWriteStream(logPath, { flags: 'a' });

      // Rotate old logs
      this.rotateOldLogs();
    }

    return this.currentStream;
  }

  private rotateOldLogs(): void {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('nemoclaw-') && f.endsWith('.jsonl'))
        .sort();

      while (files.length > MAX_LOG_FILES) {
        const oldest = files.shift();
        if (oldest) {
          fs.unlinkSync(path.join(this.logDir, oldest));
        }
      }
    } catch { /* best effort */ }
  }

  /**
   * Log an event
   */
  log(event: string, data: Record<string, any> = {}): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      event,
      data,
    };

    try {
      const stream = this.getStream();
      stream.write(JSON.stringify(entry) + '\n');
    } catch (e) {
      // Fallback to console
      console.error('[audit] Write failed:', e);
      console.log('[audit]', JSON.stringify(entry));
    }
  }

  /**
   * Log a tool call (before execution)
   */
  logToolCall(toolName: string, args: Record<string, any>, verdict: string): void {
    this.log('tool_call', {
      tool: toolName,
      args: this.sanitizeArgs(args),
      verdict,
    });
  }

  /**
   * Log a tool result (after execution)
   */
  logToolResult(toolName: string, success: boolean, durationMs: number, error?: string): void {
    this.log('tool_result', {
      tool: toolName,
      success,
      durationMs,
      ...(error ? { error } : {}),
    });
  }

  /**
   * Sanitize args to avoid logging sensitive data
   */
  private sanitizeArgs(args: Record<string, any>): Record<string, any> {
    const sanitized = { ...args };

    // Redact potential secrets
    for (const key of Object.keys(sanitized)) {
      const lower = key.toLowerCase();
      if (lower.includes('password') || lower.includes('token') ||
          lower.includes('secret') || lower.includes('key') ||
          lower.includes('credential')) {
        sanitized[key] = '[REDACTED]';
      }

      // Truncate base64 images
      if (typeof sanitized[key] === 'string' && sanitized[key].length > 500) {
        sanitized[key] = sanitized[key].slice(0, 100) + `...[${sanitized[key].length} chars]`;
      }
    }

    return sanitized;
  }

  /**
   * Get today's log entries
   */
  async getTodayLogs(): Promise<AuditEntry[]> {
    const today = this.getDateStr();
    const logPath = path.join(this.logDir, `nemoclaw-${today}.jsonl`);

    try {
      const content = fs.readFileSync(logPath, 'utf-8');
      return content.trim().split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /**
   * Get summary stats for today
   */
  async getStats(): Promise<{
    totalCalls: number;
    toolBreakdown: Record<string, number>;
    denials: number;
    errors: number;
  }> {
    const entries = await this.getTodayLogs();
    const toolBreakdown: Record<string, number> = {};
    let denials = 0;
    let errors = 0;

    for (const entry of entries) {
      if (entry.event === 'tool_call') {
        const tool = entry.data.tool || 'unknown';
        toolBreakdown[tool] = (toolBreakdown[tool] || 0) + 1;
        if (entry.data.verdict === 'DENY') denials++;
      }
      if (entry.event === 'error') errors++;
    }

    return {
      totalCalls: Object.values(toolBreakdown).reduce((a, b) => a + b, 0),
      toolBreakdown,
      denials,
      errors,
    };
  }
}

// Singleton
export const auditLog = new AuditLogger();
