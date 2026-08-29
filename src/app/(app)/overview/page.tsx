'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { buildInsights, periodStats } from '@/lib/analytics';
import { cycleEndFor, cycleLabel, cycleStartingIn, currentCycle, shiftCycle } from '@/lib/cycle';
import * as q from '@/lib/queries';
import { Bars, Donut, HBar, Ring } from '@/components/charts';
import { CalendarX2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, EmptyState, SectionTitle, Spinner, cx } from '@/components/ui';
import { CategoryIcon, IconTile, UiIcon } from '@/lib/icons';
import { MonthPicker } from '@/components/pickers';
import { TxnEditor } from '@/components/TxnEditor';
import { addDays, currentMonth, dayLabel, monthLabel, shiftMonth, shortDayLabel, todayLocal } from '@/lib/format';
import type { TxnView } from '@/lib/types';

export default function OverviewPage() {
  const { txns, budgets, commitments, fmt, fmtCompact, loading, cycleStartDay, categories, user, refresh } =
    useStore();
  const today = todayLocal();
  const curCycle = currentCycle(today, cycleStartDay);
  const [cycle, setCycle] = useState(curCycle);
  const from = cycle;
  const to = cycleEndFor(cycle, cycleStartDay);
  const prevCycle = shiftCycle(cycle, -1, cycleStartDay);
  const [showMonth, setShowMonth] = useState(false);
  const [editing, setEditing] = useState<TxnView | null>(null);

  const stats = useMemo(
    () => periodStats(txns, budgets, from, to, prevCycle, cycleEndFor(prevCycle, cycleStartDay)),
    [txns, budgets, from, to, prevCycle, cycleStartDay]
  );
  const insights = useMemo(() => buildInsights(stats, fmt), [stats, fmt]);
  const recent = useMemo(
    () => txns.filter((t) => t.local_date >= stats.from && t.local_date <= stats.to).slice(0, 6),
    [txns, stats.from, stats.to]
  );
  const owed = useMemo(() => txns.filter((t) => t.reimbursable && !t.reimbursed_at), [txns]);
  // Only what is imminent — the full list lives on its own screen.
  const due = useMemo(
    () => commitments.filter((c) => c.due_date <= addDays(today, 14)),
    [commitments, today]
  );
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const fallbackCat = categories.find((c) => c.key === 'other')?.id ?? categories[0]?.id ?? '';

  const isCurrent = cycle === curCycle;
  const budgetPct = stats.budgetTotal > 0 ? stats.expense / stats.budgetTotal : 0;

  if (loading) {
    return (
      <div className="grid h-[60dvh] place-items-center text-dim">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="px-4 pb-6">
      <div className="flex items-center py-4">
        <button type="button" onClick={() => setCycle(shiftCycle(cycle, -1, cycleStartDay))} className="grid size-9 place-items-center rounded-lg bg-sunken text-dim active:scale-90">
          <ChevronLeft size={18} />
        </button>
        <button type="button" onClick={() => setShowMonth(true)} className="flex-1 text-center">
          <span className="block text-xl font-extrabold tracking-tight">{cycleLabel(cycle, cycleStartDay)}</span>
          <span className="block text-[11px] text-faint">
            {stats.count} {stats.count === 1 ? 'entry' : 'entries'}
          </span>
        </button>
        <button
          type="button"
          onClick={() => cycle < curCycle && setCycle(shiftCycle(cycle, 1, cycleStartDay))}
          className={cx('grid size-9 place-items-center rounded-lg bg-sunken text-dim active:scale-90', cycle >= curCycle && 'opacity-25')}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {stats.count === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarX2}
            title={`Nothing logged in ${cycleLabel(cycle, cycleStartDay)}`}
            body={
              isCurrent
                ? 'Head to the Add tab and type your first expense.'
                : 'Add entries for this month by hand from the Add entries screen.'
            }
          />
          {!isCurrent && (
            <Link
              href="/manual"
              className="mx-auto block w-fit rounded-full bg-brand-soft px-4 py-2 text-sm font-bold text-brand"
            >
              Add entries manually
            </Link>
          )}
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-dim">Total spent</p>
                <p className="tabular mt-0.5 text-4xl font-extrabold">{fmt(stats.expense)}</p>
                {stats.deltaPct !== null && (
                  <p
                    className={cx(
                      'mt-1.5 text-[12.5px] font-bold',
                      stats.deltaPct > 0 ? 'text-down' : 'text-brand'
                    )}
                  >
                    {stats.deltaPct > 0 ? '▲' : '▼'} {Math.abs(Math.round(stats.deltaPct))}% vs{' '}
                    last period
                  </p>
                )}
              </div>
              {stats.budgetTotal > 0 && (
                <Ring progress={budgetPct}>
                  <span className="text-[15px] font-extrabold">{Math.round(budgetPct * 100)}%</span>
                  <span className="text-[9.5px] text-faint">of budget</span>
                </Ring>
              )}
            </div>

            <div className="mt-5 flex gap-3">
              <Stat label="Income" value={fmt(stats.income)} tone="accent" />
              <Stat label="Net" value={fmt(stats.net)} tone={stats.net >= 0 ? 'accent' : 'danger'} />
              <Stat label="Per day" value={fmt(Math.round(stats.avgPerDay))} />
              {isCurrent && <Stat label="Projected" value={fmtCompact(stats.projected)} />}
            </div>
          </Card>

          <SectionTitle>Day by day</SectionTitle>
          <Card>
            <Bars data={stats.daily} height={100} labelEvery={5} />
          </Card>

          <SectionTitle
            right={
              <Link href="/analytics" className="text-xs font-bold text-brand">
                More
              </Link>
            }
          >
            Where it went
          </SectionTitle>
          <Card>
            <div className="mb-5 flex justify-center">
              <Donut data={stats.byCategory.slice(0, 8).map((c) => ({ value: c.total, color: c.color, label: c.name }))}>
                <span className="tabular text-xl font-bold">{fmtCompact(stats.expense)}</span>
                <span className="text-[10.5px] text-faint">{stats.byCategory.length} categories</span>
              </Donut>
            </div>
            <div className="flex flex-col gap-3.5">
              {stats.byCategory.slice(0, 8).map((c) => (
                <Link key={c.category_id} href={`/category/${c.category_id}?from=${from}&to=${to}`} className="block">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className="grid size-6 shrink-0 place-items-center rounded-md"
                      style={{ background: c.color + '24', color: c.color }}
                    >
                      <CategoryIcon name={c.icon} size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{c.name}</span>
                    <span className="text-[11px] font-semibold text-faint">
                      {Math.round((c.total / stats.expense) * 100)}%
                    </span>
                    <span className="tabular text-[13.5px] font-bold">{fmt(c.total)}</span>
                  </div>
                  <HBar fraction={c.total / (stats.byCategory[0]?.total || 1)} color={c.color} />
                </Link>
              ))}
            </div>
          </Card>

          {due.length > 0 && (
            <>
              <SectionTitle
                right={
                  <Link href="/commitments" className="text-xs font-bold text-brand">
                    All
                  </Link>
                }
              >
                Coming up
              </SectionTitle>
              <Card>
                <div className="mb-3 flex items-center">
                  <span className="flex-1 text-[12.5px] text-dim">{due.length} due in the next two weeks</span>
                  <span className="tabular text-lg font-bold text-brand">
                    {fmt(due.reduce((a, b) => a + b.amount_minor, 0))}
                  </span>
                </div>
                {due.map((c, i) => {
                  const cat = c.category_id ? catById.get(c.category_id) : undefined;
                  const overdue = c.due_date < today;
                  return (
                    <div key={c.id} className={cx('flex items-center gap-2.5 py-2.5', i > 0 && 'border-t border-line')}>
                      <IconTile name={cat?.icon} color={cat?.color ?? '#8a9099'} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold">{c.name}</span>
                        <span className={cx('block text-[11px]', overdue ? 'text-down' : 'text-faint')}>
                          {overdue ? 'Overdue · ' : ''}
                          {dayLabel(c.due_date)}
                        </span>
                      </span>
                      <span className="tabular text-[13.5px] font-bold">{fmt(c.amount_minor)}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await q.settleCommitment(user.id, c, fallbackCat);
                          await refresh();
                        }}
                        className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-bold text-brand transition active:scale-95"
                      >
                        Paid
                      </button>
                    </div>
                  );
                })}
              </Card>
            </>
          )}

          {owed.length > 0 && (
            <>
              <SectionTitle>Coming back to you</SectionTitle>
              <Card>
                <div className="mb-3 flex items-center">
                  <span className="flex-1 text-[12.5px] text-dim">
                    {owed.length} unsettled {owed.length === 1 ? 'expense' : 'expenses'}
                  </span>
                  <span className="tabular text-lg font-bold text-up">
                    {fmt(owed.reduce((a, b) => a + b.amount_minor, 0))}
                  </span>
                </div>
                {owed.map((x, i) => (
                  <div
                    key={x.id}
                    className={cx('flex items-center gap-2.5 py-2.5', i > 0 && 'border-t border-line')}
                  >
                    <IconTile name={x.cat_icon} color={x.cat_color} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">{x.note || x.cat_name}</span>
                      <span className="block text-[11px] text-faint">{shortDayLabel(x.local_date)}</span>
                    </span>
                    <span className="tabular text-[13.5px] font-bold">{fmt(x.amount_minor)}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await q.settleReimbursement(x.id);
                        await refresh();
                      }}
                      className="rounded-full bg-up-soft px-2.5 py-1 text-[11px] font-bold text-up transition active:scale-95"
                    >
                      Got it
                    </button>
                  </div>
                ))}
              </Card>
            </>
          )}

          {insights.length > 0 && (
            <>
              <SectionTitle>What stands out</SectionTitle>
              <div className="flex flex-col gap-2">
                {insights.map((ins, i) => (
                  <div
                    key={i}
                    className="flex gap-2.5 rounded-xl bg-surface p-3.5"
                    style={{
                      borderLeft: `3px solid ${
                        ins.tone === 'bad'
                          ? 'var(--color-down)'
                          : ins.tone === 'warn'
                            ? 'var(--color-warn)'
                            : ins.tone === 'good'
                              ? 'var(--color-brand)'
                              : 'var(--color-line-strong)'
                      }`,
                    }}
                  >
                    <span
                      className={cx(
                        'mt-0.5 shrink-0',
                        ins.tone === 'bad'
                          ? 'text-down'
                          : ins.tone === 'warn'
                            ? 'text-warn'
                            : ins.tone === 'good'
                              ? 'text-brand'
                              : 'text-faint'
                      )}
                    >
                      <UiIcon name={ins.icon} size={16} />
                    </span>
                    <p className="flex-1 text-[13.5px] leading-5 text-dim">{ins.text}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          <SectionTitle
            right={
              <Link href="/history" className="text-xs font-bold text-brand">
                See all
              </Link>
            }
          >
            Recent
          </SectionTitle>
          <Card>
            {recent.map((x, i) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setEditing(x)}
                className={cx(
                  'flex w-full items-center gap-3 py-2.5 text-left active:opacity-70',
                  i > 0 && 'border-t border-line'
                )}
              >
                <IconTile name={x.cat_icon} color={x.cat_color} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold">{x.note || x.cat_name}</span>
                  <span className="block text-[11.5px] text-faint">
                    {shortDayLabel(x.local_date)}
                    {x.method ? ` · ${x.method}` : ''}
                  </span>
                </span>
                <span className={cx('tabular text-[15px] font-bold', x.type === 'income' && 'text-brand')}>
                  {x.type === 'income' ? '+' : ''}
                  {fmt(x.amount_minor)}
                </span>
              </button>
            ))}
          </Card>
        </>
      )}

      <MonthPicker
        open={showMonth}
        value={cycle.slice(0, 7)}
        onClose={() => setShowMonth(false)}
        onPick={(m) => {
          setCycle(cycleStartingIn(m, cycleStartDay));
          setShowMonth(false);
        }}
      />
      <TxnEditor open={!!editing} txn={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'accent' | 'danger' }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-faint">{label}</p>
      <p
        className={cx(
          'tabular mt-0.5 truncate text-base font-bold',
          tone === 'accent' && 'text-brand',
          tone === 'danger' && 'text-down'
        )}
      >
        {value}
      </p>
    </div>
  );
}
