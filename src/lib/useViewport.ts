'use client';

import { useEffect, useState } from 'react';

/**
 * Publishes the on-screen keyboard's height as a CSS variable.
 *
 * iOS Safari does not shrink the layout viewport when the keyboard opens — it
 * draws the keyboard on top — and `100dvh` does not react either. `visualViewport`
 * is the only thing that knows, so the height goes out as `--kb` and a
 * `data-kb` flag on <html>, and the layout is expressed in CSS against those.
 *
 * Two things here are deliberate, because getting them wrong makes the whole
 * interface shake:
 *
 * 1. The height is `innerHeight - vv.height` and nothing else. `vv.offsetTop` is
 *    how far the visual viewport has been *scrolled*, not how tall the keyboard
 *    is. Subtracting it created a loop — Safari scrolls to reveal the focused
 *    field, the measurement changes, the composer moves, Safari scrolls again.
 *
 * 2. Only `resize` is observed, never `scroll`, for the same reason. And the
 *    value is written straight to the DOM rather than into React state, so a
 *    keyboard animating open repaints a variable instead of re-rendering the
 *    tree sixty times.
 */
function measure(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const covered = window.innerHeight - vv.height;
  // Below this it is the URL bar collapsing, not a keyboard.
  return covered > 120 ? Math.round(covered) : 0;
}

let listeners = 0;
let detach: (() => void) | null = null;
const subscribers = new Set<(open: boolean) => void>();

function start() {
  const vv = window.visualViewport;
  if (!vv) return;
  let last = -1;

  const apply = () => {
    const kb = measure();
    // Ignore sub-pixel churn while the keyboard animates.
    if (Math.abs(kb - last) < 2) return;
    last = kb;
    const root = document.documentElement;
    root.style.setProperty('--kb', `${kb}px`);
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    const open = kb > 0;
    if ((root.dataset.kb === '1') !== open) {
      root.dataset.kb = open ? '1' : '0';
      subscribers.forEach((fn) => fn(open));
    }
  };

  apply();
  vv.addEventListener('resize', apply);
  detach = () => vv.removeEventListener('resize', apply);
}

/**
 * Keeps the CSS variables live, and reports only whether the keyboard is open.
 *
 * The boolean changes twice per keyboard, so components can re-render on it
 * safely; anything that needs the actual height should read `var(--kb)`.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (listeners === 0) start();
    listeners += 1;
    subscribers.add(setOpen);
    setOpen(document.documentElement.dataset.kb === '1');

    return () => {
      subscribers.delete(setOpen);
      listeners -= 1;
      if (listeners === 0) {
        detach?.();
        detach = null;
        document.documentElement.style.removeProperty('--kb');
        document.documentElement.dataset.kb = '0';
      }
    };
  }, []);

  return open;
}
