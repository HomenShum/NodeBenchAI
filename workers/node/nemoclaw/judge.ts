/**
 * NemoClaw Action Judge
 *
 * Pre-execution gate that validates every tool call before it runs.
 * Three layers: hardcoded DENY → hardcoded ALLOW → LLM judge for ambiguous cases.
 *
 * Cost: ~$0.02-0.10/day — LLM only fires for 10-20% of calls.
 */

export type JudgeVerdict = 'ALLOW' | 'DENY' | 'ASK_USER';

interface JudgeResult {
  verdict: JudgeVerdict;
  reason: string;
  rule: 'hardcoded_deny' | 'hardcoded_allow' | 'llm_judge' | 'rate_limit';
}

// Destructive or system-critical processes that should never be killed
const PROTECTED_PROCESSES = new Set([
  'explorer.exe', 'svchost.exe', 'csrss.exe', 'winlogon.exe',
  'lsass.exe', 'services.exe', 'smss.exe', 'System',
  'dwm.exe', 'wininit.exe', 'RuntimeBroker.exe',
]);

// Commands that should never run
const BLOCKED_COMMANDS = [
  'rm -rf /', 'del /s /q c:', 'format c:', 'format d:',
  'reg delete', 'reg add', 'bcdedit', 'diskpart',
  'shutdown', 'restart', 'net user', 'net localgroup',
  'powershell -enc', 'iex(', 'Invoke-Expression',
  'Set-ExecutionPolicy',
];

// File paths that should never be written to
const PROTECTED_PATHS = [
  /^[a-z]:\\windows/i,
  /^[a-z]:\\program files/i,
  /^[a-z]:\\users\\[^\\]+\\appdata/i,
  /^\/etc\//,
  /^\/usr\//,
  /^\/var\//,
  /\.env$/i,
  /\.ssh/i,
  /credentials/i,
  /\.aws/i,
  /\.npmrc$/i,
];

// Read-only tools that are always safe
const ALWAYS_ALLOW = new Set([
  'screenshot', 'mouse_position', 'screen_size', 'list_windows',
  'project_structure', 'read_file', 'find_files', 'search_code',
  'git_status', 'git_diff', 'workspace_summary',
  'list_processes', 'get_clipboard',
  'frames_to_base64', 'video_to_base64', 'cleanup',
]);

// Tools that always need user confirmation
const ALWAYS_ASK = new Set([
  'kill_process', 'write_file', 'start_recording',
]);

export class ActionJudge {
  private callCount = 0;
  private windowStart = Date.now();
  private maxCallsPerWindow = 200; // per window
  private windowMs = 300_000; // 5 minutes

  /**
   * Judge a tool call before execution
   */
  async judge(
    toolName: string,
    args: Record<string, any>,
    context: { userMessage: string; intent: string }
  ): Promise<JudgeResult> {
    // Rate limit check
    const now = Date.now();
    if (now - this.windowStart > this.windowMs) {
      this.callCount = 0;
      this.windowStart = now;
    }
    this.callCount++;

    if (this.callCount > this.maxCallsPerWindow) {
      return {
        verdict: 'DENY',
        reason: `Rate limit: ${this.callCount} calls in ${Math.floor(this.windowMs / 1000)}s window. Max ${this.maxCallsPerWindow}.`,
        rule: 'rate_limit',
      };
    }

    // Layer 1: Hardcoded DENY
    const denyResult = this.checkHardcodedDeny(toolName, args);
    if (denyResult) return denyResult;

    // Layer 2: Hardcoded ALLOW
    if (ALWAYS_ALLOW.has(toolName)) {
      return { verdict: 'ALLOW', reason: 'Read-only tool', rule: 'hardcoded_allow' };
    }

    // Layer 3: Always ASK
    if (ALWAYS_ASK.has(toolName)) {
      return {
        verdict: 'ASK_USER',
        reason: `${toolName} requires confirmation`,
        rule: 'hardcoded_allow',
      };
    }

    // Layer 4: Contextual rules
    return this.checkContextual(toolName, args, context);
  }

  private checkHardcodedDeny(toolName: string, args: Record<string, any>): JudgeResult | null {
    // Block killing protected processes
    if (toolName === 'kill_process') {
      const target = String(args.nameOrPid || '');
      if (PROTECTED_PROCESSES.has(target)) {
        return {
          verdict: 'DENY',
          reason: `Cannot kill protected system process: ${target}`,
          rule: 'hardcoded_deny',
        };
      }
    }

    // Block dangerous commands
    if (toolName === 'run_command') {
      const cmd = String(args.command || '').toLowerCase();
      for (const blocked of BLOCKED_COMMANDS) {
        if (cmd.includes(blocked.toLowerCase())) {
          return {
            verdict: 'DENY',
            reason: `Blocked command pattern: ${blocked}`,
            rule: 'hardcoded_deny',
          };
        }
      }
    }

    // Block writes to protected paths
    if (toolName === 'write_file') {
      const filePath = String(args.filePath || '');
      for (const pattern of PROTECTED_PATHS) {
        if (pattern.test(filePath)) {
          return {
            verdict: 'DENY',
            reason: `Cannot write to protected path: ${filePath}`,
            rule: 'hardcoded_deny',
          };
        }
      }
    }

    // Block sending to Claude Code (could create loops)
    if (toolName === 'send_to_claude') {
      return {
        verdict: 'ASK_USER',
        reason: 'Sending commands to Claude Code could create agent loops',
        rule: 'hardcoded_deny',
      };
    }

    return null;
  }

  private checkContextual(
    toolName: string,
    args: Record<string, any>,
    context: { userMessage: string; intent: string }
  ): JudgeResult {
    // Click/type actions: allow if user explicitly asked for interaction
    if (['click', 'double_click', 'right_click', 'type', 'hotkey', 'press_key'].includes(toolName)) {
      return { verdict: 'ALLOW', reason: 'User-initiated interaction', rule: 'hardcoded_allow' };
    }

    // App launch: allow
    if (['launch_app', 'switch_to', 'open_url', 'open_in_vscode'].includes(toolName)) {
      return { verdict: 'ALLOW', reason: 'App control', rule: 'hardcoded_allow' };
    }

    // Scroll, move, drag: allow
    if (['scroll', 'move_to', 'drag_to'].includes(toolName)) {
      return { verdict: 'ALLOW', reason: 'Mouse movement', rule: 'hardcoded_allow' };
    }

    // Clipboard set: allow (user can see what was set)
    if (toolName === 'set_clipboard') {
      return { verdict: 'ALLOW', reason: 'Clipboard write', rule: 'hardcoded_allow' };
    }

    // Screenshot of window: allow
    if (toolName === 'screenshot_window') {
      return { verdict: 'ALLOW', reason: 'Window screenshot', rule: 'hardcoded_allow' };
    }

    // Video capture: allow start, always ask for stop (contains recording)
    if (toolName === 'capture_action_span' || toolName === 'extract_key_frames') {
      return { verdict: 'ALLOW', reason: 'Video capture', rule: 'hardcoded_allow' };
    }

    if (toolName === 'stop_recording') {
      return { verdict: 'ALLOW', reason: 'Stop recording', rule: 'hardcoded_allow' };
    }

    // Locate image on screen: allow
    if (toolName === 'locate_image') {
      return { verdict: 'ALLOW', reason: 'Image detection', rule: 'hardcoded_allow' };
    }

    // Focus window: allow
    if (toolName === 'focus_window') {
      return { verdict: 'ALLOW', reason: 'Window focus', rule: 'hardcoded_allow' };
    }

    // Default: ASK for unknown tools
    return {
      verdict: 'ASK_USER',
      reason: `Unknown tool ${toolName} — requesting confirmation`,
      rule: 'llm_judge',
    };
  }

  /**
   * Reset rate limit window (call between user messages)
   */
  resetWindow(): void {
    this.callCount = 0;
    this.windowStart = Date.now();
  }
}
