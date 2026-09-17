import { useEffect, useRef } from 'react';

/**
 * Узор, который рисуется линией. Разметка инлайном: пунктир браузер ведёт
 * только по путям в самом документе.
 */
const loaded = new Map<string, Promise<string>>();

const load = (url: string): Promise<string> => {
  const known = loaded.get(url);

  if (known) return known;

  const wanted = fetch(url)
    .then((response) => (response.ok ? response.text() : ''))
    .catch(() => '');

  loaded.set(url, wanted);

  return wanted;
};

const calm = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Замедление из адреса: `?slow=8` растягивает отрисовку, чтобы её разглядеть. */
const slower = (): number => {
  const asked = Number(new URLSearchParams(location.search).get('slow'));

  return Number.isFinite(asked) && asked >= 1 && asked <= 40 ? asked : 1;
};

/** Счётчик узоров на странице: по нему строятся уникальные имена. */
let drawn = 0;

/** Ссылки внутри узора: маска, обрезка и повтор фигуры. */
const LINKS = ['mask', 'clip-path', 'href', 'xlink:href'];

/** Даёт всем именам внутри узора свою метку, вместе со ссылками на них. */
const rename = (node: HTMLElement, tag: number): void => {
  const names = new Map<string, string>();

  for (const found of node.querySelectorAll<SVGElement>('[id]')) {
    const now = `${found.id}-${tag}`;

    names.set(found.id, now);
    found.id = now;
  }

  for (const found of node.querySelectorAll<SVGElement>('*')) {
    for (const link of LINKS) {
      const value = found.getAttribute(link);
      const was = value?.startsWith('url(#')
        ? value.slice(5, -1)
        : value?.startsWith('#')
          ? value.slice(1)
          : undefined;
      const now = was === undefined ? undefined : names.get(was);

      if (now) found.setAttribute(link, value?.startsWith('#') ? `#${now}` : `url(#${now})`);
    }
  }
};

/** Отрисовка начинается после загрузки страницы. */
const settled = (): Promise<void> =>
  document.readyState === 'complete'
    ? Promise.resolve()
    : new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }));

export interface InkProps {
  src: string;
  className?: string;
  /** Рисовать сразу или дождаться, пока до узора долистают. */
  when?: 'load' | 'seen';
  /** Подпись для тех, кто картинку не видит. */
  label?: string;
  /** Темп отрисовки: меньше единицы означает быстрее. */
  pace?: number;
}

export const Ink = ({ src, className, when = 'load', label, pace = 1 }: InkProps) => {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = box.current;

    if (!node) return undefined;

    let alive = true;

    const show = async (): Promise<void> => {
      const [markup] = await Promise.all([load(src), settled()]);

      if (!alive) return;

      if (!markup.includes('<svg')) {
        node.innerHTML = `<img src="${src}" alt="">`;
        return;
      }

      node.innerHTML = markup;

      rename(node, (drawn += 1));

      if (calm()) return;

      const mask = node.querySelector('mask');
      const fill = node.querySelector('.ink-fill');

      if (mask && fill && !fill.getAttribute('mask')) fill.setAttribute('mask', `url(#${mask.id})`);

      node.style.setProperty('--slow', `${slower() * pace}`);
      node.classList.add('ink-draw');
    };

    if (when === 'load' || calm() || typeof IntersectionObserver !== 'function') {
      void show();

      return () => {
        alive = false;
      };
    }

    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        watcher.disconnect();
        void show();
      },
      { threshold: 0.3 },
    );

    watcher.observe(node);

    return () => {
      alive = false;
      watcher.disconnect();
    };
  }, [src, when, pace]);

  return (
    <div
      className={className ? `ink ${className}` : 'ink'}
      ref={box}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
};
