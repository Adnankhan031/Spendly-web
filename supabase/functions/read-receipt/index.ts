/**
 * Read a receipt photo into structured line items.
 *
 * Runs as a Supabase Edge Function for two reasons: the OpenRouter key stays
 * server-side (anything shipped to the apps is extractable — the Supabase
 * publishable key can be read out of the APK bundle in seconds), and the model
 * can be swapped here without releasing either app.
 *
 * Deploy:
 *   supabase secrets set OPENROUTER_API_KEY=sk-or-...
 *   supabase functions deploy read-receipt
 */

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Tried in order. The first is the only free vision model with strict
 * structured output, which matters more than size here: it guarantees
 * parseable items instead of prose that has to be scraped.
 */
const MODELS = [
  'dots-studio/dots-3-note-preview:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'minimax/minimax-m3:free',
];

/**
 * Translation is a different job from reading a photo, so it gets its own
 * order. The first is a mixture-of-experts with 3.8B active parameters: small
 * model speed, Google's multilingual training. Short product names do not need
 * a large model, and waiting is worse than a slightly plainer wording.
 */
const TRANSLATE_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'minimax/minimax-m3:free',
];

const TRANSLATE_SYSTEM = `You translate Japanese supermarket product names into English.

- Reply with a JSON array of strings, the same length and order as the input.
- Keep it short: what the thing IS, as a shopper would say it.
  "日清あっさりシーフード" -> "Nissin Assari Seafood Noodles"
  "丸大豆せんべい醤油" -> "Soy Sauce Rice Crackers"
  "芋羊羹カステラ" -> "Sweet Potato Yokan Castella"
- Keep brand names in romaji. Do not add commentary, sizes you cannot see, or
  explanations.
- OCR is imperfect: if a name is garbled, translate what it most likely says.
  If it is unreadable, return the original string unchanged.
- No markdown, no code fences, just the array.`;

const SYSTEM = `You read supermarket and convenience-store receipts, including Japanese ones.

Return every purchased line item with its price. Rules:
- Prices are in the receipt's currency, as integers in MINOR units (yen has no
  minor unit, so 1150 yen is 1150; for currencies with cents, 11.50 is 1150).
- Copy the product name EXACTLY as printed, including half-width katakana.
  Do not translate, expand or tidy it.
- A line with a quantity ("2点 x 198") is ONE item; give the line total.
- EXCLUDE: 小計 subtotal, 合計 total, 税 tax lines, お預り cash tendered,
  お釣り change, ポイント points, and any card or payment lines.
- INCLUDE 値引 / 割引 discount lines as items with a NEGATIVE amount.
- merchant: the shop name, usually at the very top.
- purchased_on: the date on the receipt as YYYY-MM-DD, or null if unreadable.
- total: the printed 合計 total, in minor units.

If the image is not a receipt, return an empty items array.`;

type Item = { name: string; amount_minor: number; qty?: number };
type Parsed = {
  merchant: string | null;
  purchased_on: string | null;
  total: number | null;
  items: Item[];
};

const SCHEMA = {
  type: 'object',
  properties: {
    merchant: { type: ['string', 'null'] },
    purchased_on: { type: ['string', 'null'] },
    total: { type: ['integer', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount_minor: { type: 'integer' },
          qty: { type: 'number' },
        },
        required: ['name', 'amount_minor'],
        additionalProperties: false,
      },
    },
  },
  required: ['merchant', 'purchased_on', 'total', 'items'],
  additionalProperties: false,
};

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

/** Pull the first JSON object out of a reply, for models without strict mode. */
function extractJson(text: string): Parsed | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Parsed;
  } catch {
    return null;
  }
}

/** Thrown so a spent quota is reported as such, not as an unreadable receipt. */
class RateLimited extends Error {
  constructor(public model: string, public retryAfter: string | null) {
    super('rate limited');
  }
}

async function callModel(model: string, key: string, dataUrl: string): Promise<Parsed | null> {
  const res = await fetch(OPENROUTER, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Spendly',
    },
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
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'receipt', strict: true, schema: SCHEMA },
      },
      max_tokens: 4000,
      temperature: 0,
    }),
  });

  if (res.status === 429) {
    // Free models have a daily cap. Trying the next one is still worth doing —
    // the limits are per-model — but if they are all spent the user needs to be
    // told that, not that their photo was unreadable.
    throw new RateLimited(model, res.headers.get('retry-after'));
  }

  if (!res.ok) {
    console.error(`${model} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    return null;
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;

  const parsed = extractJson(content);
  if (!parsed || !Array.isArray(parsed.items)) return null;

  // Keep only lines that actually carry a number, and cap the size so a
  // hallucinating model cannot flood the client.
  parsed.items = parsed.items
    .filter((i) => i && typeof i.name === 'string' && Number.isFinite(i.amount_minor))
    .slice(0, 200);

  return parsed;
}

/** Translate a batch of names, preserving order and length. */
async function translate(model: string, key: string, names: string[]): Promise<string[] | null> {
  const res = await fetch(OPENROUTER, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Spendly' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: TRANSLATE_SYSTEM },
        { role: 'user', content: JSON.stringify(names) },
      ],
      max_tokens: 2000,
      temperature: 0,
    }),
  });

  if (res.status === 429) throw new RateLimited(model, res.headers.get('retry-after'));
  if (!res.ok) {
    console.error(`${model} translate -> ${res.status}`);
    return null;
  }

  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1] : content;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;

  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    // Pad or trim, so the caller can always zip it back against the input.
    return names.map((original, i) => {
      const t = arr[i];
      return typeof t === 'string' && t.trim() ? t.trim() : original;
    });
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors(origin), 'Content-Type': 'application/json' },
    });

  const key = Deno.env.get('OPENROUTER_API_KEY');
  if (!key) return json({ error: 'OPENROUTER_API_KEY is not set on this project.' }, 500);

  let image: string | undefined;
  let names: unknown;
  try {
    ({ image, names } = await req.json());
  } catch {
    return json({ error: 'Send { image: "data:image/jpeg;base64,..." } or { names: [...] }' }, 400);
  }

  // Translation mode: one request for a whole receipt, never one per item.
  if (Array.isArray(names)) {
    const list = names.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).slice(0, 120);
    if (!list.length) return json({ translations: [] });

    for (const model of TRANSLATE_MODELS) {
      try {
        const out = await translate(model, key, list);
        if (out) return json({ translations: out, model });
      } catch (e) {
        if (e instanceof RateLimited) continue;
        console.error(`${model} translate threw`, e);
      }
    }
    return json({ error: 'Could not translate right now.', translations: null }, 502);
  }
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return json({ error: 'image must be a data URL' }, 400);
  }
  // ~8MB of base64. Clients resize before sending; this is a backstop.
  if (image.length > 8_000_000) return json({ error: 'Image too large — resize before sending.' }, 413);

  const tried: string[] = [];
  let limited = 0;
  let retryAfter: string | null = null;

  for (const model of MODELS) {
    tried.push(model);
    try {
      const parsed = await callModel(model, key, image);
      if (parsed && parsed.items.length > 0) return json({ ...parsed, model, tried });
    } catch (e) {
      if (e instanceof RateLimited) {
        limited += 1;
        retryAfter = retryAfter ?? e.retryAfter;
        continue;
      }
      console.error(`${model} threw`, e);
    }
  }

  if (limited === MODELS.length) {
    return json(
      {
        error:
          'The free daily limit is used up on every model. It resets on the OpenRouter schedule; add the lines by hand in the meantime.',
        rateLimited: true,
        retryAfter,
        tried,
      },
      429
    );
  }

  if (limited > 0) {
    return json({ error: `No model could read this receipt (${limited} were rate limited).`, tried }, 502);
  }

  return json({ error: 'No model could read this receipt.', tried }, 502);
});
