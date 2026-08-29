'use client';

import React, { useEffect, useState } from 'react';
import { CalendarDays, Check, ChevronRight, ReceiptText, Trash2 } from 'lucide-react';
import { Button, Chip, Sheet, cx, inputClass } from './ui';
import { CategoryPicker, DatePicker } from './pickers';
import { ItemsEditor } from './ItemsEditor';
import { IconTile } from '@/lib/icons';
import { useStore } from '@/lib/store';
import * as q from '@/lib/queries';
import { dayLabel, toMinor } from '@/lib/format';
import type { NewTxn, TxnItem, TxnView } from '@/lib/types';

const METHODS = ['Cash', 'Card', 'UPI', 'Bank', 'Wallet'];

export function TxnEditor({
  open,
  txn,
  seed,
  onClose,
}: {
  open: boolean;
  txn?: TxnView | null;
  seed?: Partial<NewTxn>;
  onClose: () => void;
}) {
  const { categories, accounts, currency, pinnedDate, user, refresh, fmt } = useStore();
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(pinnedDate);
  const [method, setMethod] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reimbursable, setReimbursable] = useState(false);
  const [showCat, setShowCat] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const [items, setItems] = useState<TxnItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const fallback = categories.find((c) => c.key === 'other')?.id ?? categories[0]?.id ?? '';
    if (txn) {
      setAmount(String(txn.amount_minor / 100));
      setType(txn.type);
      setCategoryId(txn.category_id ?? fallback);
      setDate(txn.local_date);
      setMethod(txn.method);
      setAccountId(txn.account_id);
      setNote(txn.note ?? '');
      setReimbursable(!!txn.reimbursable);
    } else {
      setAmount(seed?.amount_minor ? String(seed.amount_minor / 100) : '');
      setType(seed?.type ?? 'expense');
      setCategoryId(seed?.category_id ?? fallback);
      setDate(seed?.local_date ?? pinnedDate);
      setMethod(seed?.method ?? null);
      setAccountId(seed?.account_id ?? null);
      setNote(seed?.note ?? '');
      setReimbursable(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, txn?.id]);

  // The breakdown is only a summary here; editing happens in its own sheet.
  useEffect(() => {
    if (!open || !txn) {
      setItems([]);
      return;
    }
    let live = true;
    q.fetchItems(txn.id)
      .then((rows) => live && setItems(rows))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [open, txn, showItems]);

  const category = categories.find((c) => c.id === categoryId);

  const save = async () => {
    const minor = toMinor(Number(amount || '0'));
    if (!minor || minor <= 0) return;
    setBusy(true);
    try {
      // A manual category change is the strongest training signal there is.
      const source = (note || txn?.note || txn?.raw_input || seed?.note || '').toLowerCase();
      const token = source.split(/[^a-z0-9']+/).find((w) => w.length >= 3);
      if (token && (!txn || txn.category_id !== categoryId)) await q.learnAlias(user.id, token, categoryId);

      const body = {
        amount_minor: minor,
        type,
        category_id: categoryId,
        local_date: date,
        method,
        account_id: accountId,
        note: note.trim() || null,
        reimbursable,
      };
      if (txn) await q.updateTxn(txn.id, body);
      else await q.insertTxn(user.id, { ...body, source: 'manual' });

      await refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!txn) return;
    setBusy(true);
    try {
      await q.softDeleteTxn(txn.id);
      await refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={txn ? 'Edit entry' : 'New entry'}>
        <div className="flex gap-2">
          <Chip label="Expense" active={type === 'expense'} onClick={() => setType('expense')} />
          <Chip label="Income" active={type === 'income'} onClick={() => setType('income')} />
        </div>

        <div
          className={cx(
            'flex items-center rounded-2xl border px-4 transition',
            type === 'income' ? 'border-up/40 bg-up-soft/40' : 'border-line bg-sunken'
          )}
        >
          <span className={cx('text-2xl font-bold', type === 'income' ? 'text-up' : 'text-dim')}>
            {currency.symbol}
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            placeholder="0"
            autoFocus={!txn}
            className={cx(
              'tabular w-full bg-transparent px-2 py-4 text-[34px] font-extrabold outline-none',
              type === 'income' && 'text-up'
            )}
          />
        </div>

        <button
          type="button"
          onClick={() => setShowCat(true)}
          className="flex items-center gap-3 rounded-xl border border-line bg-sunken p-3 text-left transition active:scale-[0.99]"
        >
          <IconTile name={category?.icon} color={category?.color ?? '#8a9099'} size={36} />
          <span className="flex-1 text-[15px] font-semibold">{category?.name ?? 'Choose category'}</span>
          <ChevronRight size={17} className="text-faint" />
        </button>

        <button
          type="button"
          onClick={() => setShowDate(true)}
          className="flex items-center gap-3 rounded-xl border border-line bg-sunken p-3.5 text-left transition active:scale-[0.99]"
        >
          <CalendarDays size={19} className="text-dim" />
          <span className="flex-1 text-[15px] font-semibold">{dayLabel(date)}</span>
          <ChevronRight size={17} className="text-faint" />
        </button>

        <div className="flex flex-wrap gap-2">
          {METHODS.map((m) => (
            <Chip key={m} label={m} small active={method === m} onClick={() => setMethod(method === m ? null : m)} />
          ))}
        </div>

        {accounts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <Chip
                key={a.id}
                label={a.name}
                small
                active={accountId === a.id}
                onClick={() => setAccountId(accountId === a.id ? null : a.id)}
              />
            ))}
          </div>
        )}

        {/* Itemising is only offered on a saved expense — there is no id to hang
            the lines off until the transaction exists. */}
        {txn && type === 'expense' && (
          <button
            type="button"
            onClick={() => setShowItems(true)}
            className="flex items-center gap-3 rounded-xl border border-line bg-sunken p-3.5 text-left transition active:scale-[0.99]"
          >
            <ReceiptText size={19} className="text-dim" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">
                {items.length ? `${items.length} ${items.length === 1 ? 'line' : 'lines'}` : 'Itemise this receipt'}
              </span>
              <span className="mt-0.5 block text-[11.5px] text-dim">
                {items.length
                  ? itemSummary(items, txn.amount_minor, fmt)
                  : 'Break it into what you actually bought'}
              </span>
            </span>
            <ChevronRight size={17} className="text-faint" />
          </button>
        )}

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className={inputClass}
        />

        <button
          type="button"
          onClick={() => setReimbursable((v) => !v)}
          className={cx(
            'flex items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99]',
            reimbursable ? 'border-up bg-up-soft' : 'border-line bg-sunken'
          )}
        >
          <span
            className={cx(
              'grid size-5 shrink-0 place-items-center rounded-md border-2',
              reimbursable ? 'border-up bg-up text-white' : 'border-line-strong'
            )}
          >
            {reimbursable && <Check size={13} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">I get this back</span>
            <span className="mt-0.5 block text-[11.5px] text-dim">
              Reimbursable — tracked until it is paid back
            </span>
          </span>
        </button>

        <Button onClick={save} loading={busy} disabled={!Number(amount)}>
          {txn ? 'Save changes' : 'Add entry'}
        </Button>
        {txn && (
          <Button variant="danger" onClick={remove} disabled={busy} icon={Trash2}>
            Delete
          </Button>
        )}
      </Sheet>

      <CategoryPicker
        open={showCat}
        categories={categories}
        value={categoryId}
        kind={type}
        onClose={() => setShowCat(false)}
        onPick={(id) => {
          if (id) setCategoryId(id);
          setShowCat(false);
        }}
      />
      <ItemsEditor open={showItems} txn={txn ?? null} onClose={() => setShowItems(false)} />
      <DatePicker
        open={showDate}
        value={date}
        onClose={() => setShowDate(false)}
        onPick={(d) => {
          setDate(d);
          setShowDate(false);
        }}
      />
    </>
  );
}

/** One line describing how much of the receipt is accounted for. */
function itemSummary(items: TxnItem[], total: number, fmt: (m: number) => string): string {
  const sum = items.reduce((a, i) => a + i.amount_minor, 0);
  const gap = total - sum;
  if (gap === 0) return `${fmt(sum)} — balanced`;
  if (gap > 0) return `${fmt(sum)} itemised, ${fmt(gap)} not accounted for`;
  return `${fmt(sum)} — ${fmt(-gap)} over the total`;
}
