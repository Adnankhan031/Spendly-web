'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Button, Chip, Sheet, cx } from './ui';
import { CategoryIcon } from '@/lib/icons';
import { useStore } from '@/lib/store';
import * as q from '@/lib/queries';
import { classifyItem } from '@/lib/classify';
import { toMinor } from '@/lib/format';
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
export function ItemsEditor({
  open,
  txn,
  onClose,
}: {
  open: boolean;
  txn: TxnView | null;
  onClose: () => void;
}) {
  const { categories, subCategories, currency, fmt, user, refresh } = useStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

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
    if (!open || !txn) return;
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
  }, [open, txn]);

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

  const itemTotal = rows.reduce((a, r) => a + toMinor(Number(r.amount || '0')), 0);
  const gap = (txn?.amount_minor ?? 0) - itemTotal;
  const filled = rows.filter((r) => r.name.trim() && Number(r.amount) > 0);

  const save = async () => {
    if (!txn) return;
    setBusy(true);
    try {
      await q.replaceItems(
        user.id,
        txn.id,
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
                              x.uid === r.uid ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, '') } : x
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
                <span className="tabular font-semibold">{fmt(txn?.amount_minor ?? 0)}</span>
              </div>
              <div
                className={cx(
                  'mt-2 flex justify-between border-t border-line pt-2 font-bold',
                  gap === 0 ? 'text-up' : Math.abs(gap) > (txn?.amount_minor ?? 0) * 0.35 ? 'text-down' : 'text-dim'
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
