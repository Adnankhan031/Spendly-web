'use client';

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
 * The function holds the OpenRouter key, so nothing secret is in this bundle,
 * and the model can change server-side without shipping a new version.
 */
export async function readReceipt(dataUrl: string): Promise<ScannedReceipt> {
  const { data, error } = await supabaseBrowser().functions.invoke('read-receipt', {
    body: { image: dataUrl },
  });

  if (error) {
    // The function's own error body is more useful than "non-2xx status".
    const detail = await extractMessage(error);
    throw new Error(detail ?? 'Could not reach the receipt reader.');
  }
  if (!data || typeof data !== 'object') throw new Error('The receipt reader returned nothing.');
  if ('error' in data) throw new Error(String((data as { error: string }).error));

  return data as ScannedReceipt;
}

async function extractMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      /* fall through to the generic message */
    }
  }
  return error instanceof Error ? error.message : null;
}
