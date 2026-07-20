/**
 * NemoClaw Desktop Control Module
 *
 * Provides screenshot, click, type, key, and scroll operations
 * via Python pyautogui bridge. Cross-platform (Windows primary).
 */

import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Evidence strategy: not every action needs a screenshot
type EvidenceMode = 'none' | 'after' | 'slim' | 'full';

interface ScreenshotResult {
  path: string;
  base64: string;
  width: number;
  height: number;
  timestamp: number;
}

interface ClickResult {
  x: number;
  y: number;
  button: string;
  screenshot?: ScreenshotResult;
}

interface TypeResult {
  text: string;
  screenshot?: ScreenshotResult;
}

// Determine evidence mode based on command type
function getEvidenceMode(action: string): EvidenceMode {
  const afterActions = ['open', 'navigate', 'launch', 'switch', 'focus'];
  const slimActions = ['click', 'type', 'drag', 'scroll'];
  const fullActions = ['demo', 'walkthrough', 'record', 'video'];

  if (fullActions.some(a => action.includes(a))) return 'full';
  if (afterActions.some(a => action.includes(a))) return 'after';
  if (slimActions.some(a => action.includes(a))) return 'slim';
  return 'none';
}

// Python bridge for pyautogui operations
async function runPython(code: string): Promise<string> {
  const { stdout, stderr } = await execAsync(
    `python -c "${code.replace(/"/g, '\\"').replace(/\n/g, ';')}"`,
    { timeout: 15000 }
  );
  if (stderr && !stderr.includes('UserWarning')) {
    throw new Error(`Python error: ${stderr}`);
  }
  return stdout.trim();
}

export async function takeScreenshot(
  region?: { x: number; y: number; width: number; height: number }
): Promise<ScreenshotResult> {
  const timestamp = Date.now();
  const filename = `nemoclaw_screenshot_${timestamp}.png`;
  const filepath = path.join(os.tmpdir(), filename);

  if (region) {
    await runPython(
      `import pyautogui;` +
      `img = pyautogui.screenshot(region=(${region.x},${region.y},${region.width},${region.height}));` +
      `img.save('${filepath.replace(/\\/g, '/')}')`
    );
  } else {
    await runPython(
      `import pyautogui;` +
      `img = pyautogui.screenshot();` +
      `img.save('${filepath.replace(/\\/g, '/')}')`
    );
  }

  const buffer = await fs.readFile(filepath);
  const base64 = buffer.toString('base64');

  // Get dimensions
  const sizeStr = await runPython(
    `import pyautogui;s=pyautogui.size();print(f'{s.width},{s.height}')`
  );
  const [width, height] = sizeStr.split(',').map(Number);

  return { path: filepath, base64, width, height, timestamp };
}

export async function click(
  x: number,
  y: number,
  options: { button?: 'left' | 'right' | 'middle'; clicks?: number; evidence?: boolean } = {}
): Promise<ClickResult> {
  const { button = 'left', clicks = 1, evidence = true } = options;

  await runPython(
    `import pyautogui;` +
    `pyautogui.click(${x},${y},button='${button}',clicks=${clicks})`
  );

  const result: ClickResult = { x, y, button };
  if (evidence) {
    // Small delay for UI to update after click
    await new Promise(r => setTimeout(r, 300));
    result.screenshot = await takeScreenshot();
  }
  return result;
}

export async function doubleClick(x: number, y: number): Promise<ClickResult> {
  return click(x, y, { clicks: 2 });
}

export async function rightClick(x: number, y: number): Promise<ClickResult> {
  return click(x, y, { button: 'right' });
}

export async function typeText(
  text: string,
  options: { interval?: number; evidence?: boolean } = {}
): Promise<TypeResult> {
  const { interval = 0.02, evidence = true } = options;

  // Use pyperclip for reliable unicode support, fall back to typewrite for ASCII
  const hasUnicode = /[^\x00-\x7F]/.test(text);
  if (hasUnicode) {
    await runPython(
      `import pyperclip,pyautogui;` +
      `pyperclip.copy('''${text.replace(/'/g, "\\'")}''');` +
      `pyautogui.hotkey('ctrl','v')`
    );
  } else {
    await runPython(
      `import pyautogui;` +
      `pyautogui.typewrite('''${text.replace(/'/g, "\\'")}''',interval=${interval})`
    );
  }

  const result: TypeResult = { text };
  if (evidence) {
    await new Promise(r => setTimeout(r, 200));
    result.screenshot = await takeScreenshot();
  }
  return result;
}

export async function hotkey(...keys: string[]): Promise<void> {
  const keyStr = keys.map(k => `'${k}'`).join(',');
  await runPython(`import pyautogui;pyautogui.hotkey(${keyStr})`);
}

export async function pressKey(key: string, presses: number = 1): Promise<void> {
  await runPython(`import pyautogui;pyautogui.press('${key}',presses=${presses})`);
}

export async function scroll(
  clicks: number,
  x?: number,
  y?: number
): Promise<void> {
  if (x !== undefined && y !== undefined) {
    await runPython(`import pyautogui;pyautogui.scroll(${clicks},${x},${y})`);
  } else {
    await runPython(`import pyautogui;pyautogui.scroll(${clicks})`);
  }
}

export async function moveTo(x: number, y: number, duration: number = 0.3): Promise<void> {
  await runPython(`import pyautogui;pyautogui.moveTo(${x},${y},duration=${duration})`);
}

export async function dragTo(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  duration: number = 0.5
): Promise<ScreenshotResult> {
  await runPython(
    `import pyautogui;` +
    `pyautogui.moveTo(${startX},${startY});` +
    `pyautogui.drag(${endX - startX},${endY - startY},duration=${duration})`
  );
  await new Promise(r => setTimeout(r, 300));
  return takeScreenshot();
}

export async function getMousePosition(): Promise<{ x: number; y: number }> {
  const posStr = await runPython(
    `import pyautogui;p=pyautogui.position();print(f'{p.x},{p.y}')`
  );
  const [x, y] = posStr.split(',').map(Number);
  return { x, y };
}

export async function getScreenSize(): Promise<{ width: number; height: number }> {
  const sizeStr = await runPython(
    `import pyautogui;s=pyautogui.size();print(f'{s.width},{s.height}')`
  );
  const [width, height] = sizeStr.split(',').map(Number);
  return { width, height };
}

export async function locateOnScreen(
  imagePath: string,
  confidence: number = 0.8
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    const result = await runPython(
      `import pyautogui;` +
      `loc=pyautogui.locateOnScreen('${imagePath.replace(/\\/g, '/')}',confidence=${confidence});` +
      `print(f'{loc.left},{loc.top},{loc.width},{loc.height}') if loc else print('null')`
    );
    if (result === 'null') return null;
    const [x, y, width, height] = result.split(',').map(Number);
    return { x, y, width, height };
  } catch {
    return null;
  }
}

// Get list of all open windows
export async function getOpenWindows(): Promise<Array<{ title: string; hwnd: number }>> {
  const result = await runPython(
    `import pygetwindow as gw;` +
    `import json;` +
    `wins = [{'title':w.title,'hwnd':w._hWnd} for w in gw.getAllWindows() if w.title.strip()];` +
    `print(json.dumps(wins))`
  );
  return JSON.parse(result);
}

// Focus a window by title substring
export async function focusWindow(titleSubstring: string): Promise<boolean> {
  try {
    await runPython(
      `import pygetwindow as gw;` +
      `wins=[w for w in gw.getAllWindows() if '${titleSubstring}' in w.title];` +
      `wins[0].activate() if wins else None`
    );
    return true;
  } catch {
    return false;
  }
}

// Export all tools as a registry for the agent runner
export const desktopTools = {
  screenshot: { fn: takeScreenshot, description: 'Take a screenshot of the entire screen or a region' },
  click: { fn: click, description: 'Click at x,y coordinates' },
  double_click: { fn: doubleClick, description: 'Double-click at x,y coordinates' },
  right_click: { fn: rightClick, description: 'Right-click at x,y coordinates' },
  type: { fn: typeText, description: 'Type text at current cursor position' },
  hotkey: { fn: hotkey, description: 'Press a keyboard shortcut (e.g., ctrl, c)' },
  press_key: { fn: pressKey, description: 'Press a single key (e.g., enter, tab, escape)' },
  scroll: { fn: scroll, description: 'Scroll up (positive) or down (negative)' },
  move_to: { fn: moveTo, description: 'Move mouse to x,y coordinates' },
  drag_to: { fn: dragTo, description: 'Drag from start to end coordinates' },
  mouse_position: { fn: getMousePosition, description: 'Get current mouse position' },
  screen_size: { fn: getScreenSize, description: 'Get screen dimensions' },
  locate_image: { fn: locateOnScreen, description: 'Find an image on screen and return its position' },
  list_windows: { fn: getOpenWindows, description: 'List all open windows with titles' },
  focus_window: { fn: focusWindow, description: 'Focus/activate a window by title' },
};
