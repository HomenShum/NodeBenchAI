import { ActionJudge } from './judge.js';
import { auditLog } from './auditLog.js';

async function main() {
  console.log('=== Judge + Audit Smoke Test ===\n');
  const judge = new ActionJudge();

  const cases = [
    { tool: 'screenshot', args: {}, expect: 'ALLOW' },
    { tool: 'read_file', args: { filePath: './src/App.tsx' }, expect: 'ALLOW' },
    { tool: 'click', args: { x: 100, y: 200 }, expect: 'ALLOW' },
    { tool: 'kill_process', args: { nameOrPid: 'svchost.exe' }, expect: 'DENY' },
    { tool: 'kill_process', args: { nameOrPid: 'notepad.exe' }, expect: 'ASK_USER' },
    { tool: 'run_command', args: { command: 'rm -rf /' }, expect: 'DENY' },
    { tool: 'run_command', args: { command: 'ls -la' }, expect: 'ALLOW' },
    { tool: 'write_file', args: { filePath: 'C:\\Windows\\evil.txt' }, expect: 'DENY' },
    { tool: 'write_file', args: { filePath: './src/new.ts' }, expect: 'ASK_USER' },
    { tool: 'send_to_claude', args: { prompt: 'hello' }, expect: 'ASK_USER' },
    { tool: 'launch_app', args: { appName: 'chrome' }, expect: 'ALLOW' },
  ];

  let passed = 0;
  for (const tc of cases) {
    const result = await judge.judge(tc.tool, tc.args, { userMessage: 'test', intent: 'complex' });
    const ok = result.verdict === tc.expect;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${tc.tool}(${JSON.stringify(tc.args)}) → ${result.verdict} (expected ${tc.expect})`);
    if (!ok) console.log(`      Reason: ${result.reason}`);
    if (ok) passed++;

    auditLog.logToolCall(tc.tool, tc.args, result.verdict);
  }

  console.log(`\n${passed}/${cases.length} passed`);

  // Rate limit test
  console.log('\n--- Rate limit test ---');
  const rl = new ActionJudge();
  for (let i = 0; i < 25; i++) {
    const r = await rl.judge('click', { x: i, y: i }, { userMessage: 'test', intent: 'desktop_control' });
    if (r.verdict === 'DENY') {
      console.log(`Rate limited at call ${i + 1}: ${r.reason}`);
      break;
    }
  }

  // Audit stats
  const stats = await auditLog.getStats();
  console.log('\nAudit stats:', JSON.stringify(stats, null, 2));

  console.log('\n=== Done ===');
}

main().catch(console.error);
