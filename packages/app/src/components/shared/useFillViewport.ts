import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The height that makes an element reach the bottom of the window: measured from where it starts, again on every
 * resize and whenever `deps` change (content above it appearing or going). A fixed height (100vh minus a guess) is
 * cut on a laptop screen and leaves two scroll bars, the page's and the element's.
 */
export function useFillViewport<T extends HTMLElement>(deps: unknown[] = [], { min = 400, bottom = 24 } = {}) {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(600);
  const fit = useCallback(() => {
    const top = ref.current?.getBoundingClientRect().top;
    if (top !== undefined) setHeight(Math.max(min, Math.floor(window.innerHeight - top - bottom)));
  }, [min, bottom]);
  useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, ...deps]);
  return { ref, height };
}
