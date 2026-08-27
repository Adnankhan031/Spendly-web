'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabaseBrowser } from '@/lib/supabase/client';
import { StoreProvider } from '@/lib/store';
import { TabBar } from '@/components/TabBar';
import { PageTransition } from '@/components/PageTransition';
import { Spinner } from '@/components/ui';

/**
 * The app shell is a client component on purpose.
 *
 * It used to be a server component with force-dynamic, so every tab change cost
 * a server render plus a network call to Supabase to re-verify the user — on top
 * of the identical call the proxy had already made. Reading the session from the
 * cookie in the browser is instant, it lets the tab pages render statically, and
 * because a layout persists across sibling navigations this runs once per visit
 * rather than once per tab.
 *
 * Security is unchanged: row-level security is what actually protects the data,
 * so a forged session still reads nothing.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = supabaseBrowser();

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setUser(data.session.user);
      } else {
        setUser(null);
        router.replace('/login');
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setUser(session.user);
      } else {
        setUser(null);
        router.replace('/login');
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">Connect Supabase</h1>
        <p className="leading-relaxed text-dim">
          Set <code className="text-ink">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code className="text-ink">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then redeploy.
        </p>
        <Link href="/setup" className="font-semibold text-brand">
          Show me how →
        </Link>
      </main>
    );
  }

  if (user === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center text-dim">
        <Spinner size={22} />
      </div>
    );
  }

  if (!user) return null;

  return (
    <StoreProvider user={user}>
      <div className="safe-t mx-auto min-h-dvh w-full max-w-2xl pb-[calc(72px+env(safe-area-inset-bottom,0px))]">
        <PageTransition>{children}</PageTransition>
      </div>
      <TabBar />
    </StoreProvider>
  );
}
