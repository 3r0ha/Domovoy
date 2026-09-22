import { useEffect, useRef, useState } from 'react';

import { useTrapped } from '../focus.js';
import { useT } from '../i18n.js';

/** Шаг тура: что подсвечиваем и что об этом говорим. */
export interface TourStep {
  /** Значение `data-guide` у элемента, который подсвечиваем. */
  anchor: string;
  title: string;
  text: string;
}

export interface TourProps {
  steps: readonly TourStep[];
  onDone: () => void;
}

interface Hole {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Где на экране стоит элемент шага. Пусто, если элемента нет. */
const holeFor = (anchor: string): Hole | null => {
  const element = globalThis.document.querySelector(`[data-guide="${anchor}"]`);

  if (!element) return null;

  const box = element.getBoundingClientRect();

  if (box.width === 0 && box.height === 0) return null;

  const padding = 6;

  return {
    top: box.top - padding,
    left: box.left - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
};

/**
 * Тур при первом входе: экран затемняется, кроме того места, о котором речь.
 * Шаг без элемента на экране пропускается: тур не показывает пустоту.
 */
export const Tour = ({ steps, onDone }: TourProps) => {
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Hole | null>(null);

  const step = steps[index];
  // Эффект держится за якорь и за ссылку на обработчик: иначе он уходил бы заново каждый рендер.
  const anchor = step?.anchor;
  const done = useRef(onDone);
  const card = useTrapped<HTMLElement>(true);
  const t = useT();

  done.current = onDone;

  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') done.current();
    };

    globalThis.addEventListener('keydown', close);

    return () => globalThis.removeEventListener('keydown', close);
  }, []);

  useEffect(() => {
    if (anchor === undefined) {
      done.current();
      return undefined;
    }

    const measure = (): void => setHole(holeFor(anchor));

    measure();

    globalThis.addEventListener('resize', measure);
    // Подсветка держится за элементом, а прокручивается рабочая область, а не
    // окно. Событие прокрутки не всплывает, поэтому его слушают на перехвате.
    document.addEventListener('scroll', measure, { capture: true, passive: true });

    return () => {
      globalThis.removeEventListener('resize', measure);
      document.removeEventListener('scroll', measure, { capture: true });
    };
  }, [anchor]);

  if (!step) return null;

  const last = index === steps.length - 1;
  const next = (): void => (last ? onDone() : setIndex((current) => current + 1));

  // Подпись встаёт под подсветкой, а если места снизу нет, над ней.
  const below = hole ? hole.top + hole.height < globalThis.innerHeight / 2 : true;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={step.title}>
      <button type="button" className="tour-veil" aria-label={t('tour.skip.aria')} onClick={onDone} />

      {hole ? (
        <span
          className="tour-hole"
          aria-hidden="true"
          style={{ top: `${hole.top}px`, left: `${hole.left}px`, width: `${hole.width}px`, height: `${hole.height}px` }}
        />
      ) : null}

      <section
        ref={card}
        className={below ? 'tour-card tour-card-below' : 'tour-card tour-card-above'}
        style={hole ? (below ? { top: `${hole.top + hole.height + 12}px` } : { bottom: `${globalThis.innerHeight - hole.top + 12}px` }) : {}}
      >
        <h2>{step.title}</h2>
        <p className="hint">{step.text}</p>

        <div className="tour-actions">
          <span className="hint aside">{t('tour.step', { номер: index + 1, всего: steps.length })}</span>

          <button type="button" className="link" onClick={onDone}>
            {t('tour.skip')}
          </button>

          <button type="button" className="tour-next" onClick={next}>
            {last ? t('tour.done') : t('tour.next')}
          </button>
        </div>
      </section>
    </div>
  );
};
