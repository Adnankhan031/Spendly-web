/**
 * Compare the free vision models on YOUR receipts.
 *
 * I picked dots-3-note-preview as the default because it is the only free
 * vision model with strict structured output, but none of these models existed
 * when I was trained and I have never seen one read half-width katakana off
 * thermal paper. This settles it with evidence instead.
 *
 *   OPENROUTER_API_KEY=sk-or-... npx tsx scripts/model-bakeoff.ts receipt.jpg
 *
 * The key is read from the environment and never written anywhere.
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const MODELS = [
  'dots-studio/dots-3-note-preview:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'minimax/minimax-m3:free',
];

const SYSTEM = `You read supermarket and convenience-store receipts, including Japanese ones.

Return every purchased line item with its price. Rules:
- Prices are integers in MINOR units (1150 yen is 1150).
- Copy the product name EXACTLY as printed, including half-width katakana.
- A line with a quantity ("2点 x 198") is ONE item; give the line total.
- EXCLUDE 小計, 合計, tax lines, お預り, お釣り, points, and payment lines.
- INCLUDE 値引 / 割引 discounts as items with a NEGATIVE amount.
- merchant: the shop name. purchased_on: YYYY-MM-DD or null. total: the printed 合計.

Reply with JSON only: {"merchant":…,"purchased_on":…,"total":…,"items":[{"name":…,"amount_minor":…}]}`;

const key = process.env.OPENROUTER_API_KEY;
const file = process.argv[2];

if (!key) {
  console.error('Set OPENROUTER_API_KEY in the environment first.');
  process.exit(1);
}
if (!file) {
  console.error('Usage: npx tsx scripts/model-bakeoff.ts <receipt.jpg>');
  process.exit(1);
}

const mime = extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,${readFileSync(file).toString('base64')}`;
const sizeKb = Math.round(dataUrl.length / 1024);

console.log(`\nReceipt: ${basename(file)}  (~${sizeKb}KB encoded)\n`);

type Item = { name: string; amount_minor: number };

function parse(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(body.slice(a, b + 1));
  } catch {
    return null;
  }
}

for (const model of MODELS) {
  const started = Date.now();
  process.stdout.write(`── ${model}\n`);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Spendly bakeoff' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read this receipt.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 4000,
        temperature: 0,
      }),
    });

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (!res.ok) {
      console.log(`   ✗ HTTP ${res.status} in ${secs}s — ${(await res.text()).slice(0, 160)}\n`);
      continue;
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? '';
    const parsed = parse(String(content));
    if (!parsed?.items?.length) {
      console.log(`   ✗ no items parsed in ${secs}s\n`);
      continue;
    }

    const items: Item[] = parsed.items;
    const sum = items.reduce((a, i) => a + (Number(i.amount_minor) || 0), 0);
    const total = Number(parsed.total) || 0;

    console.log(`   ${items.length} items in ${secs}s   merchant: ${parsed.merchant ?? '—'}   date: ${parsed.purchased_on ?? '—'}`);
    console.log(`   items sum ${sum}   printed total ${total}   ${total ? `gap ${total - sum}` : ''}`);
    for (const i of items.slice(0, 14)) {
      console.log(`     ${String(i.amount_minor).padStart(8)}  ${i.name}`);
    }
    if (items.length > 14) console.log(`     … ${items.length - 14} more`);
    console.log();
  } catch (e) {
    console.log(`   ✗ ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

console.log('Pick whichever read your receipt most accurately, and tell me — I will');
console.log('make it the default in supabase/functions/read-receipt/index.ts.\n');
