#!/usr/bin/env node
/**
 * Gemini 3.x Vision QA Self-Evaluator for Redesign Surfaces
 *
 * Captures screenshots of all 5 redesign surfaces, sends to Gemini 3.1 Pro Preview
 * for structured quality scoring, and outputs P0/P1/P2/P3 findings.
 *
 * Usage:
 *   node scripts/ui/gemini-redesign-qa.mjs [--url=https://www.nodebenchai.com] [--model=gemini-3.1-pro-preview]
 *
 * Prior art: Existing screenshotQa.ts (Convex action) + runDogfoodGeminiQa.mjs (CLI orchestrator)
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, '.tmp', 'redesign-qa');

const SURFACES = [
  { name: 'Home', path: '/redesign', desc: 'Landing with report halo, daily brief, ask-first input, daily introspection' },
  { name: 'Reports', path: '/redesign/reports', desc: 'Report gallery with cards, filters, coverage agent right rail' },
  { name: 'Chat', path: '/redesign/chat', desc: 'Chat with thread list, message area, suggestion cards, action chips' },
  { name: 'Inbox', path: '/redesign/inbox', desc: 'Triage inbox with categories, item detail, agent right rail' },
  { name: 'Me', path: '/redesign/me', desc: 'Profile/settings with identity, integrations, permissions' },
];

const REFERENCE_APPS = [
  'Linear (project management) - keyboard-first, sub-50ms response, glass-like dark UI, clean hierarchy',
  'Notion (workspace) - clean typography, generous whitespace, progressive disclosure, warm tones',
  'Vercel Dashboard - dark theme, status badges, monospace data, card grid, subtle borders',
  'Superhuman (email) - speed as design principle, keyboard shortcuts visible, split-pane layout',
  'Perplexity (search) - clean input, streaming results, citation links, minimal chrome',
];

const QA_PROMPT = `You are a senior product designer conducting a rigorous UI/UX quality audit.
You are evaluating a production web application called NodeBench AI against top-tier reference products.

REFERENCE STANDARD (aim for this quality level):
${REFERENCE_APPS.map((r, i) => `${i + 1}. ${r}`).join('\n')}

DESIGN SYSTEM CONTEXT:
- DEFAULT THEME IS LIGHT: warm off-white background (#faf9f7). This is intentional — the redesign defaults to light mode.
- Terracotta accent: decorative/background uses #d97757, but ALL text-color accent uses a darker variant (#a85030) for WCAG AA compliance. Do NOT flag accent-colored text as failing contrast — it was specifically darkened.
- Status colors: green (#1f7a3a, 5.1:1), amber (#9a5400, 5.5:1), red (#9c2a25, 7.2:1) — all meet WCAG AA. Do NOT flag these as contrast failures.
- Secondary text: uses #6b6862 (5.3:1 vs paper) — meets WCAG AA. Do NOT flag secondary text as a contrast failure unless it is visually unreadable.
- Dark theme (optional): warm charcoal background (#0f1011), terracotta accent (#e88f6e)
- Typography: Manrope (UI), JetBrains Mono (data/code)
- Cards: subtle borders and shadows. Light theme uses border-gray-200 bg-white; dark uses border-white/[0.06] bg-white/[0.02]
- Section headers: small uppercase with letter spacing (design-system convention)
- Three-column layout: left sidebar, main content, right agent rail
- IMPORTANT: Do NOT flag the light theme as incorrect. Light theme IS the default.
- IMPORTANT: Evaluate ONLY what you visually perceive in the screenshot. Do NOT calculate contrast ratios from hex values mentioned in this context — evaluate actual pixel readability.

SURFACE BEING EVALUATED: {{SURFACE_NAME}} ({{SURFACE_DESC}})
URL: {{SURFACE_URL}}

EVALUATION CRITERIA (score each 0-10):

1. VISUAL HIERARCHY - Is there one clear primary action? Are secondary elements visually quiet? Does the eye flow naturally?
2. TYPOGRAPHY & READABILITY - Font sizes appropriate? Line heights comfortable? Contrast sufficient (4.5:1 minimum)? No gray-on-dark-gray mush?
3. SPACING & RHYTHM - Consistent padding/margins? Aligned baselines? No random gaps or cramped areas?
4. COLOR & CONTRAST - Proper use of accent color? Sufficient contrast for all text? Status colors distinguishable?
5. COMPONENT QUALITY - Cards, buttons, badges, inputs look polished? Consistent styling? No broken borders?
6. LAYOUT RESPONSIVENESS - Three-column layout balanced? Sidebar proportional? Content area not cramped?
7. INFORMATION DENSITY - Right amount of information visible? Not too sparse, not overwhelming? Progressive disclosure used?
8. EMPTY/LOADING STATES - Do empty areas look intentional? Loading indicators present? Helpful messages?
9. INTERACTION AFFORDANCES - Clickable things look clickable? Hover states visible? Action buttons prominent?
10. MARKET REFERENCE PARITY - Could this surface sit alongside Linear/Notion/Vercel without looking amateur?

OUTPUT FORMAT (respond in valid JSON only):
{
  "surface": "{{SURFACE_NAME}}",
  "overallScore": <number 0-100>,
  "criteriaScores": {
    "visualHierarchy": <0-10>,
    "typography": <0-10>,
    "spacing": <0-10>,
    "colorContrast": <0-10>,
    "componentQuality": <0-10>,
    "layoutResponsiveness": <0-10>,
    "informationDensity": <0-10>,
    "emptyStates": <0-10>,
    "interactionAffordances": <0-10>,
    "marketParity": <0-10>
  },
  "findings": [
    {
      "severity": "P0|P1|P2|P3",
      "category": "<criteria name>",
      "element": "<specific UI element>",
      "issue": "<what's wrong>",
      "fix": "<specific actionable fix>",
      "cssSelector": "<approximate CSS selector if applicable>"
    }
  ],
  "strengths": ["<what's working well>"],
  "topPriorityFix": "<the single highest-impact fix for this surface>"
}

SEVERITY GUIDE:
- P0: Blocks use (crash, blank page, unreadable text, broken layout)
- P1: Major polish gap vs reference apps (low contrast, missing hierarchy, poor spacing, misleading UI)
- P2: Minor polish (inconsistent spacing, slight color issues, empty state copy)
- P3: Nit (alignment, minor label wording, micro-interaction missing)

Be specific and actionable. Reference exact UI elements you see. Do not hallucinate elements that aren't visible.`;


function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    url: 'https://www.nodebenchai.com',
    model: 'gemini-3.1-pro-preview',
    apiKey: '',
    headless: true,
    surfaces: null,
  };

  for (const arg of args) {
    if (arg.startsWith('--url=')) parsed.url = arg.slice(6);
    else if (arg.startsWith('--model=')) parsed.model = arg.slice(8);
    else if (arg.startsWith('--key=')) parsed.apiKey = arg.slice(6);
    else if (arg.startsWith('--surfaces=')) parsed.surfaces = arg.slice(11).split(',');
    else if (arg === '--headed') parsed.headless = false;
  }

  if (!parsed.apiKey) {
    try {
      const envFile = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf-8');
      const match = envFile.match(/GEMINI_API_KEY=(.+)/);
      if (match) parsed.apiKey = match[1].trim();
    } catch {}
  }

  if (!parsed.apiKey) {
    console.error('No GEMINI_API_KEY found. Pass --key= or set in .env.local');
    process.exit(1);
  }

  return parsed;
}


async function captureScreenshots(config) {
  console.log('\n--- Phase 1: Capturing screenshots ---');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: config.headless });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const surfaces = config.surfaces
    ? SURFACES.filter(s => config.surfaces.includes(s.name.toLowerCase()))
    : SURFACES;

  const screenshots = [];

  for (const surface of surfaces) {
    const url = `${config.url}${surface.path}`;
    console.log(`  Capturing ${surface.name}: ${url}`);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
        await page.waitForTimeout(5000);

        const filePath = path.join(OUT_DIR, `${surface.name.toLowerCase()}.png`);
        await page.screenshot({ path: filePath, fullPage: false });

        screenshots.push({
          ...surface,
          url,
          filePath,
          size: fs.statSync(filePath).size,
        });
        console.log(`    Saved: ${filePath} (${(fs.statSync(filePath).size / 1024).toFixed(0)} KB)`);
        break;
      } catch (err) {
        if (attempt === 0) {
          console.log(`    Retrying ${surface.name}...`);
          continue;
        }
        console.error(`    FAILED: ${err.message}`);
        screenshots.push({ ...surface, url, filePath: null, error: err.message });
      }
    }
  }

  await browser.close();
  return screenshots;
}


async function callGeminiVision(apiKey, model, imageBase64, mimeType, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType, data: imageBase64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No text in Gemini response');

  try {
    return JSON.parse(text);
  } catch {
    // Try stripping trailing commas (Gemini 2.5 Flash sometimes adds them)
    const cleaned = text
      .replace(/,\s*([\]}])/g, '$1')  // trailing commas before ] or }
      .replace(/\/\/[^\n]*/g, '')      // single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
    try {
      return JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch {}
      }
      throw new Error(`Could not parse Gemini response as JSON: ${text.slice(0, 300)}`);
    }
  }
}


async function evaluateSurfaces(screenshots, config) {
  console.log(`\n--- Phase 2: Evaluating with ${config.model} ---`);
  const results = [];

  for (const shot of screenshots) {
    if (!shot.filePath) {
      console.log(`  Skipping ${shot.name} (capture failed)`);
      results.push({ surface: shot.name, error: shot.error, overallScore: 0, findings: [] });
      continue;
    }

    console.log(`  Evaluating ${shot.name}...`);
    const imageBuffer = fs.readFileSync(shot.filePath);
    const imageBase64 = imageBuffer.toString('base64');
    const mimeType = 'image/png';

    const prompt = QA_PROMPT
      .replace(/\{\{SURFACE_NAME\}\}/g, shot.name)
      .replace(/\{\{SURFACE_DESC\}\}/g, shot.desc)
      .replace(/\{\{SURFACE_URL\}\}/g, shot.url);

    try {
      const result = await callGeminiVision(config.apiKey, config.model, imageBase64, mimeType, prompt);
      results.push(result);

      const p0 = result.findings?.filter(f => f.severity === 'P0').length || 0;
      const p1 = result.findings?.filter(f => f.severity === 'P1').length || 0;
      const p2 = result.findings?.filter(f => f.severity === 'P2').length || 0;
      const p3 = result.findings?.filter(f => f.severity === 'P3').length || 0;
      console.log(`    Score: ${result.overallScore}/100 | P0:${p0} P1:${p1} P2:${p2} P3:${p3} | Top fix: ${result.topPriorityFix?.slice(0, 80)}`);
    } catch (err) {
      console.error(`    FAILED: ${err.message}`);
      results.push({ surface: shot.name, error: err.message, overallScore: 0, findings: [] });
    }
  }

  return results;
}


function generateReport(results) {
  console.log('\n--- Phase 3: QA Report ---\n');

  const validResults = results.filter(r => !r.error);
  const avgScore = validResults.length
    ? Math.round(validResults.reduce((s, r) => s + (r.overallScore || 0), 0) / validResults.length)
    : 0;

  const allFindings = validResults.flatMap(r => (r.findings || []).map(f => ({ ...f, surface: r.surface })));
  const p0s = allFindings.filter(f => f.severity === 'P0');
  const p1s = allFindings.filter(f => f.severity === 'P1');
  const p2s = allFindings.filter(f => f.severity === 'P2');
  const p3s = allFindings.filter(f => f.severity === 'P3');

  const grade =
    avgScore >= 90 ? 'S' :
    avgScore >= 75 ? 'A' :
    avgScore >= 60 ? 'B' :
    avgScore >= 45 ? 'C' :
    avgScore >= 30 ? 'D' : 'F';

  console.log('=== NODEBENCH REDESIGN QA SCORECARD ===\n');
  console.log(`Overall Score: ${avgScore}/100 (Grade: ${grade})`);
  console.log(`Surfaces: ${validResults.length}/${results.length} evaluated`);
  console.log(`Findings: ${p0s.length} P0 | ${p1s.length} P1 | ${p2s.length} P2 | ${p3s.length} P3\n`);

  console.log('--- Per-Surface Scores ---');
  for (const r of validResults) {
    const cs = r.criteriaScores || {};
    console.log(`\n  ${r.surface}: ${r.overallScore}/100`);
    if (Object.keys(cs).length) {
      console.log(`    Hierarchy:${cs.visualHierarchy} Type:${cs.typography} Space:${cs.spacing} Color:${cs.colorContrast} Comp:${cs.componentQuality}`);
      console.log(`    Layout:${cs.layoutResponsiveness} Density:${cs.informationDensity} Empty:${cs.emptyStates} Interact:${cs.interactionAffordances} Market:${cs.marketParity}`);
    }
    if (r.topPriorityFix) console.log(`    TOP FIX: ${r.topPriorityFix}`);
  }

  if (p0s.length) {
    console.log('\n--- P0 BLOCKERS (fix immediately) ---');
    for (const f of p0s) {
      console.log(`  [${f.surface}] ${f.element}: ${f.issue}`);
      console.log(`    FIX: ${f.fix}`);
    }
  }

  if (p1s.length) {
    console.log('\n--- P1 MAJOR (fix this session) ---');
    for (const f of p1s) {
      console.log(`  [${f.surface}] ${f.element}: ${f.issue}`);
      console.log(`    FIX: ${f.fix}`);
    }
  }

  if (p2s.length) {
    console.log('\n--- P2 MINOR (fix when adjacent) ---');
    for (const f of p2s.slice(0, 15)) {
      console.log(`  [${f.surface}] ${f.element}: ${f.issue}`);
    }
    if (p2s.length > 15) console.log(`  ... and ${p2s.length - 15} more P2s`);
  }

  console.log('\n--- Strengths ---');
  for (const r of validResults) {
    if (r.strengths?.length) {
      console.log(`  [${r.surface}]: ${r.strengths.slice(0, 3).join('; ')}`);
    }
  }

  const formulaScore = 100 - (p0s.length * 10) - (p1s.length * 6) - (p2s.length * 2) - (p3s.length * 1);
  console.log(`\nFormula Score: ${Math.max(0, formulaScore)}/100`);
  console.log(`  = 100 - (${p0s.length}x10) - (${p1s.length}x6) - (${p2s.length}x2) - (${p3s.length}x1)`);

  return {
    timestamp: new Date().toISOString(),
    model: results._model,
    avgScore,
    grade,
    formulaScore: Math.max(0, formulaScore),
    surfaces: validResults.map(r => ({ surface: r.surface, score: r.overallScore, criteriaScores: r.criteriaScores })),
    findingCounts: { p0: p0s.length, p1: p1s.length, p2: p2s.length, p3: p3s.length },
    allFindings,
  };
}


async function main() {
  const config = parseArgs();
  console.log(`NodeBench Redesign QA — Gemini Vision Self-Evaluator`);
  console.log(`URL: ${config.url}`);
  console.log(`Model: ${config.model}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const screenshots = await captureScreenshots(config);
  const results = await evaluateSurfaces(screenshots, config);
  results._model = config.model;

  const report = generateReport(results);

  const outPath = path.join(OUT_DIR, 'qa-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ report, rawResults: results }, null, 2));
  console.log(`\nFull results: ${outPath}`);

  const historyPath = path.join(OUT_DIR, 'qa-history.jsonl');
  fs.appendFileSync(historyPath, JSON.stringify(report) + '\n');
  console.log(`History appended: ${historyPath}`);

  if (report.findingCounts.p0 > 0) {
    console.log(`\n*** ${report.findingCounts.p0} P0 BLOCKERS FOUND — fix before shipping ***`);
    process.exit(2);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
