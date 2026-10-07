/**
 * NemoClaw Video & Frame Capture Module
 *
 * Provides screen recording, key-frame extraction, and ActionSpan bursts
 * using ffmpeg (gdigrab on Windows) and pyautogui screenshots.
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { takeScreenshot } from './desktopControl.js';

const execAsync = promisify(exec);

interface RecordingSession {
  id: string;
  process: ChildProcess;
  outputPath: string;
  startedAt: number;
  fps: number;
}

interface ActionSpan {
  id: string;
  frames: Array<{ path: string; timestamp: number; label: string }>;
  videoPath?: string;
}

const activeRecordings = new Map<string, RecordingSession>();
const MAX_RECORDINGS = 3; // Bounded memory

/**
 * Start continuous screen recording via ffmpeg gdigrab
 */
export async function startRecording(options: {
  fps?: number;
  duration?: number; // max seconds, 0 = unlimited until stop
  region?: { x: number; y: number; width: number; height: number };
} = {}): Promise<{ sessionId: string; outputPath: string }> {
  if (activeRecordings.size >= MAX_RECORDINGS) {
    // Evict oldest recording
    const oldest = [...activeRecordings.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0];
    if (oldest) {
      oldest[1].process.kill();
      activeRecordings.delete(oldest[0]);
    }
  }

  const { fps = 10, duration = 0, region } = options;
  const sessionId = `rec_${Date.now()}`;
  const outputPath = path.join(os.tmpdir(), `nemoclaw_${sessionId}.mp4`);

  const args = [
    '-y',
    '-f', 'gdigrab',
    '-framerate', String(fps),
  ];

  if (region) {
    args.push(
      '-offset_x', String(region.x),
      '-offset_y', String(region.y),
      '-video_size', `${region.width}x${region.height}`,
    );
  }

  args.push('-i', 'desktop');

  if (duration > 0) {
    args.push('-t', String(duration));
  }

  // Use NVENC if available (user has GPU), fallback to libx264
  args.push(
    '-c:v', 'h264_nvenc',
    '-preset', 'p4',
    '-pix_fmt', 'yuv420p',
    outputPath
  );

  const process = spawn('ffmpeg', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // Handle NVENC failure — restart with libx264
  let restarted = false;
  process.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString();
    if (msg.includes('Cannot load') && msg.includes('nvenc') && !restarted) {
      restarted = true;
      process.kill();
      // Fallback: restart with libx264
      const fallbackArgs = args.map(a => a === 'h264_nvenc' ? 'libx264' : a).filter(a => a !== '-preset' && a !== 'p4');
      const fallbackProcess = spawn('ffmpeg', fallbackArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      activeRecordings.set(sessionId, {
        id: sessionId,
        process: fallbackProcess,
        outputPath,
        startedAt: Date.now(),
        fps,
      });
    }
  });

  activeRecordings.set(sessionId, {
    id: sessionId,
    process,
    outputPath,
    startedAt: Date.now(),
    fps,
  });

  return { sessionId, outputPath };
}

/**
 * Stop a recording and return the video file
 */
export async function stopRecording(sessionId: string): Promise<{
  path: string;
  durationMs: number;
  sizeBytes: number;
} | null> {
  const session = activeRecordings.get(sessionId);
  if (!session) return null;

  // Send 'q' to ffmpeg stdin for graceful stop
  session.process.stdin?.write('q');

  // Wait for process to exit
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      session.process.kill('SIGKILL');
      resolve();
    }, 5000);
    session.process.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  activeRecordings.delete(sessionId);

  try {
    const stat = await fs.stat(session.outputPath);
    return {
      path: session.outputPath,
      durationMs: Date.now() - session.startedAt,
      sizeBytes: stat.size,
    };
  } catch {
    return null;
  }
}

/**
 * ActionSpan Burst: take N screenshots with labels, stitch into short video
 * This is the "slim" evidence mode — before + action + after
 */
export async function captureActionSpan(
  actions: Array<{ label: string; delayMs?: number; action?: () => Promise<void> }>
): Promise<ActionSpan> {
  const spanId = `span_${Date.now()}`;
  const frames: ActionSpan['frames'] = [];

  for (const step of actions) {
    if (step.delayMs) {
      await new Promise(r => setTimeout(r, step.delayMs));
    }

    if (step.action) {
      await step.action();
      await new Promise(r => setTimeout(r, 200)); // let UI settle
    }

    const screenshot = await takeScreenshot();
    frames.push({
      path: screenshot.path,
      timestamp: screenshot.timestamp,
      label: step.label,
    });
  }

  // Stitch frames into a short video
  const videoPath = path.join(os.tmpdir(), `nemoclaw_${spanId}.mp4`);
  const frameListPath = path.join(os.tmpdir(), `nemoclaw_${spanId}_frames.txt`);

  // Create ffmpeg concat file
  const frameList = frames.map(f =>
    `file '${f.path.replace(/\\/g, '/')}'\nduration 0.8`
  ).join('\n');
  await fs.writeFile(frameListPath, frameList);

  try {
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${frameListPath}" -c:v libx264 -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${videoPath}"`,
      { timeout: 30000 }
    );
  } catch {
    // Video stitching failed, still return frames
  }

  return { id: spanId, frames, videoPath };
}

/**
 * Extract key frames from an existing video
 * Uses scene detection to find important moments
 */
export async function extractKeyFrames(
  videoPath: string,
  maxFrames: number = 5
): Promise<string[]> {
  const outputDir = path.join(os.tmpdir(), `nemoclaw_keyframes_${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });

  // Use scene detection filter to find key moments
  await execAsync(
    `ffmpeg -i "${videoPath}" -vf "select='gt(scene,0.3)',scale=1280:-1" -vsync vfr -frames:v ${maxFrames} "${outputDir}/frame_%03d.png"`,
    { timeout: 60000 }
  );

  const files = await fs.readdir(outputDir);
  return files
    .filter(f => f.endsWith('.png'))
    .sort()
    .map(f => path.join(outputDir, f));
}

/**
 * Convert video to base64 for sending over WebSocket
 * Compresses to reasonable size first
 */
export async function videoToBase64(
  videoPath: string,
  maxSizeMB: number = 2
): Promise<string> {
  const stat = await fs.stat(videoPath);

  if (stat.size > maxSizeMB * 1024 * 1024) {
    // Compress further
    const compressedPath = videoPath.replace('.mp4', '_compressed.mp4');
    await execAsync(
      `ffmpeg -y -i "${videoPath}" -c:v libx264 -crf 28 -preset fast -vf "scale=iw/2:ih/2" "${compressedPath}"`,
      { timeout: 60000 }
    );
    const buffer = await fs.readFile(compressedPath);
    return buffer.toString('base64');
  }

  const buffer = await fs.readFile(videoPath);
  return buffer.toString('base64');
}

/**
 * Get base64 of screenshot frames for sending over chat
 */
export async function framesToBase64(
  framePaths: string[]
): Promise<Array<{ path: string; base64: string }>> {
  return Promise.all(
    framePaths.map(async (p) => {
      const buffer = await fs.readFile(p);
      return { path: p, base64: buffer.toString('base64') };
    })
  );
}

// Cleanup temp files older than 1 hour
export async function cleanupTempFiles(): Promise<number> {
  const tmpDir = os.tmpdir();
  const files = await fs.readdir(tmpDir);
  const nemoclawFiles = files.filter(f => f.startsWith('nemoclaw_'));
  let cleaned = 0;

  for (const file of nemoclawFiles) {
    const filepath = path.join(tmpDir, file);
    try {
      const stat = await fs.stat(filepath);
      if (Date.now() - stat.mtimeMs > 3600000) { // 1 hour
        await fs.unlink(filepath);
        cleaned++;
      }
    } catch { /* ignore */ }
  }
  return cleaned;
}

export const videoTools = {
  start_recording: { fn: startRecording, description: 'Start screen recording (returns session ID)' },
  stop_recording: { fn: stopRecording, description: 'Stop recording and get video file' },
  capture_action_span: { fn: captureActionSpan, description: 'Capture before/during/after screenshots as short video' },
  extract_key_frames: { fn: extractKeyFrames, description: 'Extract key frames from video using scene detection' },
  video_to_base64: { fn: videoToBase64, description: 'Convert video to base64 for transmission' },
  frames_to_base64: { fn: framesToBase64, description: 'Convert frame images to base64' },
  cleanup: { fn: cleanupTempFiles, description: 'Clean up old temp files' },
};
