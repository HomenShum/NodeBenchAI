import { config } from 'dotenv';
config({ path: '.env.local' });

import { NemoClawAgent } from './agentRunner.js';

async function main() {
  const agent = new NemoClawAgent({ workspacePath: process.cwd() });
  const start = Date.now();
  console.log('Running: "Take a screenshot of my screen"...');
  const r = await agent.run('Take a screenshot of my screen');
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Response: ${r.text?.slice(0, 300)}`);
  console.log(`Images: ${r.images?.length || 0}`);
  console.log(`Tools: ${r.toolsUsed.join(', ')}`);
  console.log(`Turns: ${r.turnCount}`);
  console.log(`Time: ${elapsed}s`);
  console.log(r.turnCount <= 5 ? 'PASS — circuit breaker working' : `FAIL — ${r.turnCount} turns (expected <=5)`);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
