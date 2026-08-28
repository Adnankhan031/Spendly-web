'use client';

import React, { useMemo, useState } from 'react';
import { CalendarClock, Check, ChevronRight, SkipForward, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import * as q from '@/lib/queries';
import { Button, Card, Chip, EmptyState, PageTitle, SectionTitle, Sheet, cx, inputClass } from '@/components/ui';
import { CategoryPicker } from '@/components/pickers';
import { IconTile } from '@/lib/icons';
import { addDays, dayLabel, toMinor, todayLocal } from '@/lib/format';
import type { Commitment, Recurrence } from '@/lib/types';

const RECURRENCE: { value: Recurrence; label: string }[] = [
  { value: 'once', label: 'One-off' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export default function CommitmentsPage() {
  const { commitments, categories, fmt, user, refresh } = useStore();
  const [editing, setEditing] = useState<Commitment | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const today = todayLocal();
  const soon = addDays(today, 30);
  const fallback = categories.find((c) => c.key === 'other')?.id ?? categories[0]?.id ?? '';

  const groups = useMemo(
    () => ({
      overdue: commitments.filter((c) => c.due_date < today),
      dueToday: commitments.filter((c) => c.due_date === today),
      upcoming: commitments.filter((c) => c.due_date > today && c.due_date <= soon),
      later: commitments.filter((c) => c.due_date > soon),
    }),
    [commitments, today, soon]
  );

  const committed = commitments.filter((c) => c.due_date <= soon).reduce((a, b) => a + b.amount_minor, 0);
  const byId = new Map(categories.map((c) => [c.id, c]));

  const act = async (c: Commitment, kind: 'settle' | 'skip') => {
    setBusy(c.id);
    try {
      if (kind === 'settle') await q.settleCommitment(user.id, c, fallback);
      else await q.advanceCommitment(c);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const row = (c: Commitment, tone?: 'overdue' | 'today') => {
    const cat = c.category_id ? byId.get(c.category_id) : undefined;
    return (
      <div
        key={c.id}
        className={cx(
          'mb-2 rounded-2xl border bg-surface p-3.5',
          tone === 'overdue' ? 'border-down' : tone === 'today' ? 'border-brand' : 'border-line'
        )}
      >
        <div className="flex items-center gap-3">
          <IconTile name={cat?.icon} color={cat?.color ?? '#8a9099'} size={38} />
          <button type="button" onClick={() => setEditing(c)} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[15px] font-bold">{c.name}</span>
            <span className={cx('mt-0.5 block text-[12px]', tone === 'overdue' ? 'text-down' : 'text-dim')}>
              {tone === 'overdue' ? 'Overdue · ' : ''}
              {dayLabel(c.due_date)}
              {c.recurrence !== 'once' ? ` · ${c.recurrence}` : ''}
            </span>
          </button>
          <span className="tabular text-base font-bold">{fmt(c.amount_minor)}</span>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy === c.id}
            onClick={() => act(c, 'settle')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand py-2 text-[13px] font-bold text-on-brand transition active:scale-95 disabled:opacity-50"
          >
            <Check size={15} /> Paid it
          </button>
          <button
            type="button"
            disabled={busy === c.id}
            onClick={() => act(c, 'skip')}
            className="flex items-center gap-1.5 rounded-xl bg-sunken px-3.5 py-2 text-[13px] font-bold text-dim transition active:scale-95 disabled:opacity-50"
          >
            <SkipForward size={14} /> Skip
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="px-4 pb-10">
      <PageTitle
        title="Upcoming"
        subtitle="Things you know are coming. Nothing counts as spent until you confirm it."
      />

      {committed > 0 && (
        <Card className="mt-4 border-transparent bg-brand-soft">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-brand">
            Committed in the next 30 days
          </p>
          <p className="tabular mt-1 text-[28px] font-extrabold leading-none text-brand">{fmt(committed)}</p>
        </Card>
      )}

      <div className="mt-4">
        <Chip label="＋ New commitment" active onClick={() => setCreating(true)} />
      </div>

      {commitments.length === 0 && (
        <Card className="mt-4">
          <EmptyState
            icon={CalendarClock}
            title="Nothing scheduled"
            body="Add the rent, a travel pass, a yearly renewal — anything you already know is due."
          />
        </Card>
      )}

      {groups.overdue.length > 0 && (
        <>
          <SectionTitle>Overdue</SectionTitle>
          {groups.overdue.map((c) => row(c, 'overdue'))}
        </>
      )}
      {groups.dueToday.length > 0 && (
        <>
          <SectionTitle>Due today</SectionTitle>
          {groups.dueToday.map((c) => row(c, 'today'))}
        </>
      )}
      {groups.upcoming.length > 0 && (
        <>
          <SectionTitle>Next 30 days</SectionTitle>
          {groups.upcoming.map((c) => row(c))}
        </>
      )}
      {groups.later.length > 0 && (
        <>
          <SectionTitle>Later</SectionTitle>
          {groups.later.map((c) => row(c))}
        </>
      )}

      <CommitmentEditor
        open={!!editing || creating}
        commitment={editing}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
      />
    </div>
  );
}

function CommitmentEditor({
  open,
  commitment,
  onClose,
}: {
  open: boolean;
  commitment: Commitment | null;
  onClose: () => void;
}) {
  const { categories, currency, user, refresh } = useStore();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [due, setDue] = useState(todayLocal());
  const [recurrence, setRecurrence] = useState<Recurrence>('monthly');
  const [showCat, setShowCat] = useState(false);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(commitment?.name ?? '');
    setAmount(commitment ? String(commitment.amount_minor / 100) : '');
    setCategoryId(commitment?.category_id ?? null);
    setDue(commitment?.due_date ?? addDays(todayLocal(), 1));
    setRecurrence(commitment?.recurrence ?? 'monthly');
  }, [open, commitment]);

  const category = categories.find((c) => c.id === categoryId);

  return (
    <>
      <Sheet open={open} onClose={onClose} title={commitment ? 'Edit commitment' : 'New commitment'}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What is it? e.g. Metro pass"
          className={inputClass}
        />

        <div className="flex items-center rounded-xl border border-line bg-sunken px-3.5">
          <span className="text-2xl font-bold text-dim">{currency.symbol}</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            placeholder="0"
            className="tabular w-full bg-transparent px-2 py-3 text-[28px] font-extrabold outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowCat(true)}
          className="flex items-center gap-3 rounded-xl border border-line bg-sunken p-3 text-left"
        >
          <IconTile name={category?.icon} color={category?.color ?? '#8a9099'} size={34} />
          <span className="flex-1 text-[15px] font-semibold">{category?.name ?? 'Choose category'}</span>
          <ChevronRight size={17} className="text-faint" />
        </button>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-dim">Due on</span>
          <input type="date" value={due} onChange={(e) => e.target.value && setDue(e.target.value)} className={inputClass} />
        </label>

        <span className="text-[12px] font-semibold text-dim">Repeats</span>
        <div className="flex flex-wrap gap-2">
          {RECURRENCE.map((r) => (
            <Chip key={r.value} label={r.label} small active={recurrence === r.value} onClick={() => setRecurrence(r.value)} />
          ))}
        </div>

        <Button
          loading={busy}
          disabled={!name.trim() || Number(amount) <= 0}
          onClick={async () => {
            setBusy(true);
            try {
              await q.saveCommitment(user.id, {
                id: commitment?.id,
                name: name.trim(),
                amount_minor: toMinor(Number(amount)),
                category_id: categoryId,
                due_date: due,
                recurrence,
              });
              await refresh();
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {commitment ? 'Save' : 'Add commitment'}
        </Button>

        {commitment && (
          <Button
            variant="danger"
            icon={Trash2}
            onClick={async () => {
              await q.deleteCommitment(commitment.id);
              await refresh();
              onClose();
            }}
          >
            Delete
          </Button>
        )}
      </Sheet>

      <CategoryPicker
        open={showCat}
        categories={categories}
        value={categoryId}
        kind="expense"
        onClose={() => setShowCat(false)}
        onPick={(id) => {
          setCategoryId(id);
          setShowCat(false);
        }}
      />
    </>
  );
}
