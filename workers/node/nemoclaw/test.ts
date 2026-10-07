/**
 * NemoClaw smoke test — verifies all modules load and desktop control works
 */

import { takeScreenshot, getScreenSize, getOpenWindows } from './desktopControl.js';
import { desktopTools } from './desktopControl.js';
import { videoTools } from './videoCapture.js';
import { processTools } from './processControl.js';
import { codebaseTools } from './codebaseContext.js';

async function main() {
  console.log('=== NemoClaw Smoke Test ===\n');

  // 1. Tool registry
  const allTools = { ...desktopTools, ...videoTools, ...processTools, ...codebaseTools };
  console.log(`[1] Tool registry: ${Object.keys(allTools).length} tools loaded`);
  console.log(`    Desktop: ${Object.keys(desktopTools).length} tools`);
  console.log(`    Video: ${Object.keys(videoTools).length} tools`);
  console.log(`    Process: ${Object.keys(processTools).length} tools`);
  console.log(`    Codebase: ${Object.keys(codebaseTools).length} tools`);

  // 2. Screen size
  const size = await getScreenSize();
  console.log(`\n[2] Screen size: ${size.width}x${size.height}`);

  // 3. Screenshot
  const screenshot = await takeScreenshot();
  console.log(`\n[3] Screenshot: ${screenshot.width}x${screenshot.height}`);
  console.log(`    Path: ${screenshot.path}`);
  console.log(`    Base64: ${screenshot.base64.length} chars (~${Math.round(screenshot.base64.length * 3 / 4 / 1024)}KB)`);

  // 4. Open windows
  const windows = await getOpenWindows();
  console.log(`\n[4] Open windows: ${windows.length}`);
  windows.slice(0, 8).forEach(w => console.log(`    - ${w.title}`));

  // 5. Workspace summary
  const { getWorkspaceSummary } = await import('./codebaseContext.js');
  const summary = await getWorkspaceSummary(process.cwd());
  console.log(`\n[5] Workspace: ${summary.name} (${summary.type})`);
  console.log(`    Branch: ${summary.gitInfo.branch}`);
  console.log(`    Key files: ${summary.mainFiles.join(', ')}`);

  console.log('\n=== All tests passed ===');
}

main().catch(e => {
  console.error('FAILED:', e);
  process.exit(1);
});
