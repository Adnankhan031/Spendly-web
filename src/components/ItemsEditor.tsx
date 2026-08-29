'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Camera, ImagePlus, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Button, Chip, Sheet, cx } from './ui';
import { CategoryIcon } from '@/lib/icons';
import { useStore } from '@/lib/store';
import * as q from '@/lib/queries';
import { classifyItem } from '@/lib/classify';
import { toMinor } from '@/lib/format';
import { compressImage, readReceipt } from '@/lib/receipt';
import type { Category, TxnView } from '@/lib/types';

type Row = {
  /** Local key only — rows are replaced wholesale on save. */
  uid: string;
  name: string;
  amount: string;
  categoryId: string | null;
  /** True once the user has picked a category by hand, so re-typing the name
   *  never silently overwrites their decision. */
  pinned: boolean;
  auto: boolean;
};

/** Digits, one dot, and a leading minus for discount lines. */
function cleanAmount(v: string): string {
  const negative = v.trim().startsWith('-');
  const digits = v.replace(/[^0-9.]/g, '');
  return negative ? `-${digits}` : digits;
}

let seq = 0;
const newRow = (): Row => ({ uid: `r${seq++}`, name: '', amount: '', categoryId: null, pinned: false, auto: false });

/**
 * Break a receipt into its lines.
 *
 * The transaction keeps the total; these rows only say what was inside it. The
 * sum is shown against the total at all times, and any difference is labelled
 * rather than absorbed — Japanese receipts carry tax and 値引 discounts on their
 * own lines, so the items genuinely do not add up to the total, and pretending
 * otherwise would make every figure slightly wrong.
 */
/**
 * A receipt read from a photo, before it is anything in the database.
 *
 * Scanning from the composer has no transaction to attach to yet, so the whole
 * receipt is held here until the user confirms. Nothing is written until save.
 */
export type ReceiptDraft = {
  merchant: string | null;
  date: string;
  total: number;
  lines: { name: string; amount_minor: number }[];
};

export function ItemsEditor({
  open,
  txn,
  draft,
  onClose,
}: {
  open: boolean;
  txn: TxnView | null;
  draft?: ReceiptDraft | null;
  onClose: () => void;
}) {
  const { categories, subCategories, currency, fmt, user, refresh } = useStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const galleryRef = React.useRef<HTMLInputElement>(null);

  const byId = useMemo(
    () => new Map<string, Category>([...categories, ...subCategories].map((c) => [c.id, c])),
    [categories, subCategories]
  );

  /** Classifier context: the shipped dictionary plus this account's keywords. */
  const ctx = useMemo(
    () => ({ categories: categories.map((c) => ({ key: c.key, keywords: c.keywords })) }),
    [categories]
  );
  const byKey = useMemo(
    () => new Map([...categories, ...subCategories].map((c) => [c.key, c])),
    [categories, subCategories]
  );

  useEffect(() => {
    if (!open) return;

    if (!txn && draft) {
      setRows(
        draft.lines.map((l) => {
          const hit = classifyItem(l.name, ctx);
          const key = hit.subKey ?? hit.categoryKey;
          const cat = key ? byKey.get(key) : undefined;
          return {
            uid: `d${seq++}`,
            name: l.name,
            amount: String(l.amount_minor / 100),
            categoryId: cat?.id ?? null,
            pinned: false,
            auto: !!cat,
          };
        })
      );
      return;
    }

    if (!txn) return;
    setLoading(true);
    q.fetchItems(txn.id)
      .then((items) => {
        setRows(
          items.length
            ? items.map((it) => ({
                uid: it.id,
                name: it.name,
                amount: String(it.amount_minor / 100),
                categoryId: it.category_id,
                pinned: true,
                auto: false,
              }))
            : [newRow()]
        );
      })
      .catch(() => setRows([newRow()]))
      .finally(() => setLoading(false));
  }, [open, txn, draft]);

  /** Guess a category from the product name, unless the user has set one. */
  const classify = (uid: string) => {
    setRows((rs) =>
      rs.map((r) => {
        if (r.uid !== uid || r.pinned || !r.name.trim()) return r;
        const hit = classifyItem(r.name, ctx);
        const key = hit.subKey ?? hit.categoryKey;
        const cat = key ? byKey.get(key) : undefined;
        return cat ? { ...r, categoryId: cat.id, auto: true } : r;
      })
    );
  };

  /**
   * Photograph the bill and let the model split it.
   *
   * Every line still lands in the same editable rows, unsaved, so a misread
   * price is corrected here rather than discovered in next month's totals.
   */
  const scan = async (file: File) => {
    setScanning(true);
    setScanError(null);
    setScanNote(null);
    try {
      const dataUrl = await compressImage(file);
      const receipt = await readReceipt(dataUrl);

      if (!receipt.items.length) {
        setScanError('No line items found. Try a straighter, brighter photo.');
        return;
      }

      // Classify as the rows are built, so most arrive already sorted.
      const scanned: Row[] = receipt.items.map((it) => {
        const hit = classifyItem(it.name, ctx);
        const key = hit.subKey ?? hit.categoryKey;
        const cat = key ? byKey.get(key) : undefined;
        return {
          uid: `s${seq++}`,
          name: it.name,
          amount: String(it.amount_minor / 100),
          categoryId: cat?.id ?? null,
          pinned: false,
          auto: !!cat,
        };
      });

      // Replace empty starter rows; append to anything already typed.
      setRows((rs) => {
        const kept = rs.filter((r) => r.name.trim() || Number(r.amount) > 0);
        return [...kept, ...scanned];
      });

      const named = scanned.filter((r) => r.categoryId).length;
      setScanNote(
        `${scanned.length} lines read${receipt.merchant ? ` from ${receipt.merchant}` : ''} · ` +
          `${named} categorised automatically`
      );
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Could not read that photo.');
    } finally {
      setScanning(false);
      // Clear both, or picking the same file twice fires no change event.
      if (cameraRef.current) cameraRef.current.value = '';
      if (galleryRef.current) galleryRef.current.value = '';
    }
  };

  const itemTotal = rows.reduce((a, r) => a + toMinor(Number(r.amount || '0')), 0);
  const receiptTotal = txn?.amount_minor ?? draft?.total ?? 0;
  const gap = receiptTotal - itemTotal;
  // Non-zero, not positive: a 値引 discount is a real line with a negative
  // amount. Requiring > 0 displayed it and then dropped it on save, which is
  // the worst of both — the basket looked itemised and silently was not.
  const filled = rows.filter((r) => r.name.trim() && Number(r.amount) !== 0);

  const save = async () => {
    setBusy(true);
    try {
      let targetId = txn?.id ?? null;

      if (!targetId && draft) {
        // File the receipt under whichever category the basket is mostly made
        // of, so it lands somewhere sensible before the user reviews it.
        const weight = new Map<string, number>();
        for (const r of filled) {
          const cat = r.categoryId ? byId.get(r.categoryId) : undefined;
          const parent = cat?.parent_key ?? cat?.key;
          if (parent) weight.set(parent, (weight.get(parent) ?? 0) + Math.abs(Number(r.amount) || 0));
        }
        const dominant = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const catId =
          categories.find((c) => c.key === dominant)?.id ??
          categories.find((c) => c.key === 'groceries')?.id ??
          categories.find((c) => c.key === 'other')?.id ??
          categories[0]?.id ??
          '';

        const created = await q.insertTxn(user.id, {
          amount_minor: draft.total > 0 ? draft.total : Math.round(itemTotal),
          type: 'expense',
          category_id: catId,
          local_date: draft.date,
          note: draft.merchant,
          source: 'manual',
          confidence: 0.9,
        });
        targetId = created.id;
      }

      if (!targetId) return;

      await q.replaceItems(
        user.id,
        targetId,
        filled.map((r) => ({
          name: r.name.trim(),
          amount_minor: toMinor(Number(r.amount)),
          category_id: r.categoryId,
          confidence: r.auto ? 0.9 : 1,
        }))
      );
      await refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title="What was in it?">
        {loading ? (
          <p className="py-6 text-center text-[13px] text-dim">Loading…</p>
        ) : (
          <>
            {/*
              Two inputs, not one. `capture` forces the camera on a phone and
              removes the gallery option altogether, so a receipt photographed
              earlier could not be used. Without `capture` a phone offers the
              gallery and the files app.
            */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void scan(f);
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void scan(f);
              }}
            />

            <div className="flex gap-2">
              <button
                type="button"
                disabled={scanning}
                onClick={() => cameraRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[14px] font-bold text-on-brand transition active:scale-[0.99] disabled:opacity-60"
              >
                {scanning ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                {scanning ? 'Reading…' : 'Scan a receipt'}
              </button>
              <button
                type="button"
                disabled={scanning}
                aria-label="Choose a photo"
                onClick={() => galleryRef.current?.click()}
                className="grid shrink-0 place-items-center rounded-xl border border-line bg-sunken px-4 text-dim transition active:scale-95 disabled:opacity-60"
              >
                <ImagePlus size={17} />
              </button>
            </div>

            {scanError && (
              <p className="rounded-xl border border-down/40 bg-down-soft px-3 py-2 text-[12.5px] text-down">
                {scanError}
              </p>
            )}
            {scanNote && !scanError && (
              <p className="rounded-xl border border-line bg-sunken px-3 py-2 text-[12.5px] text-dim">
                {scanNote} — check the prices before saving.
              </p>
            )}

            <div className="flex flex-col gap-2">
              {rows.map((r) => {
                const cat = r.categoryId ? byId.get(r.categoryId) : undefined;
                return (
                  <div key={r.uid} className="rounded-xl border border-line bg-sunken p-2.5">
                    <div className="flex items-center gap-2">
                      <input
                        value={r.name}
                        onChange={(e) =>
                          setRows((rs) => rs.map((x) => (x.uid === r.uid ? { ...x, name: e.target.value } : x)))
                        }
                        onBlur={() => classify(r.uid)}
                        placeholder="Item"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className="min-w-0 flex-1 bg-transparent text-[14.5px] font-semibold outline-none"
                      />
                      <span className="text-[13px] text-faint">{currency.symbol}</span>
                      <input
                        value={r.amount}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((x) =>
                              x.uid === r.uid ? { ...x, amount: cleanAmount(e.target.value) } : x
                            )
                          )
                        }
                        inputMode="decimal"
                        placeholder="0"
                        autoComplete="off"
                        className="tabular w-[86px] shrink-0 bg-transparent text-right text-[14.5px] font-bold outline-none"
                      />
                      <button
                        type="button"
                        aria-label="Remove line"
                        onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.uid !== r.uid) : [newRow()]))}
                        className="shrink-0 p-1 text-faint transition active:scale-90"
                      >
                        <X size={15} />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setPicking(r.uid)}
                      className="mt-1.5 flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-left"
                      style={{ color: cat?.color ?? 'var(--color-faint)' }}
                    >
                      <CategoryIcon name={cat?.icon} size={13} />
                      <span className="text-[11.5px] font-semibold">{cat?.name ?? 'Uncategorised'}</span>
                      {r.auto && !r.pinned && <Sparkles size={11} className="opacity-70" />}
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, newRow()])}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-2.5 text-[13px] font-semibold text-dim transition active:scale-[0.99]"
            >
              <Plus size={15} /> Add line
            </button>

            {/* the arithmetic, always visible, never silently adjusted */}
            <div className="rounded-xl border border-line bg-surface p-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-dim">
                  {filled.length} {filled.length === 1 ? 'line' : 'lines'}
                </span>
                <span className="tabular font-semibold">{fmt(itemTotal)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-dim">Receipt total</span>
                <span className="tabular font-semibold">{fmt(receiptTotal)}</span>
              </div>
              <div
                className={cx(
                  'mt-2 flex justify-between border-t border-line pt-2 font-bold',
                  gap === 0 ? 'text-up' : Math.abs(gap) > receiptTotal * 0.35 ? 'text-down' : 'text-dim'
                )}
              >
                <span>{gap === 0 ? 'Balanced' : gap > 0 ? 'Not accounted for' : 'Over the total'}</span>
                <span className="tabular">{gap === 0 ? '—' : fmt(Math.abs(gap))}</span>
              </div>
              {gap !== 0 && (
                <p className="mt-1.5 text-[11.5px] leading-4 text-faint">
                  {gap > 0
                    ? 'Usually tax or a discount printed on its own line. Leave it — the total stays correct either way.'
                    : 'The lines add up to more than the receipt. Check for a doubled entry.'}
                </p>
              )}
            </div>

            <Button onClick={save} loading={busy}>
              Save {filled.length} {filled.length === 1 ? 'line' : 'lines'}
            </Button>
            {rows.some((r) => r.name || r.amount) && (
              <Button variant="danger" icon={Trash2} onClick={() => setRows([newRow()])} disabled={busy}>
                Clear all lines
              </Button>
            )}
          </>
        )}
      </Sheet>

      <ItemCategoryPicker
        open={!!picking}
        categories={categories}
        subCategories={subCategories}
        onClose={() => setPicking(null)}
        onPick={(id) => {
          setRows((rs) => rs.map((x) => (x.uid === picking ? { ...x, categoryId: id, pinned: true, auto: false } : x)));
          setPicking(null);
        }}
      />
    </>
  );
}

/**
 * Both axes in one list.
 *
 * A receipt line is usually a grocery subcategory, but shampoo on a Gyomu bill
 * belongs to Toiletries, so the real categories have to be reachable too.
 */
function ItemCategoryPicker({
  open,
  categories,
  subCategories,
  onClose,
  onPick,
}: {
  open: boolean;
  categories: Category[];
  subCategories: Category[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  // Not `q` — that is the queries module in this file, and shadowing it here
  // would be a trap for whoever adds a fetch to this picker later.
  const [query, setQuery] = useState('');
  const match = (c: Category) => c.name.toLowerCase().includes(query.trim().toLowerCase());
  const subs = subCategories.filter(match);
  const tops = categories.filter((c) => c.kind === 'expense' && !c.archived && match(c));

  return (
    <Sheet open={open} onClose={onClose} title="Categorise this line">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        autoComplete="off"
        className="w-full rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-[15px] outline-none"
      />

      {subs.length > 0 && (
        <>
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.09em] text-faint">Inside groceries</p>
          <div className="flex flex-wrap gap-2">
            {subs.map((c) => (
              <Chip key={c.id} label={c.name} small onClick={() => onPick(c.id)} />
            ))}
          </div>
        </>
      )}

      {tops.length > 0 && (
        <>
          <p className="mt-1 text-[10.5px] font-extrabold uppercase tracking-[0.09em] text-faint">Other categories</p>
          <div className="flex flex-wrap gap-2">
            {tops.map((c) => (
              <Chip key={c.id} label={c.name} small onClick={() => onPick(c.id)} />
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
