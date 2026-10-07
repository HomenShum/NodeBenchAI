// tests/linkupSmoke.mjs
import { LinkupClient } from 'linkup-sdk';

const apiKey = process.env.LINKUP_API_KEY || process.env.NEXT_PUBLIC_LINKUP_API_KEY;
if (!apiKey) {
  console.error('Missing LINKUP_API_KEY');
  process.exit(1);
}

const client = new LinkupClient({ apiKey });

try {
  const res = await client.search({
    query: "What is Microsoft's 2024 revenue?",
    depth: 'deep',
    outputType: 'sourcedAnswer',
  });
  console.log(JSON.stringify({
    answer: res?.answer || null,
    nSources: Array.isArray(res?.sources) ? res.sources.length : 0,
    first: Array.isArray(res?.sources) ? res.sources[0] : null,
  }, null, 2));
} catch (e) {
  console.error('Linkup error:', e?.message || e);
  process.exit(2);
}

