import { chromium } from 'playwright';
import path from 'node:path';

const outDir = 'D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/nodebench-ai/.qa/evidence/declutter-pixels';
const browser = await chromium.launch();
const shots = [
  ['fast-panel-desktop-light', 'light', { width: 1512, height: 982 }],
  ['fast-panel-desktop-dark', 'dark', { width: 1512, height: 982 }],
  ['fast-panel-mobile-light', 'light', { width: 390, height: 844 }],
  ['fast-panel-mobile-dark', 'dark', { width: 390, height: 844 }],
];

for (const [name, colorScheme, viewport] of shots) {
  const context = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto('https://www.nodebenchai.com/agents', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  await page.keyboard.press('Control+J');
  const panel = page.getByRole('complementary', { name: 'Ask NodeBench assistant' });
  await panel.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1400);
  const evidence = await panel.evaluate((element) => {
    const visible = (candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const buttons = [...element.querySelectorAll('button')].filter(visible);
    const text = element.innerText;
    return {
      textLength: text.length,
      visibleButtonCount: buttons.length,
      visibleButtonLabels: buttons.map((button) => button.innerText.trim() || button.getAttribute('aria-label') || button.getAttribute('title')).filter(Boolean),
      headings: [...element.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(visible).map((heading) => heading.textContent?.trim()).filter(Boolean),
      excerpt: text.slice(0, 1500),
    };
  });
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(JSON.stringify({ name, evidence }));
  await context.close();
}

await browser.close();
