'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabase/client';
import * as q from './queries';
import { formatMoney, todayLocal } from './format';
import { CURRENCIES, DEFAULT_CURRENCY, currencyByCode, type Currency } from './currency';
import type { Account, Alias, Budget, Category, TxnView } from './types';

type Store = {
  /** The layout redirects to /login before rendering, so this is always set. */
  user: User;
  loading: boolean;
  error: string | null;
  categories: Category[];
  accounts: Account[];
  txns: TxnView[];
  aliases: Alias[];
  aliasMap: Map<string, string>;
  budgets: Budget[];
  currency: Currency;
  setCurrencyCode: (code: string) => void;
  cycleStartDay: number;
  setCycleStartDay: (d: number) => void;
  pinnedDate: string;
  setPinnedDate: (d: string) => void;
  fmt: (minor: number) => string;
  fmtCompact: (minor: number) => string;
  displayName: string;
  refresh: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ user, children }: { user: User; children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<TxnView[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [currencyCode, setCode] = useState(DEFAULT_CURRENCY);
  const [cycleStartDay, setDay] = useState(1);
  const [pinnedDate, setPinnedDate] = useState(todayLocal());

  // Seeding and the catalogue migrations only need to happen once per visit,
  // not after every entry the user adds.
  const migrated = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      let cats: Category[];

      if (!migrated.current) {
        await q.ensureSeeded(user.id);
        cats = await q.fetchCategories();
        cats = await q.migrateCategoryIcons(cats);
        cats = await q.syncSeedCategories(user.id, cats);
        migrated.current = true;
      } else {
        cats = await q.fetchCategories();
      }

      const [accs, rows, als, buds, settings] = await Promise.all([
        q.fetchAccounts(),
        q.fetchTxns(),
        q.fetchAliases(),
        q.fetchBudgets(),
        q.fetchSettings(),
      ]);
      setCategories(cats);
      setAccounts(accs);
      setTxns(q.withCategory(rows, cats));
      setAliases(als);
      setBudgets(buds);
      if (settings.currencyCode && CURRENCIES.some((c) => c.code === settings.currencyCode)) {
        setCode(settings.currencyCode);
      }
      // Fall back to what was chosen at signup before defaulting.
      const meta = (user.user_metadata ?? {}) as { currency_code?: string; cycle_start_day?: number };
      if (!settings.currencyCode && meta.currency_code && CURRENCIES.some((c) => c.code === meta.currency_code)) {
        setCode(meta.currency_code);
        void q.setSetting(user.id, 'currencyCode', meta.currency_code);
      }
      const day = Number(settings.cycleStartDay ?? meta.cycle_start_day ?? 1);
      if (Number.isFinite(day) && day >= 1 && day <= 31) setDay(day);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setCurrencyCode = useCallback(
    (code: string) => {
      setCode(code);
      void q.setSetting(user.id, 'currencyCode', code);
    },
    [user.id]
  );

  const setCycleStartDay = useCallback(
    (d: number) => {
      const day = Math.min(31, Math.max(1, Math.round(d)));
      setDay(day);
      void q.setSetting(user.id, 'cycleStartDay', String(day));
    },
    [user.id]
  );

  const currency = useMemo(() => currencyByCode(currencyCode), [currencyCode]);

  const aliasMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of aliases) m.set(a.keyword, a.category_id);
    return m;
  }, [aliases]);

  const fmt = useCallback(
    (minor: number) =>
      formatMoney(minor, { symbol: currency.symbol, style: currency.grouping, digits: currency.digits }),
    [currency]
  );
  const fmtCompact = useCallback(
    (minor: number) =>
      formatMoney(minor, {
        symbol: currency.symbol,
        style: currency.grouping,
        digits: currency.digits,
        compact: true,
      }),
    [currency]
  );

  const value: Store = {
    user,
    loading,
    error,
    categories,
    accounts,
    txns,
    aliases,
    aliasMap,
    budgets,
    currency,
    setCurrencyCode,
    cycleStartDay,
    setCycleStartDay,
    pinnedDate,
    setPinnedDate,
    fmt,
    fmtCompact,
    displayName:
      ((user.user_metadata ?? {}) as { full_name?: string }).full_name?.trim() ||
      user.email?.split('@')[0] ||
      'there',
    refresh,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

export async function signOut() {
  await supabaseBrowser().auth.signOut();
  window.location.href = '/login';
}
