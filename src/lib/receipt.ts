'use client';

import { foldJa } from './jp';
import { supabaseBrowser } from './supabase/client';

export type ScannedItem = { name: string; amount_minor: number; qty?: number };
export type ScannedReceipt = {
  merchant: string | null;
  purchased_on: string | null;
  total: number | null;
  items: ScannedItem[];
  model?: string;
};

/**
 * Shrink a photo before it is sent.
 *
 * A modern phone camera produces 3–6MB, which is slow on mobile data and mostly
 * wasted — receipt text stops gaining legibility well below full sensor
 * resolution. 1600px on the long edge keeps small print readable while landing
 * around 200–400KB.
 */
export async function compressImage(file: File, maxEdge = 1600, quality = 0.75): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read that image.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Send a receipt photo to the Edge Function and get its lines back.
 *
 * Deliberately plain fetch rather than `functions.invoke`. The client wraps any
 * non-2xx as "Edge Function returned a non-2xx status code" and throws the body
 * away, so a spent quota, an oversized image and an unreadable photo all looked
 * identical and none of them told you what to do. The function already returns
 * a precise reason; this keeps it.
 */
export async function readReceipt(dataUrl: string): Promise<ScannedReceipt> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase is not configured for this deployment.');

  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token ?? key;

  let res: Response;
  try {
    res = await fetch(`${url}/functions/v1/read-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
  } catch {
    throw new Error('No connection. The receipt reader needs the internet.');
  }

  const body = await res.text();
  let parsed: (ScannedReceipt & { error?: string }) | null = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* not JSON — fall through to the status-based message */
  }

  if (!res.ok) {
    if (parsed?.error) throw new Error(parsed.error);
    if (res.status === 404) throw new Error('The read-receipt function is not deployed on this project.');
    if (res.status === 401 || res.status === 403) throw new Error('Sign in again — the session was rejected.');
    throw new Error(`The receipt reader failed (${res.status}). ${body.slice(0, 140)}`);
  }

  if (!parsed) throw new Error('The receipt reader returned something unreadable.');
  if (parsed.error) throw new Error(parsed.error);

  /**
   * The model reports the printed amount; the app stores minor units.
   *
   * Everything else in this codebase treats amount_minor as the printed value
   * times one hundred, so returning raw yen made a ¥1,160 line show as 11.60.
   * Converting here keeps the function's contract simple — it reports what the
   * paper says — without a redeploy.
   */
  return {
    ...parsed,
    total: parsed.total === null || parsed.total === undefined ? null : Math.round(parsed.total * 100),
    items: (parsed.items ?? []).map((i) => ({ ...i, amount_minor: Math.round(i.amount_minor * 100) })),
  };
}

/* ------------------------------------------------------------------ */
/* translation                                                         */
/* ------------------------------------------------------------------ */

const CACHE_KEY = 'spendly.translations';

/**
 * Translations already known, kept in the browser.
 *
 * A translation never changes and the same products come back every shop, so
 * caching turns a rationed request into a one-off cost. localStorage rather
 * than a table because it needs no migration and is per-browser anyway; every
 * read and write is guarded, since private windows and blocked site data both
 * make the accessor throw rather than return nothing.
 */
function readCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeCache(entries: Record<string, string>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch {
    // Full, private, or blocked. The translation still worked this once.
  }
}

export type TranslationOutcome = {
  translations: Map<string, string>;
  problem: 'quota' | 'offline' | 'failed' | null;
  untranslated: number;
};

/**
 * English for a receipt's items: cache first, then one request for the rest.
 *
 * A whole receipt costs a single request rather than one per line, and never
 * throws — a translation is a nicety, and losing it must not stop a receipt
 * being saved.
 */
export async function translateNames(names: string[]): Promise<TranslationOutcome> {
  const result = new Map<string, string>();
  if (!names.length) return { translations: result, problem: null, untranslated: 0 };

  const cache = readCache();
  for (const n of names) {
    const hit = cache[foldJa(n)];
    if (hit) result.set(n, hit);
  }

  const missing = [...new Set(names.filter((n) => !result.has(n) && n.trim()))];
  if (!missing.length) return { translations: result, problem: null, untranslated: 0 };

  let problem: TranslationOutcome['problem'] = null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('unconfigured');

    const { data } = await supabaseBrowser().auth.getSession();
    const token = data.session?.access_token ?? key;

    const res = await fetch(`${url}/functions/v1/read-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: missing }),
    });

    if (!res.ok) {
      problem = res.status === 429 ? 'quota' : 'failed';
    } else {
      const body = await res.json();
      const list: unknown = body?.translations;
      if (Array.isArray(list)) {
        const next = { ...cache };
        missing.forEach((original, i) => {
          const en = list[i];
          // Unchanged means the model could not read it; not worth caching.
          if (typeof en !== 'string' || !en.trim() || en.trim() === original) return;
          result.set(original, en.trim());
          next[foldJa(original)] = en.trim();
        });
        writeCache(next);
      } else {
        problem = 'failed';
      }
    }
  } catch {
    problem = 'offline';
  }

  const untranslated = names.filter((n) => !result.has(n)).length;
  return { translations: result, problem: untranslated > 0 ? (problem ?? 'failed') : null, untranslated };
}

/** Plain wording for why some lines are still in Japanese. */
export function translationNote(outcome: TranslationOutcome): string | null {
  if (!outcome.problem || outcome.untranslated === 0) return null;
  const n = outcome.untranslated;
  const lines = `${n} ${n === 1 ? 'line is' : 'lines are'} still in Japanese`;
  if (outcome.problem === 'quota') return `${lines} — the daily limit is used up.`;
  if (outcome.problem === 'offline') return `${lines} — no connection.`;
  return `${lines} — translation is unavailable right now.`;
}
