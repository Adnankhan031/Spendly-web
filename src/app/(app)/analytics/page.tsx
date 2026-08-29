'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { rangeStats } from '@/lib/analytics';
import { CalendarRange, ChartNoAxesCombined } from 'lucide-react';
import { cycleEndFor, cycleLabel, currentCycle } from '@/lib/cycle';
import { Bars, Donut, GroupedBars, HBar, Legend, TrendLine } from '@/components/charts';
import { Card, EmptyState, SectionTitle, Segmented, Spinner, cx, inputClass } from '@/components/ui';
import { CategoryIcon, UiIcon } from '@/lib/icons';
import { addDays, currentMonth, dayLabel, monthEnd, monthLabel, monthStart, shiftMonth, todayLocal } from '@/lib/format';

type Period = 'month' | '3m' | '6m' | '12m' | 'all' | 'custom';

const OPTIONS: { value: Period; label: string }[] = [
  { value: 'month', label: 'Cycle' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '12m', label: '1Y' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];

export default function AnalyticsPage() {
  const { txns, fmt, fmtCompact, loading, cycleStartDay } = useStore();
  const [period, setPeriod] = useState<Period>('6m');
  // custom window, defaulting to the last 30 days so the pickers open somewhere useful
  const [from, setFrom] = useState(() => addDays(todayLocal(), -29));
  const [to, setTo] = useState(() => todayLocal());

  const bounds = useMemo(() => {
    const cur = currentMonth();
    if (period === 'month') {
      const c = currentCycle(todayLocal(), cycleStartDay);
      return { from: c, to: cycleEndFor(c, cycleStartDay), label: cycleLabel(c, cycleStartDay) };
    }
    if (period === 'all') {
      const first = txns.length ? txns[txns.length - 1].local_date : monthStart(cur);
      return { from: first, to: todayLocal(), label: 'All time' };
    }
    if (period === 'custom') {
      const lo = from <= to ? from : to;
      const hi = from <= to ? to : from;
      return { from: lo, to: hi, label: `${dayLabel(lo)} – ${dayLabel(hi)}` };
    }
    const back = period === '3m' ? 2 : period === '6m' ? 5 : 11;
    return { from: monthStart(shiftMonth(cur, -back)), to: monthEnd(cur), label: `Last ${back + 1} months` };
  }, [period, txns, from, to, cycleStartDay]);

  const stats = useMemo(() => rangeStats(txns, bounds.from, bounds.to, bounds.label), [txns, bounds]);

  const prev = useMemo(() => {
    if (period === 'all' || period === 'custom') return null;
    const cur = currentMonth();
    const back = period === 'month' ? 1 : period === '3m' ? 3 : period === '6m' ? 6 : 12;
    return rangeStats(
      txns,
      monthStart(shiftMonth(cur, -(back * 2 - 1))),
      monthEnd(shiftMonth(cur, -back)),
      'previous'
    );
  }, [txns, period]);

  const prevCat = useMemo(
    () => new Map((prev?.byCategory ?? []).map((c) => [c.category_id, c.total])),
    [prev]
  );

  /**
   * Running total across the period.
   *
   * The daily bars answer "what did I spend on Tuesday"; this answers the
   * question you actually ask mid-period — am I going faster than I can afford?
   */
  const pace = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const t of txns) {
      if (t.type !== 'expense') continue;
      if (t.local_date < bounds.from || t.local_date > bounds.to) continue;
      perDay.set(t.local_date, (perDay.get(t.local_date) ?? 0) + t.amount_minor);
    }

    const labels: string[] = [];
    const cumulative: number[] = [];
    let sum = 0;
    let spentDays = 0;
    for (let d = bounds.from; d <= bounds.to; d = addDays(d, 1)) {
      const v = perDay.get(d) ?? 0;
      if (v > 0) spentDays += 1;
      sum += v;
      labels.push(d.slice(8));
      cumulative.push(sum);
      if (labels.length > 400) break;
    }

    const today = todayLocal();
    // Only count the days that have actually happened, or a mid-month period
    // would look far cheaper per day than it is.
    const elapsed = Math.max(1, labels.filter((_, i) => addDays(bounds.from, i) <= today).length);
    const span = Math.max(1, labels.length);
    const perDayAvg = sum / Math.min(elapsed, span);

    return { labels, cumulative, total: sum, spentDays, projected: Math.round(perDayAvg * span), perDayAvg };
  }, [txns, bounds]);

  if (loading) {
    return (
      <div className="grid h-[60dvh] place-items-center text-dim">
        <Spinner />
      </div>
    );
  }

  const maxWeekday = Math.max(1, ...stats.weekday.map((w) => w.value));
  const peakMonth = stats.months.reduce((a, b) => (b.expense > a.expense ? b : a), stats.months[0]);

  return (
    <div className="px-4 pb-6">
      <header className="pt-4 pb-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Analytics</h1>
        <p className="mt-0.5 text-[13px] text-dim">{stats.label}</p>
      </header>

      <Segmented options={OPTIONS} value={period} onChange={setPeriod} />

      {period === 'custom' && (
        <div className="mt-3 rounded-2xl border border-line bg-surface p-3">
          <div className="mb-2.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">
            <CalendarRange size={13} />
            Pick a window
          </div>
          <div className="flex items-center gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-[10.5px] font-semibold text-dim">From</span>
              <input
                type="date"
                value={from}
                max={todayLocal()}
                onChange={(e) => e.target.value && setFrom(e.target.value)}
                className={cx(inputClass, 'py-2 text-[13.5px]')}
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-[10.5px] font-semibold text-dim">To</span>
              <input
                type="date"
                value={to}
                max={todayLocal()}
                onChange={(e) => e.target.value && setTo(e.target.value)}
                className={cx(inputClass, 'py-2 text-[13.5px]')}
              />
            </label>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(
              [
                ['Last 7 days', 6],
                ['Last 30 days', 29],
                ['Last 90 days', 89],
                ['Last 365 days', 364],
              ] as const
            ).map(([label, back]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setFrom(addDays(todayLocal(), -back));
                  setTo(todayLocal());
                }}
                className="rounded-full border border-line bg-sunken px-2.5 py-1 text-[11.5px] font-semibold text-dim transition active:scale-95"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-faint">
            {stats.days} day{stats.days === 1 ? '' : 's'} selected
          </p>
        </div>
      )}

      {stats.count === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={ChartNoAxesCombined}
            title="No data in this window"
            body="Log a few expenses and the charts fill in automatically."
          />
        </Card>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <BigStat label="Spent" value={fmt(stats.expense)} />
            <BigStat label="Earned" value={fmt(stats.income)} tone="accent" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <BigStat label="Per day" value={fmtCompact(Math.round(stats.avgPerDay))} />
            <BigStat label="Per month" value={fmtCompact(Math.round(stats.avgPerMonth))} />
            <BigStat label="Entries" value={String(stats.count)} />
          </div>

          <SectionTitle>Monthly trend</SectionTitle>
          <Card>
            {stats.months.length > 2 ? (
              <TrendLine values={stats.months.map((m) => m.expense)} labels={stats.months.map((m) => m.label)} />
            ) : (
              <Bars
                data={stats.months.map((m) => ({
                  label: m.label,
                  value: m.expense,
                  highlight: m.ym === currentMonth(),
                }))}
                height={120}
              />
            )}
            {peakMonth && (
              <div className="mt-3 flex justify-between text-[11.5px] text-faint">
                <span>Highest: {monthLabel(peakMonth.ym, true)}</span>
                <span className="tabular font-bold">{fmtCompact(peakMonth.expense)}</span>
              </div>
            )}
          </Card>

          <SectionTitle>Income vs spending</SectionTitle>
          <Card>
            <GroupedBars data={stats.months} />
            <div className="mt-3 flex items-center gap-4 text-[11.5px]">
              <Legend color="var(--color-down)" label="Spent" />
              <Legend color="var(--color-brand)" label="Earned" />
              <span className="flex-1" />
              <span
                className={cx(
                  'tabular font-bold',
                  stats.income - stats.expense >= 0 ? 'text-brand' : 'text-down'
                )}
              >
                {stats.income - stats.expense >= 0 ? 'Saved ' : 'Short by '}
                {fmtCompact(Math.abs(stats.income - stats.expense))}
              </span>
            </div>
          </Card>

          <SectionTitle>Category breakdown</SectionTitle>
          <Card>
            <div className="mb-5 flex justify-center">
              <Donut
                data={stats.byCategory.slice(0, 8).map((c) => ({ value: c.total, color: c.color, label: c.name }))}
                size={158}
                thickness={19}
              >
                <span className="tabular text-lg font-bold">{fmtCompact(stats.expense)}</span>
                <span className="text-[10px] text-faint">total</span>
              </Donut>
            </div>
            <div className="flex flex-col gap-3.5">
              {stats.byCategory.map((c) => {
                const before = prevCat.get(c.category_id) ?? 0;
                const delta = before > 0 ? ((c.total - before) / before) * 100 : null;
                return (
                  <Link key={c.category_id} href={`/category/${c.category_id}`} className="block">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span
                        className="grid size-6 shrink-0 place-items-center rounded-md"
                        style={{ background: c.color + '24', color: c.color }}
                      >
                        <CategoryIcon name={c.icon} size={14} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{c.name}</span>
                      {delta !== null && Math.abs(delta) >= 5 && (
                        <span className={cx('text-[11px] font-bold', delta > 0 ? 'text-down' : 'text-brand')}>
                          {delta > 0 ? '+' : ''}
                          {Math.round(delta)}%
                        </span>
                      )}
                      <span className="tabular text-[13.5px] font-bold">{fmt(c.total)}</span>
                    </div>
                    <HBar fraction={c.total / (stats.byCategory[0]?.total || 1)} color={c.color} />
                    <p className="mt-1 text-[10.5px] text-faint">
                      {c.count} entries · {Math.round((c.total / stats.expense) * 100)}% of spending
                    </p>
                  </Link>
                );
              })}
            </div>
          </Card>

          {pace.cumulative.length > 2 && pace.total > 0 && (
            <>
              <SectionTitle>Pace</SectionTitle>
              <Card>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[12px] text-dim">Spent so far</span>
                  <span className="tabular text-[15px] font-bold">{fmt(pace.total)}</span>
                </div>
                <TrendLine values={pace.cumulative} labels={pace.labels} height={128} />
                <p className="mt-2 text-[12px] leading-5 text-dim">
                  Averaging {fmt(Math.round(pace.perDayAvg))} a day across {pace.spentDays} spending{' '}
                  {pace.spentDays === 1 ? 'day' : 'days'} — about {fmt(pace.projected)} for the whole period.
                </p>
              </Card>
            </>
          )}

          <SectionTitle>Spending by weekday</SectionTitle>
          <Card>
            <Bars
              data={stats.weekday.map((w) => ({ label: w.label, value: w.value, highlight: w.value === maxWeekday }))}
              height={96}
            />
          </Card>

          {stats.methods.some((m) => m.method && m.method !== 'Unspecified') && (
            <>
              <SectionTitle>How you paid</SectionTitle>
              <Card>
                <div className="flex flex-col gap-3">
                  {stats.methods.map((m) => (
                    <div key={m.method}>
                      <div className="mb-1.5 flex items-center">
                        <span className="flex-1 text-[13.5px] font-semibold">{m.method}</span>
                        <span className="mr-2 text-[11px] text-faint">{m.count}×</span>
                        <span className="tabular text-[13px] font-bold">{fmt(m.total)}</span>
                      </div>
                      <HBar fraction={m.total / (stats.methods[0]?.total || 1)} color="var(--color-info)" />
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}

          <SectionTitle>Records</SectionTitle>
          <Card>
            <div className="flex flex-col gap-3.5">
              {stats.biggestDay && (
                <Record
                  icon="flame"
                  title="Heaviest day"
                  sub={dayLabel(stats.biggestDay.date)}
                  value={fmt(stats.biggestDay.total)}
                />
              )}
              {stats.biggestTxn && (
                <Record
                  icon="trophy"
                  title="Biggest single expense"
                  sub={`${stats.biggestTxn.note} · ${dayLabel(stats.biggestTxn.date)}`}
                  value={fmt(stats.biggestTxn.amount)}
                />
              )}
              <Record
                icon="receipt"
                title="Average entry"
                sub={`${stats.count} entries logged`}
                value={fmt(stats.count ? Math.round(stats.expense / stats.count) : 0)}
              />
            </div>
          </Card>

          {stats.merchants.length > 0 && (
            <>
              <SectionTitle>Most frequent</SectionTitle>
              <Card>
                <div className="flex flex-col gap-2.5">
                  {stats.merchants.map((m) => (
                    <div key={m.note} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] capitalize">{m.note}</span>
                      <span className="rounded-full bg-sunken px-2 py-0.5 text-[10.5px] font-bold text-dim">
                        {m.count}×
                      </span>
                      <span className="tabular text-[13px] font-bold">{fmt(m.total)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function BigStat({ label, value, tone }: { label: string; value: string; tone?: 'accent' }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface p-3.5">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-faint">{label}</p>
      <p className={cx('tabular mt-1 truncate text-xl font-bold', tone === 'accent' && 'text-brand')}>{value}</p>
    </div>
  );
}

function Record({ icon, title, sub, value }: { icon: string; title: string; sub: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
        <UiIcon name={icon} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold">{title}</span>
        <span className="block truncate text-[11.5px] text-faint">{sub}</span>
      </span>
      <span className="tabular text-[15px] font-bold">{value}</span>
    </div>
  );
}
