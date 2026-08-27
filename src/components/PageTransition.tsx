'use client';

import { usePathname } from 'next/navigation';

/**
 * Keyed on the route, so switching tabs remounts and replays the lift-in
 * animation rather than swapping content in place with no transition.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-in">
      {children}
    </div>
  );
}
