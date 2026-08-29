'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import * as q from '@/lib/queries';
import { parseInput } from '@/lib/parser';
import { runQuery, type Answer } from '@/lib/analytics';
import { DatePicker } from '@/components/pickers';
import { TxnEditor } from '@/components/TxnEditor';
import { ItemsEditor, type ReceiptDraft } from '@/components/ItemsEditor';
import { compressImage, readReceipt } from '@/lib/receipt';
import { CategoryIcon, IconTile } from '@/lib/icons';
import { ArrowUp, Camera, LayoutGrid, Loader2, MessageSquareText, Plus, Trash2, X } from 'lucide-react';
import { Chip, EmptyState, Spinner, cx } from '@/components/ui';
import { dayLabel, shortDayLabel, todayLocal } from '@/lib/format';
import { useKeyboardOpen } from '@/lib/useViewport';
import { cycleEndFor, cycleLabel, cycleStartFor } from '@/lib/cycle';
import type { ChatMessage, TxnView } from '@/lib/types';



export default function AddPage() {
  const store = useStore();
  const { categories, aliasMap, pinnedDate, setPinnedDate, txns, user, fmt, refresh, loading, cycleStartDay } =
    store;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [editing, setEditing] = useState<TxnView | null>(null);
  const [creating, setCreating] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const shotRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Only whether it is open — the height itself lives in CSS as --dock, so the
  // composer follows the keyboard without React re-rendering as it animates.
  const keyboardOpen = useKeyboardOpen();

  useEffect(() => {
    void q.fetchMessages().then(setMessages).catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  /**
   * Re-pin to the newest message once, when the keyboard opens.
   *
   * This deliberately depends on the open/closed boolean and not on the
   * keyboard's height: scrolling moves the visual viewport, so a height-driven
   * effect re-triggered its own scroll and the thread juddered up and down.
   * `behavior: 'auto'` for the same reason — a smooth scroll spends 300ms
   * firing viewport events.
   */
  useEffect(() => {
    if (!keyboardOpen) return;
    const id = requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
    return () => cancelAnimationFrame(id);
  }, [keyboardOpen]);

  const txnById = useMemo(() => new Map(txns.map((t) => [t.id, t])), [txns]);
  const today = todayLocal();
  const todayTotal = txns.reduce(
    (a, t) => (t.local_date === today && t.type === 'expense' ? a + t.amount_minor : a),
    0
  );
  const pinnedIsToday = pinnedDate === today;

  /**
   * The header follows the day you are writing to, not the calendar.
   *
   * It used to always read "Spent today", which sits at zero the entire time
   * you are backfilling last week — a number that is both correct and useless.
   * The cycle total underneath is the one that actually answers "can I afford
   * this", so it is always present.
   */
  const pinnedTotal = txns.reduce(
    (a, t) => (t.local_date === pinnedDate && t.type === 'expense' ? a + t.amount_minor : a),
    0
  );
  const pinnedCount = txns.filter((t) => t.local_date === pinnedDate).length;
  const cycleFrom = cycleStartFor(today, cycleStartDay);
  const cycleTo = cycleEndFor(cycleFrom, cycleStartDay);
  const cycleTotal = txns.reduce(
    (a, t) =>
      t.type === 'expense' && t.local_date >= cycleFrom && t.local_date <= cycleTo ? a + t.amount_minor : a,
    0
  );


  /**
   * Photograph a receipt straight from the composer.
   *
   * The camera used to live inside the item editor, three taps down and only
   * reachable once a transaction already existed — no use when the receipt in
   * your hand is the thing you are trying to record.
   */
  const scanReceipt = async (file: File) => {
    setScanning(true);
    setScanError(null);
    try {
      const receipt = await readReceipt(await compressImage(file));
      if (!receipt.items.length) {
        setScanError('No line items found. Try a straighter, brighter photo.');
        return;
      }
      setDraft({
        merchant: receipt.merchant,
        date: receipt.purchased_on || pinnedDate,
        total: receipt.total ?? receipt.items.reduce((a, i) => a + i.amount_minor, 0),
        lines: receipt.items.map((i) => ({ name: i.name, amount_minor: i.amount_minor })),
      });
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Could not read that photo.');
    } finally {
      setScanning(false);
      if (shotRef.current) shotRef.current.value = '';
    }
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    try {
      const mine = await q.addMessage(user.id, { role: 'user', kind: 'text', text });
      setMessages((m) => [...m, mine]);

      const result = parseInput(text, {
        categories,
        aliases: aliasMap,
        defaultDate: pinnedDate,
        today: todayLocal(),
      });

      const added: ChatMessage[] = [];

      if (result.kind === 'entries') {
        for (const e of result.entries) {
          const row = await q.insertTxn(user.id, {
            amount_minor: e.amountMinor,
            type: e.type,
            category_id: e.categoryId,
            local_date: e.date,
            method: e.method,
            note: e.note,
            raw_input: e.raw,
            source: 'chat',
            confidence: e.confidence,
          });
          if (e.learnToken && e.confidence >= 0.9) await q.learnAlias(user.id, e.learnToken, e.categoryId);
          added.push(await q.addMessage(user.id, { role: 'app', kind: 'txn', text: '', txn_id: row.id }));
        }
      } else if (result.kind === 'query') {
        const answer = runQuery(result.query, txns, fmt);
        added.push(
          await q.addMessage(user.id, { role: 'app', kind: 'answer', text: answer.headline, payload: answer })
        );
      } else {
        added.push(
          await q.addMessage(user.id, {
            role: 'app',
            kind: 'note',
            text: 'I could not find an amount in that. Try something like "food 300".',
          })
        );
      }

      setMessages((m) => [...m, ...added]);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((m) => [
        ...m,
        {
          id: 'err-' + Date.now(),
          user_id: user.id,
          role: 'app',
          kind: 'note',
          text: `Could not save that: ${message}`,
          txn_id: null,
          payload: null,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, sending, categories, aliasMap, pinnedDate, user.id, txns, fmt, refresh]);

  const removeTxn = async (msg: ChatMessage) => {
    if (msg.txn_id) await q.softDeleteTxn(msg.txn_id);
    await q.deleteMessage(msg.id);
    setMessages((m) => m.filter((x) => x.id !== msg.id));
    await refresh();
  };

  const clearThread = async () => {
    await q.clearMessages(user.id);
    setMessages([]);
  };

  return (
    <div className="flex min-h-[calc(100dvh-72px)] flex-col">
      {/* header */}
      <header className="sticky top-0 z-20 bg-bg/95 px-4 pt-3 pb-2 backdrop-blur-lg">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-surface">
          {/* a wash of the accent, so the block reads as the app's own colour
              without becoming a solid slab the eye cannot get past */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.13]"
            style={{ background: 'radial-gradient(120% 140% at 0% 0%, var(--color-brand), transparent 62%)' }}
          />

          <div className="relative flex items-start gap-3 px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-dim">
                {pinnedIsToday ? 'Spent today' : `Spent on ${shortDayLabel(pinnedDate)}`}
              </p>
              <p className="tabular mt-1 text-[30px] font-extrabold leading-none">{fmt(pinnedTotal)}</p>
              <p className="mt-1.5 text-[11.5px] text-faint">
                {pinnedCount} {pinnedCount === 1 ? 'entry' : 'entries'}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={clearThread}
                  aria-label="Clear thread"
                  className="grid size-9 place-items-center rounded-xl text-faint transition active:scale-90"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setCreating(true)}
                aria-label="Add manually"
                className="grid size-9 place-items-center rounded-xl bg-brand text-on-brand transition active:scale-90"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>

          {/* the number that actually answers "can I afford this" */}
          <div className="relative flex items-center gap-2 border-t border-line px-3.5 py-2">
            <span className="text-[11.5px] text-dim">{cycleLabel(cycleFrom, cycleStartDay)}</span>
            <span className="tabular ml-auto text-[13px] font-bold">{fmt(cycleTotal)}</span>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDate(true)}
            className={cx(
              'rounded-full px-2.5 py-1 text-[12px] font-semibold transition active:scale-95',
              pinnedIsToday ? 'text-faint' : 'bg-brand-soft text-brand'
            )}
          >
            Adding to · {dayLabel(pinnedDate)}
          </button>
          {!pinnedIsToday && <Chip label="Reset" small onClick={() => setPinnedDate(today)} />}
        </div>
      </header>

      {/* thread */}
      <div className="flex flex-1 flex-col gap-2 px-4 pb-4" style={{ paddingBottom: showPicker ? 150 : 76 }}>
        {loading && messages.length === 0 && (
          <div className="grid flex-1 place-items-center text-dim">
            <Spinner />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-1 flex-col justify-center">
            <EmptyState
              icon={MessageSquareText}
              title="What did you spend?"
              body="Write it the way you would say it. The amount and what it was for is enough — add a day only if it was not today."
            />
          </div>
        )}

        {messages.map((m, i) => {
          /**
           * A day divider whenever the calendar day changes.
           *
           * Without it a long thread is one unbroken column of identical
           * bubbles with nothing to tell you where yesterday ended.
           */
          // created_at is UTC; slicing the string would put anything sent before
          // 09:00 in Japan on the previous day. Convert to the local calendar day.
          const dayOf = (msg: ChatMessage) => {
            if (!msg.created_at) return '';
            const d = new Date(msg.created_at);
            if (Number.isNaN(d.getTime())) return '';
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
              d.getDate()
            ).padStart(2, '0')}`;
          };
          const divider =
            i === 0 || dayOf(messages[i - 1]) !== dayOf(m) ? (
              <div key={`d-${m.id}`} className="my-2 flex items-center gap-3 px-1">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-faint">
                  {dayOf(m) ? dayLabel(dayOf(m)) : 'Earlier'}
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
            ) : null;

          const wrap = (node: React.ReactNode) => (
            <React.Fragment key={m.id}>
              {divider}
              {node}
            </React.Fragment>
          );

          if (m.role === 'user') {
            return wrap(
              <div className="rise max-w-[84%] self-end">
                <div className="rounded-2xl rounded-br-sm bg-brand px-3.5 py-2.5 text-[15px] font-semibold text-on-brand shadow-[0_1px_2px_rgba(0,0,0,0.18)]">
                  {m.text}
                </div>
              </div>
            );
          }

          if (m.kind === 'txn') {
            const tx = m.txn_id ? txnById.get(m.txn_id) : undefined;
            if (!tx)
              return wrap(
                <div className="rise max-w-[88%] self-start rounded-2xl rounded-bl-sm border border-dashed border-line px-3.5 py-2 text-[12.5px] text-faint">
                  That entry was deleted.
                </div>
              );
            return wrap(
              <div className="rise w-[92%] self-start">
                <div
                  className="rounded-2xl rounded-bl-sm border border-line bg-surface p-3"
                  style={{ borderLeft: `3px solid ${tx.cat_color}` }}
                >
                  <div className="flex items-center gap-2">
                    <IconTile name={tx.cat_icon} color={tx.cat_color} size={32} />
                    <button
                      type="button"
                      onClick={() => setEditing(tx)}
                      className="min-w-0 flex-1 text-left active:opacity-70"
                    >
                      <span className="block truncate text-[14.5px] font-bold">{tx.cat_name}</span>
                      {tx.note && <span className="block truncate text-xs text-dim">{tx.note}</span>}
                    </button>
                    <span
                      className={cx('tabular text-[17px] font-bold', tx.type === 'income' && 'text-brand')}
                    >
                      {tx.type === 'income' ? '+' : ''}
                      {fmt(tx.amount_minor)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeTxn(m)}
                      aria-label="Delete"
                      className="pl-1 text-faint active:opacity-60"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <MiniChip label={shortDayLabel(tx.local_date)} tone="accent" />
                    {tx.method && <MiniChip label={tx.method} />}
                    {tx.confidence < 0.6 && <MiniChip label="tap to fix" tone="warn" />}
                  </div>
                </div>
              </div>
            );
          }

          if (m.kind === 'answer') {
            const a = m.payload as Answer | null;
            if (!a) return null;
            const max = Math.max(1, ...a.bars.map((b) => b.value));
            return wrap(
              <div className="rise w-[94%] self-start rounded-2xl rounded-bl-sm border border-line bg-surface p-3.5">
                <p className="text-[11.5px] font-bold uppercase tracking-wider text-dim">{a.headline}</p>
                <p className="tabular mt-1 text-3xl font-extrabold">{a.value}</p>
                <p className="mt-1 text-[13px] leading-5 text-dim">{a.detail}</p>
                {a.bars.length > 1 && (
                  <div className="mt-3 flex h-9 items-end gap-0.5">
                    {a.bars.map((b, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-sm bg-brand"
                        style={{
                          height: Math.max(2, (b.value / max) * 36),
                          opacity: b.value === 0 ? 0.15 : b.highlight ? 1 : 0.5,
                        }}
                      />
                    ))}
                  </div>
                )}
                {a.breakdown.length > 0 && (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {a.breakdown.map((b, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="size-2 rounded-sm" style={{ background: b.color }} />
                        <span className="flex-1 truncate text-[12.5px] text-dim">{b.name}</span>
                        <span className="tabular text-[12.5px] font-semibold text-dim">{fmt(b.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return wrap(
            <div className="rise max-w-[88%] self-start">
              <div className="rounded-2xl rounded-bl-sm bg-sunken px-3.5 py-2.5 text-[13.5px] leading-5 text-dim">
                {m.text}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* tap a category, then just type the amount */}
      {showPicker && (
        <div
          className="fixed inset-x-0 z-20 border-t border-line bg-surface"
          style={{ bottom: 'calc(var(--dock) + 61px)' }}
        >
          <div className="no-scrollbar mx-auto flex max-w-2xl gap-2 overflow-x-auto px-3 py-2.5">
            {categories
              .filter((c) => c.kind === 'expense' && !c.archived)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    const word = (c.keywords.split('|')[0] || c.name.split(' ')[0]).toLowerCase();
                    setInput((prev) => (prev.trim() ? prev.trim() + ' ' : '') + word + ' ');
                    taRef.current?.focus();
                  }}
                  className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 rounded-xl border border-line bg-sunken py-2 transition active:scale-95"
                  style={{ color: c.color }}
                >
                  <CategoryIcon name={c.icon} size={19} />
                  <span className="w-full truncate px-1 text-center text-[9.5px] font-semibold text-dim">
                    {c.name}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}

      {scanError && (
        <div className="fixed inset-x-0 z-30 px-3" style={{ bottom: 'calc(var(--dock) + 58px)' }}>
          <p className="mx-auto max-w-2xl rounded-xl border border-down/40 bg-down-soft px-3 py-2 text-[12.5px] text-down">
            {scanError}
          </p>
        </div>
      )}

      {/* composer */}
      <div
        className="fixed inset-x-0 z-30 border-t border-line bg-surface px-3 py-2.5"
        style={{ bottom: 'var(--dock)' }}
      >
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <button
            type="button"
            onClick={() => setShowPicker((v) => !v)}
            aria-label="Categories"
            className={cx(
              'grid size-10 shrink-0 place-items-center rounded-xl transition active:scale-95',
              showPicker ? 'bg-brand-soft text-brand' : 'bg-sunken text-dim'
            )}
          >
            <LayoutGrid size={18} />
          </button>

          {/* No `capture` attribute: a phone then offers the camera AND the
              gallery, instead of forcing the camera and hiding saved photos. */}
          <input
            ref={shotRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void scanReceipt(f);
            }}
          />
          <button
            type="button"
            disabled={scanning}
            aria-label="Scan a receipt"
            onClick={() => shotRef.current?.click()}
            className={cx(
              'grid size-10 shrink-0 place-items-center rounded-xl transition active:scale-95 disabled:opacity-60',
              scanning ? 'bg-brand-soft text-brand' : 'bg-sunken text-dim'
            )}
          >
            {scanning ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
          </button>
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="send"
            name="entry"
            placeholder={pinnedIsToday ? 'food 300' : `Adding to ${dayLabel(pinnedDate)}…`}
            className="max-h-28 flex-1 resize-none rounded-[20px] bg-sunken px-4 py-2.5 text-[15.5px] outline-none"
          />
          <button
            type="button"
            onClick={send}
            disabled={!input.trim() || sending}
            aria-label="Send"
            className={cx(
              'grid size-10 shrink-0 place-items-center rounded-full text-lg transition active:scale-95',
              input.trim() ? 'bg-brand text-on-brand' : 'bg-sunken text-faint'
            )}
          >
            {sending ? <Spinner /> : <ArrowUp size={18} />}
          </button>
        </div>
      </div>

      <DatePicker
        open={showDate}
        value={pinnedDate}
        title="Add entries to…"
        onClose={() => setShowDate(false)}
        onPick={(d) => {
          setPinnedDate(d);
          setShowDate(false);
        }}
      />
      <ItemsEditor open={!!draft} txn={null} draft={draft} onClose={() => setDraft(null)} />
      <TxnEditor open={!!editing} txn={editing} onClose={() => setEditing(null)} />
      <TxnEditor open={creating} seed={{ local_date: pinnedDate }} onClose={() => setCreating(false)} />
    </div>
  );
}

function MiniChip({ label, tone }: { label: string; tone?: 'accent' | 'warn' }) {
  return (
    <span
      className={cx(
        'rounded-full px-2 py-0.5 text-[10.5px] font-bold',
        tone === 'accent' && 'bg-brand-soft text-brand',
        tone === 'warn' && 'bg-down-soft text-down',
        !tone && 'bg-sunken text-dim'
      )}
    >
      {label}
    </span>
  );
}
