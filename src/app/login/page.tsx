'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CircleAlert, Eye, EyeOff, Mail } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Button, cx, inputClass } from '@/components/ui';
import { CURRENCIES } from '@/lib/currency';

type Mode = 'signin' | 'signup';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/add';
  const wasRedirected = params.has('next');

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [currency, setCurrency] = useState('JPY');
  const [cycleDay, setCycleDay] = useState('1');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const weak = mode === 'signup' && password.length > 0 && password.length < 8;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const sb = supabaseBrowser();

      if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({
          email: email.trim(),
          password,
          // Carried on the account so the first load already knows who you are
          // and which currency to show, rather than defaulting and being wrong.
          options: {
            data: {
              full_name: name.trim(),
              currency_code: currency,
              cycle_start_day: Number(cycleDay) || 1,
            },
          },
        });
        if (error) throw error;

        if (data.session) {
          router.push(next);
          router.refresh();
        } else {
          setNotice(`Almost there — confirm the link we sent to ${email.trim()}, then sign in.`);
          setMode('signin');
          setPassword('');
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        router.push(next);
        router.refresh();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /invalid login/i.test(message)
          ? 'That email and password do not match an account.'
          : /already registered/i.test(message)
            ? 'An account already exists for that email. Try signing in.'
            : message
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div>
        <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-brand text-2xl font-extrabold text-on-brand">
          ¥
        </div>
        <h1 className="text-[30px] font-extrabold leading-tight tracking-tight">
          {mode === 'signin' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="mt-2 leading-relaxed text-dim">
          {mode === 'signin'
            ? 'Sign in to reach your expenses on any device.'
            : 'A minute to set up, then logging an expense takes one line of typing.'}
        </p>
      </div>

      {wasRedirected && mode === 'signin' && !error && (
        <p className="flex items-start gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-dim">
          <CircleAlert size={15} className="mt-0.5 shrink-0 text-brand" />
          Please sign in to continue — your data is tied to your account.
        </p>
      )}

      <form onSubmit={submit} className="flex flex-col gap-3">
        {mode === 'signup' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-dim">Your name</span>
            <input
              required
              autoComplete="name"
              placeholder="Adnan"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-dim">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-dim">Password</span>
          <span className="relative block">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={mode === 'signup' ? 8 : 6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cx(inputClass, 'pr-11')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-faint transition active:scale-90"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
          {weak && <span className="text-[11.5px] text-warn">Use at least 8 characters.</span>}
        </label>

        {mode === 'signup' && (
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-dim">Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.symbol.trim()} {c.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-32 flex-col gap-1.5">
              <span className="text-[12px] font-semibold text-dim">Month starts</span>
              <select value={cycleDay} onChange={(e) => setCycleDay(e.target.value)} className={inputClass}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? '1st (default)' : `${d}th`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {mode === 'signup' && (
          <p className="text-[11.5px] leading-4 text-faint">
            Paid on the 25th? Set it here and every summary follows your pay cycle instead of the calendar. You can
            change it later.
          </p>
        )}

        {error && (
          <p className="rounded-xl bg-down-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-down">{error}</p>
        )}
        {notice && (
          <p className="flex items-start gap-2 rounded-xl bg-up-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-up">
            <Mail size={15} className="mt-0.5 shrink-0" />
            {notice}
          </p>
        )}

        <Button type="submit" loading={busy} disabled={weak}>
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      <p className="text-center text-[13.5px] text-dim">
        {mode === 'signin' ? "Don't have an account?" : 'Already have one?'}{' '}
        <button
          type="button"
          className="font-semibold text-brand"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setNotice(null);
          }}
        >
          {mode === 'signin' ? 'Sign up' : 'Sign in'}
        </button>
      </p>

      <p className="text-center text-[11.5px] leading-5 text-faint">
        Your data is locked to your account by row-level security.
        <br />
        Add this page to your Home Screen for a fullscreen app.
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
