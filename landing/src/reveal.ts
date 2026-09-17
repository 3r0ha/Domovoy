import { useEffect } from 'react';

/**
 * Появление при прокрутке: разметка помечается `data-reveal`, показ включает
 * класс, анимацию ведёт CSS.
 */
const SHOWN = 'reveal-in';

const calm = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const useReveal = (): void => {
  useEffect(() => {
    const targets = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];

    if (calm() || typeof IntersectionObserver !== 'function') {
      for (const target of targets) target.classList.add(SHOWN);

      return undefined;
    }

    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          entry.target.classList.add(SHOWN);
          watcher.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );

    for (const target of targets) watcher.observe(target);

    return () => watcher.disconnect();
  }, []);
};
