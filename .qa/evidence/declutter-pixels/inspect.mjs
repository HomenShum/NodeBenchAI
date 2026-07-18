import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
await page.goto('https://www.nodebenchai.com/agents', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(1200);

const result = await page.evaluate(() => {
  const labels = [
    'Agents',
    'Workspace',
    'AI Assistants',
    'Research',
    'Compare Sources',
    'Market Analysis',
    'Media Scan',
    'TOPIC-FIRST WORKSPACE',
    'Topics, not sessions',
    'Canvas memory',
    'Hot-plug resources',
    'Self-directed next move',
    'Reply with exactly TIER_OK and nothing else.',
    'Open trace',
    'Object-first mode',
  ];

  const records = [];
  for (const label of labels) {
    const matches = [...document.querySelectorAll('body *')].filter(
      (element) => element.children.length === 0 && element.textContent?.trim() === label,
    );
    for (const element of matches) {
      const interactive = element.closest('button,a,input,textarea,select,[role="button"],[tabindex]');
      const rect = element.getBoundingClientRect();
      records.push({
        label,
        count: matches.length,
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : '',
        parentTag: element.parentElement?.tagName.toLowerCase() ?? null,
        parentClass: typeof element.parentElement?.className === 'string' ? element.parentElement.className : '',
        interactiveTag: interactive?.tagName.toLowerCase() ?? null,
        interactiveRole: interactive?.getAttribute('role') ?? null,
        interactiveClass: typeof interactive?.className === 'string' ? interactive.className : '',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
    }
  }

  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };

  return {
    title: document.title,
    bodyTextLength: document.body.innerText.length,
    visibleInteractiveCount: [...document.querySelectorAll('button,a,input,textarea,select,[role="button"],[tabindex]')].filter(visible).length,
    visibleButtonCount: [...document.querySelectorAll('button')].filter(visible).length,
    visibleHeadingCount: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(visible).length,
    repeatedTierOkCount: (document.body.innerText.match(/Reply with exactly TIER_OK and nothing else\./g) ?? []).length,
    records,
  };
});

console.log(JSON.stringify(result, null, 2));

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(1200);
const mobile = await page.evaluate(() => {
  const exact = (label) => [...document.querySelectorAll('body *')].find(
    (element) => element.textContent?.trim() === label && element.children.length === 0,
  );
  const rectFor = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  };
  const roadmap = exact('Roadmap')?.closest('button');
  const nav = roadmap?.parentElement;
  const hero = exact('AI Assistants')?.closest('h1')?.parentElement;
  const composer = document.querySelector('textarea[aria-label="Message input"]')?.closest('.space-y-3');
  const topicPanel = exact('Topic canvas')?.closest('section');
  const bottomNav = [...document.querySelectorAll('nav')].find((element) => element.innerText.includes('Home') && element.innerText.includes('Reports') && element.innerText.includes('Inbox'));
  return {
    viewport: { width: innerWidth, height: innerHeight },
    documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    tabs: {
      rect: rectFor(nav),
      clientWidth: nav?.clientWidth ?? null,
      scrollWidth: nav?.scrollWidth ?? null,
      scrollLeft: nav?.scrollLeft ?? null,
      roadmap: rectFor(roadmap),
    },
    hero: rectFor(hero),
    composer: rectFor(composer),
    topicPanel: rectFor(topicPanel),
    bottomNav: rectFor(bottomNav),
  };
});
console.log(JSON.stringify({ mobile }, null, 2));
await browser.close();
