'use client';

import { useEffect, useState } from 'react';

/**
 * How many pixels of the window the on-screen keyboard is covering.
 *
 * iOS Safari does not shrink the layout viewport when the keyboard opens, and
 * `100dvh` does not react to it either — the page keeps its full height and the
 * keyboard is simply drawn on top. Anything pinned to the bottom therefore ends
 * up underneath it, which is why the composer and the edit sheet were both
 * unreachable on the phone.
 *
 * `visualViewport` is the only thing that actually knows. The inset is the gap
 * between the bottom of the layout viewport and the bottom of the visible area;
 * `offsetTop` is included because Safari scrolls the visual viewport up when a
 * focused field would otherwise be hidden.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const read = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Small values are the URL bar collapsing, not a keyboard.
      setInset(covered > 90 ? Math.round(covered) : 0);
    };

    read();
    vv.addEventListener('resize', read);
    vv.addEventListener('scroll', read);
    return () => {
      vv.removeEventListener('resize', read);
      vv.removeEventListener('scroll', read);
    };
  }, []);

  return inset;
}

/**
 * Height of the area the user can actually see, in pixels.
 *
 * Used to cap sheets so their content and buttons stay above the keyboard
 * instead of being cut off by it.
 */
export function useViewportHeight(): number | null {
  const [h, setH] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const read = () => setH(Math.round(vv ? vv.height : window.innerHeight));
    read();
    if (vv) {
      vv.addEventListener('resize', read);
      vv.addEventListener('scroll', read);
      return () => {
        vv.removeEventListener('resize', read);
        vv.removeEventListener('scroll', read);
      };
    }
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  return h;
}
