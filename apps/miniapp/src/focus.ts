import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Фокус остаётся в окне, пока оно открыто. Без этого Tab уходит на экран под
 * окном: человек с клавиатуры или с озвучкой набирает вслепую по тому, чего
 * не видит, а вернуться к окну ему нечем.
 */
export const useTrapped = <T extends HTMLElement>(open: boolean): RefObject<T | null> => {
  const box = useRef<T>(null);

  useEffect(() => {
    const node = box.current;

    if (!open || !node) return undefined;

    const inside = (): HTMLElement[] => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const came = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const wanted = node.querySelector<HTMLElement>('[autofocus]') ?? inside()[0];

    wanted?.focus();

    const keep = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;

      const items = inside();
      const edge = event.shiftKey ? items[0] : items.at(-1);

      if (!edge) {
        event.preventDefault();
        return;
      }

      if (document.activeElement !== edge && node.contains(document.activeElement)) return;

      event.preventDefault();
      (event.shiftKey ? items.at(-1) : items[0])?.focus();
    };

    document.addEventListener('keydown', keep, true);

    return () => {
      document.removeEventListener('keydown', keep, true);
      // Фокус возвращается туда, откуда окно открыли: иначе он падает в начало страницы.
      came?.focus();
    };
  }, [open]);

  return box;
};
