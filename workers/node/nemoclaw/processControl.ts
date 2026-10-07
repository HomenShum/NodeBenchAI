/**
 * NemoClaw Process Control Module
 *
 * Controls browser, VSCode, Claude Code, and other desktop applications.
 * Acts as a "laptop operator" — launching, switching, and commanding apps.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { focusWindow, hotkey, typeText, takeScreenshot, getOpenWindows } from './desktopControl.js';

const execAsync = promisify(exec);

// Application registry with launch commands
const APP_REGISTRY: Record<string, {
  launch: string;
  windowTitle: string;
  type: 'browser' | 'editor' | 'terminal' | 'media' | 'other';
}> = {
  chrome: {
    launch: 'start chrome',
    windowTitle: 'Google Chrome',
    type: 'browser',
  },
  edge: {
    launch: 'start msedge',
    windowTitle: 'Edge',
    type: 'browser',
  },
  vscode: {
    launch: 'code',
    windowTitle: 'Visual Studio Code',
    type: 'editor',
  },
  'claude-code': {
    launch: 'cmd /c "claude"',
    windowTitle: 'claude',
    type: 'terminal',
  },
  terminal: {
    launch: 'start wt',
    windowTitle: 'Terminal',
    type: 'terminal',
  },
  powershell: {
    launch: 'start powershell',
    windowTitle: 'PowerShell',
    type: 'terminal',
  },
  explorer: {
    launch: 'explorer',
    windowTitle: 'Explorer',
    type: 'other',
  },
  notepad: {
    launch: 'notepad',
    windowTitle: 'Notepad',
    type: 'editor',
  },
};

/**
 * Launch an application
 */
export async function launchApp(
  appName: string,
  args?: string
): Promise<{ success: boolean; app: string; message: string }> {
  const app = APP_REGISTRY[appName.toLowerCase()];
  if (!app) {
    // Try launching directly as a command
    try {
      await execAsync(`start "" "${appName}" ${args || ''}`, { timeout: 10000 });
      return { success: true, app: appName, message: `Launched ${appName}` };
    } catch (e) {
      return { success: false, app: appName, message: `Unknown app: ${appName}` };
    }
  }

  try {
    const cmd = args ? `${app.launch} ${args}` : app.launch;
    await execAsync(cmd, { timeout: 10000 });
    // Wait for window to appear
    await new Promise(r => setTimeout(r, 2000));
    return { success: true, app: appName, message: `Launched ${appName}` };
  } catch (e) {
    return { success: false, app: appName, message: `Failed to launch ${appName}: ${e}` };
  }
}

/**
 * Focus/switch to an application
 */
export async function switchToApp(appName: string): Promise<{ success: boolean; screenshot?: any }> {
  const app = APP_REGISTRY[appName.toLowerCase()];
  const title = app?.windowTitle || appName;

  const success = await focusWindow(title);
  if (success) {
    await new Promise(r => setTimeout(r, 500));
    const screenshot = await takeScreenshot();
    return { success: true, screenshot };
  }

  // Try finding by partial title match
  const windows = await getOpenWindows();
  const match = windows.find(w =>
    w.title.toLowerCase().includes(appName.toLowerCase())
  );

  if (match) {
    const focused = await focusWindow(match.title);
    if (focused) {
      await new Promise(r => setTimeout(r, 500));
      const screenshot = await takeScreenshot();
      return { success: true, screenshot };
    }
  }

  return { success: false };
}

/**
 * Open a URL in the default browser
 */
export async function openUrl(url: string): Promise<{ success: boolean }> {
  try {
    await execAsync(`start "" "${url}"`, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 3000));
    return { success: true };
  } catch {
    return { success: false };
  }
}

/**
 * Open a file in VSCode
 */
export async function openInVSCode(filePath: string): Promise<{ success: boolean }> {
  try {
    await execAsync(`code "${filePath}"`, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 2000));
    return { success: true };
  } catch {
    return { success: false };
  }
}

/**
 * Open a terminal and run a command
 */
export async function runInTerminal(command: string): Promise<{ success: boolean; output?: string }> {
  try {
    const { stdout } = await execAsync(command, { timeout: 60000 });
    return { success: true, output: stdout };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
}

/**
 * Control Claude Code via screen interaction.
 *
 * NemoClaw sees and controls the Claude Code UI directly — screenshot to read,
 * click to focus, type to send prompts, read the output visually.
 * This gives full access to Claude Code's context, memory, rules, tools,
 * and the full codebase intelligence without reimplementing anything.
 *
 * Workflow:
 *   1. Focus or launch Claude Code window
 *   2. Screenshot to see current state
 *   3. Click the input area
 *   4. Type the prompt
 *   5. Press Enter to send
 *   6. Wait + poll screenshots until Claude Code finishes
 *   7. Return final screenshot showing the result
 */
export async function claudeCode(
  prompt: string,
  options: { waitForCompletion?: boolean; maxWaitMs?: number } = {}
): Promise<{ success: boolean; screenshots: any[]; status: string }> {
  const { waitForCompletion = true, maxWaitMs = 120000 } = options;
  const screenshots: any[] = [];

  // Step 1: Focus Claude Code window (or launch it)
  let focused = await focusWindow('claude');
  if (!focused) {
    focused = await focusWindow('Claude');
  }
  if (!focused) {
    // Launch Claude Code
    await launchApp('claude-code');
    await new Promise(r => setTimeout(r, 4000));
    focused = await focusWindow('claude');
  }

  if (!focused) {
    return { success: false, screenshots: [], status: 'Could not find or launch Claude Code window' };
  }

  // Step 2: Take initial screenshot to see state
  await new Promise(r => setTimeout(r, 500));
  const before = await takeScreenshot();
  screenshots.push(before);

  // Step 3: Click the input area (bottom of Claude Code window)
  // Claude Code's input is at the bottom — click near bottom-center
  const inputY = before.height - 80; // ~80px from bottom
  const inputX = Math.floor(before.width / 2);
  await click(inputX, inputY, { evidence: false });
  await new Promise(r => setTimeout(r, 300));

  // Step 4: Type the prompt
  await typeText(prompt, { evidence: false });

  // Step 5: Press Enter to send
  await hotkey('enter');

  // Step 6: Wait for completion by polling screenshots
  if (waitForCompletion) {
    await new Promise(r => setTimeout(r, 3000)); // Initial wait for Claude to start

    const startTime = Date.now();
    let lastScreenshotHash = '';
    let stableCount = 0;

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, 5000)); // Poll every 5s

      const current = await takeScreenshot();

      // Simple change detection: compare base64 length as proxy
      // (if screen hasn't changed much, Claude Code is done)
      const currentHash = String(current.base64.length);
      if (currentHash === lastScreenshotHash) {
        stableCount++;
        if (stableCount >= 2) {
          // Screen stable for 10s — Claude Code likely finished
          screenshots.push(current);
          return { success: true, screenshots, status: 'completed' };
        }
      } else {
        stableCount = 0;
      }
      lastScreenshotHash = currentHash;
    }

    // Timeout — take final screenshot anyway
    const final = await takeScreenshot();
    screenshots.push(final);
    return { success: true, screenshots, status: 'timeout — check screenshot for current state' };
  }

  // Not waiting — just take a quick screenshot after sending
  await new Promise(r => setTimeout(r, 2000));
  const after = await takeScreenshot();
  screenshots.push(after);

  return { success: true, screenshots, status: 'prompt sent — not waiting for completion' };
}

/**
 * Get clipboard content
 */
export async function getClipboard(): Promise<string> {
  try {
    const { stdout } = await execAsync(
      'powershell -command "Get-Clipboard"',
      { timeout: 5000 }
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Set clipboard content
 */
export async function setClipboard(text: string): Promise<void> {
  await execAsync(
    `powershell -command "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`
  );
}

/**
 * Get list of running processes
 */
export async function getRunningProcesses(): Promise<Array<{ name: string; pid: number; memory: number }>> {
  try {
    const { stdout } = await execAsync(
      'powershell -command "Get-Process | Select-Object Name,Id,@{N=\'Memory\';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Sort-Object Memory -Descending | Select-Object -First 20 | ConvertTo-Json"',
      { timeout: 10000 }
    );
    const processes = JSON.parse(stdout);
    return (Array.isArray(processes) ? processes : [processes]).map((p: any) => ({
      name: p.Name,
      pid: p.Id,
      memory: p.Memory,
    }));
  } catch {
    return [];
  }
}

/**
 * Kill a process by name or PID
 */
export async function killProcess(nameOrPid: string | number): Promise<{ success: boolean }> {
  try {
    if (typeof nameOrPid === 'number') {
      await execAsync(`taskkill /PID ${nameOrPid} /F`, { timeout: 5000 });
    } else {
      await execAsync(`taskkill /IM "${nameOrPid}" /F`, { timeout: 5000 });
    }
    return { success: true };
  } catch {
    return { success: false };
  }
}

/**
 * Take a screenshot of a specific window
 */
export async function screenshotWindow(appName: string): Promise<any> {
  await switchToApp(appName);
  await new Promise(r => setTimeout(r, 500));
  return takeScreenshot();
}

export const processTools = {
  launch_app: { fn: launchApp, description: 'Launch an application (chrome, vscode, terminal, claude-code, etc.)' },
  switch_to: { fn: switchToApp, description: 'Switch to / focus an application window' },
  open_url: { fn: openUrl, description: 'Open a URL in the default browser' },
  open_in_vscode: { fn: openInVSCode, description: 'Open a file in VSCode' },
  run_command: { fn: runInTerminal, description: 'Run a shell command and get output' },
  claude_code: { fn: claudeCode, description: 'Send a prompt to Claude Code via screen control — focuses window, types prompt, waits for response, returns screenshots of the result' },
  get_clipboard: { fn: getClipboard, description: 'Get clipboard contents' },
  set_clipboard: { fn: setClipboard, description: 'Set clipboard contents' },
  list_processes: { fn: getRunningProcesses, description: 'List running processes with memory usage' },
  kill_process: { fn: killProcess, description: 'Kill a process by name or PID' },
  screenshot_window: { fn: screenshotWindow, description: 'Take screenshot of a specific app window' },
};
