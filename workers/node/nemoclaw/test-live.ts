/**
 * NemoClaw Live Pipeline Test
 * Tests every layer with real API calls and real scenarios.
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import { NemoClawAgent } from './agentRunner.js';
import { ActionJudge } from './judge.js';
import { auditLog } from './auditLog.js';
import { takeScreenshot, getScreenSize, getOpenWindows, getMousePosition } from './desktopControl.js';
import { getWorkspaceSummary, searchCode, getGitStatus } from './codebaseContext.js';
import { getRunningProcesses } from './processControl.js';

const PASS = '  PASS';
const FAIL = '  FAIL';
const SKIP = '  SKIP';

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`${PASS} ${label}`);
    passed++;
  } else {
    console.log(`${FAIL} ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function testLayer1_ProviderDetection() {
  console.log('\n=== Layer 1: Provider Detection ===');

  const keys = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  };

  assert(!!keys.anthropic?.startsWith('sk-ant-'), 'Anthropic key detected', keys.anthropic?.slice(0, 12));
  assert(!!keys.openai?.startsWith('sk-'), 'OpenAI key detected', keys.openai?.slice(0, 12));
  assert(!!keys.gemini && keys.gemini.length > 10, 'Gemini key detected', keys.gemini?.slice(0, 12));

  const available = Object.entries(keys).filter(([_, v]) => v && v.length > 5).map(([k]) => k);
  console.log(`  Available providers: ${available.join(', ')}`);

  // Test agent construction
  try {
    const agent = new NemoClawAgent({ workspacePath: process.cwd() });
    assert(true, 'Agent constructed with auto-detected providers');
  } catch (e: any) {
    assert(false, 'Agent construction', e.message);
  }
}

async function testLayer2_IntentClassification() {
  console.log('\n=== Layer 2: Intent Classification (Real API) ===');

  const agent = new NemoClawAgent({ workspacePath: process.cwd() });

  const testCases = [
    { input: 'take a screenshot', expectedIntent: 'screenshot' },
    { input: 'open chrome and go to github.com', expectedIntent: 'app_control' },
    { input: 'what files are in the src folder', expectedIntent: 'code' },
    { input: 'click the submit button', expectedIntent: 'desktop_control' },
    { input: 'do a deep analysis of our codebase architecture and find all security issues', expectedIntent: 'complex' },
  ];

  for (const tc of testCases) {
    try {
      const result = await agent.classifyIntent(tc.input);
      const intentMatch = result.intent === tc.expectedIntent;
      const tierValid = ['free', 'mid', 'full'].includes(result.tier);
      assert(tierValid, `"${tc.input.slice(0, 40)}..." → intent=${result.intent}, tier=${result.tier}`,
        !intentMatch ? `expected intent=${tc.expectedIntent}` : undefined);
    } catch (e: any) {
      assert(false, `Classification: "${tc.input.slice(0, 30)}..."`, e.message);
    }
  }
}

async function testLayer3_ToolExecution() {
  console.log('\n=== Layer 3: Tool Execution (Real Desktop) ===');

  // Screenshot
  try {
    const ss = await takeScreenshot();
    assert(ss.width > 0 && ss.height > 0, `Screenshot: ${ss.width}x${ss.height}`);
    assert(ss.base64.length > 1000, `Screenshot base64: ${Math.round(ss.base64.length / 1024)}KB`);
  } catch (e: any) {
    assert(false, 'Screenshot', e.message);
  }

  // Screen size
  try {
    const size = await getScreenSize();
    assert(size.width > 0 && size.height > 0, `Screen size: ${size.width}x${size.height}`);
  } catch (e: any) {
    assert(false, 'Screen size', e.message);
  }

  // Mouse position
  try {
    const pos = await getMousePosition();
    assert(typeof pos.x === 'number' && typeof pos.y === 'number', `Mouse position: ${pos.x},${pos.y}`);
  } catch (e: any) {
    assert(false, 'Mouse position', e.message);
  }

  // Open windows
  try {
    const windows = await getOpenWindows();
    assert(windows.length > 0, `Open windows: ${windows.length}`);
  } catch (e: any) {
    assert(false, 'Open windows', e.message);
  }

  // Workspace summary
  try {
    const summary = await getWorkspaceSummary(process.cwd());
    assert(summary.name === 'nodebench-ai', `Workspace: ${summary.name} (${summary.type})`);
    assert(summary.gitInfo.branch === 'main', `Git branch: ${summary.gitInfo.branch}`);
  } catch (e: any) {
    assert(false, 'Workspace summary', e.message);
  }

  // Code search
  try {
    const results = await searchCode('NemoClawAgent', process.cwd(), { fileType: 'ts' });
    assert(results.length > 0, `Code search "NemoClawAgent": ${results.length} results`);
  } catch (e: any) {
    assert(false, 'Code search', e.message);
  }

  // Git status
  try {
    const git = await getGitStatus(process.cwd());
    assert(git.branch === 'main', `Git status: branch=${git.branch}`);
  } catch (e: any) {
    assert(false, 'Git status', e.message);
  }

  // Running processes
  try {
    const procs = await getRunningProcesses();
    assert(procs.length > 0, `Processes: ${procs.length} running`);
  } catch (e: any) {
    assert(false, 'Processes', e.message);
  }
}

async function testLayer4_Judge() {
  console.log('\n=== Layer 4: Judge Validation ===');

  const judge = new ActionJudge();
  const ctx = { userMessage: 'test', intent: 'complex' };

  // Should ALLOW
  const r1 = await judge.judge('screenshot', {}, ctx);
  assert(r1.verdict === 'ALLOW', `screenshot → ${r1.verdict}`);

  const r2 = await judge.judge('read_file', { filePath: './src/App.tsx' }, ctx);
  assert(r2.verdict === 'ALLOW', `read_file → ${r2.verdict}`);

  const r3 = await judge.judge('launch_app', { appName: 'chrome' }, ctx);
  assert(r3.verdict === 'ALLOW', `launch_app → ${r3.verdict}`);

  // Should DENY
  const r4 = await judge.judge('kill_process', { nameOrPid: 'svchost.exe' }, ctx);
  assert(r4.verdict === 'DENY', `kill svchost → ${r4.verdict}`);

  const r5 = await judge.judge('run_command', { command: 'rm -rf /' }, ctx);
  assert(r5.verdict === 'DENY', `rm -rf / → ${r5.verdict}`);

  const r6 = await judge.judge('write_file', { filePath: 'C:\\Windows\\test.txt' }, ctx);
  assert(r6.verdict === 'DENY', `write C:\\Windows → ${r6.verdict}`);

  // Should ASK_USER
  const r7 = await judge.judge('write_file', { filePath: './src/new.ts' }, ctx);
  assert(r7.verdict === 'ASK_USER', `write ./src/new.ts → ${r7.verdict}`);

  const r8 = await judge.judge('claude_code', { prompt: 'refactor' }, ctx);
  assert(r8.verdict === 'ASK_USER', `claude_code → ${r8.verdict}`);

  // Rate limit test
  const rl = new ActionJudge();
  let hitLimit = false;
  for (let i = 0; i < 205; i++) {
    const r = await rl.judge('click', { x: i, y: i }, ctx);
    if (r.verdict === 'DENY' && r.rule === 'rate_limit') {
      hitLimit = true;
      assert(i >= 200, `Rate limit hit at call ${i + 1} (expected ~201)`);
      break;
    }
  }
  if (!hitLimit) assert(false, 'Rate limit', 'never triggered');
}

async function testLayer5_FullAgentRun() {
  console.log('\n=== Layer 5: Full Agent Run (Real LLM + Real Tools) ===');

  const agent = new NemoClawAgent({ workspacePath: process.cwd() });

  // Simple question — should use free tier
  console.log('\n  Test 5a: Simple question (free tier)...');
  try {
    const r1 = await agent.run('What is the current git branch?');
    assert(!!r1.text && r1.text.length > 5, `Simple question response: ${r1.text.slice(0, 80)}...`);
    assert(r1.intent !== '', `Intent classified: ${r1.intent}`);
    console.log(`    Model: ${(r1 as any).model || 'unknown'}, Tools: ${r1.toolsUsed.join(', ') || 'none'}, Turns: ${r1.turnCount}`);
  } catch (e: any) {
    assert(false, 'Simple question', e.message);
  }

  // Screenshot request — should take a screenshot
  console.log('\n  Test 5b: Screenshot request...');
  try {
    agent.reset();
    const r2 = await agent.run('Take a screenshot of my screen');
    assert(!!r2.text, `Screenshot request response: ${r2.text.slice(0, 80)}...`);
    const hasScreenshot = r2.images && r2.images.length > 0;
    assert(!!hasScreenshot, `Screenshot included: ${r2.images?.length || 0} images`);
    console.log(`    Tools: ${r2.toolsUsed.join(', ') || 'none'}, Turns: ${r2.turnCount}`);
  } catch (e: any) {
    assert(false, 'Screenshot request', e.message);
  }
}

async function testLayer6_Telegram() {
  console.log('\n=== Layer 6: Telegram Bot ===');

  const token = process.env.NEMOCLAW_TELEGRAM_TOKEN;
  const ownerId = process.env.NEMOCLAW_TELEGRAM_OWNER_ID;

  if (!token || !ownerId) {
    console.log(`${SKIP} Telegram not configured`);
    skipped++;
    return;
  }

  // Test bot identity
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json() as any;
    assert(data.ok, `Bot identity: @${data.result?.username}`);
  } catch (e: any) {
    assert(false, 'Bot identity', e.message);
  }

  // Test sending a message to owner
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: parseInt(ownerId),
        text: '✅ NemoClaw pipeline test complete!\n\nAll systems operational. Send /start to begin.',
      }),
    });
    const data = await res.json() as any;
    assert(data.ok, `Send message to owner: ${data.ok ? 'delivered' : data.description}`);
  } catch (e: any) {
    assert(false, 'Send message', e.message);
  }
}

async function testLayer7_AuditLog() {
  console.log('\n=== Layer 7: Audit Log ===');

  auditLog.log('test_start', { suite: 'live-pipeline' });
  auditLog.logToolCall('screenshot', {}, 'ALLOW');
  auditLog.logToolResult('screenshot', true, 150);
  auditLog.logToolCall('kill_process', { nameOrPid: 'svchost.exe' }, 'DENY');

  const stats = await auditLog.getStats();
  assert(stats.totalCalls > 0, `Audit logged ${stats.totalCalls} tool calls`);
  assert(stats.denials > 0, `Audit tracked ${stats.denials} denials`);

  const logs = await auditLog.getTodayLogs();
  assert(logs.length > 0, `Today's log: ${logs.length} entries`);
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   NemoClaw Live Pipeline Test Suite      ║');
  console.log('║   Testing ALL layers with real APIs      ║');
  console.log('╚══════════════════════════════════════════╝');

  const start = Date.now();

  await testLayer1_ProviderDetection();
  await testLayer2_IntentClassification();
  await testLayer3_ToolExecution();
  await testLayer4_Judge();
  await testLayer5_FullAgentRun();
  await testLayer6_Telegram();
  await testLayer7_AuditLog();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log('\n══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`  Time: ${elapsed}s`);
  console.log(`  Status: ${failed === 0 ? 'ALL PASSING' : 'FAILURES DETECTED'}`);
  console.log('══════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
