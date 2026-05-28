// Smoke test runner for home-v5.html — loads the page in jsdom,
// runs runDemoQA() (17 assertions) + runLiveAssistQA() (8 assertions),
// and exits non-zero on any failure.
//
// Run: node scripts/test-live-assist-jsdom.mjs
//
// This file is NOT committed (excluded by .gitignore pattern below if added).
// Used for inline verification during development.

import { JSDOM } from '../../../../node_modules/jsdom/lib/api.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HTML_PATH = resolve(process.cwd(), 'public/proto/home-v5.html');
const html = readFileSync(HTML_PATH, 'utf8');

async function runSuite(width, label) {
  console.log(`\n=== ${label} (viewport=${width}px) ===`);
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',  // we'll explicitly run scripts AFTER setting up matchMedia
    pretendToBeVisual: true,
    url: 'http://localhost:5173/proto/home-v5.html'
  });

  // Override innerWidth before scripts query it
  Object.defineProperty(dom.window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 900, configurable: true });

  // Stub matchMedia for media queries
  dom.window.matchMedia = (q) => {
    let matches = false;
    if (/max-width:\s*767/.test(q)) matches = width < 768;
    else if (/min-width:\s*768/.test(q)) matches = width >= 768;
    return { matches, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
  };

  // Now execute all <script> tags in the document
  const scripts = Array.from(dom.window.document.querySelectorAll('script'));
  for (const scriptEl of scripts) {
    if (scriptEl.textContent && (scriptEl.type === '' || scriptEl.type === 'text/javascript' || !scriptEl.type)) {
      try {
        dom.window.eval(scriptEl.textContent);
      } catch (e) {
        // Module/type=module scripts will throw — skip
      }
    }
  }

  // Wait for inline scripts to run
  await new Promise(r => setTimeout(r, 1500));

  const win = dom.window;
  const reports = { demo: null, liveAssist: null };

  // Run runDemoFull at instant speed first so the QA suite can validate the demo state.
  try {
    if (typeof win.runDemoFull === 'function') {
      await win.runDemoFull({ speed: 'instant' });
      // Let microtasks + render-resets settle
      await new Promise(r => setTimeout(r, 200));
    } else {
      console.error('   ✗ window.runDemoFull missing — cannot validate demo phases');
    }
  } catch (e) {
    console.error('   ✗ runDemoFull threw:', e.message);
  }

  try {
    if (typeof win.runDemoQA === 'function') {
      reports.demo = win.runDemoQA();
    } else {
      console.error('   ✗ window.runDemoQA missing');
    }
  } catch (e) {
    console.error('   ✗ runDemoQA threw:', e.message);
  }

  try {
    if (typeof win.runLiveAssistQA === 'function') {
      reports.liveAssist = win.runLiveAssistQA();
    } else {
      console.error('   ✗ window.runLiveAssistQA missing');
    }
  } catch (e) {
    console.error('   ✗ runLiveAssistQA threw:', e.message);
  }

  if (reports.demo) {
    console.log(`   demo:        ${reports.demo.passed}/${reports.demo.total} passed (${reports.demo.failed} failed)`);
    if (reports.demo.failed > 0) {
      reports.demo.results.filter(r => !r.pass).forEach(r => console.log(`     - ${r.id}: ${r.desc} — ${r.detail}`));
    }
  }
  if (reports.liveAssist) {
    console.log(`   liveAssist:  ${reports.liveAssist.passed}/${reports.liveAssist.total} passed (${reports.liveAssist.failed} failed)`);
    if (reports.liveAssist.failed > 0) {
      reports.liveAssist.results.filter(r => !r.pass).forEach(r => console.log(`     - ${r.id}: ${r.desc} — ${r.detail}`));
    }
  }

  dom.window.close();
  return reports;
}

const desktop = await runSuite(1280, 'Desktop');
const mobile  = await runSuite(420,  'Mobile');

const allOk =
  desktop.demo?.failed === 0 &&
  desktop.liveAssist?.failed === 0 &&
  mobile.liveAssist?.failed === 0;

console.log('\n=== Summary ===');
console.log('Desktop demo:       ', desktop.demo?.failed === 0 ? 'PASS' : 'FAIL');
console.log('Desktop liveAssist: ', desktop.liveAssist?.failed === 0 ? 'PASS' : 'FAIL');
console.log('Mobile  liveAssist: ', mobile.liveAssist?.failed === 0 ? 'PASS' : 'FAIL');

process.exit(allOk ? 0 : 1);
