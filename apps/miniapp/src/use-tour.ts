import { useBridge } from '@maxkit/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { TourStep } from './screens/Tour.js';
import type { Section } from './sections.js';

/** Отметка о том, что тур уже проходили. */
const SEEN_KEY = 'tour-seen';

/**
 * Вторая отметка рядом с хранилищем клиента: у части клиентов оно живёт
 * до перезагрузки, и без неё тур встречал бы человека каждый раз.
 */
const remembered = (): string | null => {
  try {
    return globalThis.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};

const remember = (): void => {
  try {
    globalThis.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Хранилища нет: тур покажется ещё раз, это не ошибка.
  }
};

/** Шаги тура собираются из тех разделов, которые у человека на панели. */
const tourSteps = (sections: readonly Section[], demo = false): TourStep[] => [
  ...sections.slice(0, 3).map((section) => ({
    anchor: `tab-${section.screen}`,
    title: section.title,
    text: section.hint,
  })),
  {
    anchor: 'assistant',
    title: 'Помощник',
    text: 'Спросите словами, что нужно. Он ответит и откроет нужный раздел.',
  },
  // В режиме проверки роль примеряется здесь же: иначе жюри заводит пять учётных записей.
  ...(demo
    ? [
        {
          anchor: 'tab-more',
          title: 'Роль для проверки',
          text: 'В разделе «Ещё» лежит «Роль»: смотрите продукт глазами жильца, диспетчера, мастера или управляющего.',
        },
      ]
    : []),
];

/**
 * Тур при первом входе: показывается один раз, дальше его зовут из «Помощника».
 * До привязки квартиры тур не идёт: разделы за вкладками ещё пустые.
 */
export const useTour = (
  sections: readonly Section[],
  demo = false,
  ready = true,
): { tour: TourStep[]; endTour: () => void } => {
  const bridge = useBridge();
  const [open, setOpen] = useState(false);

  const mark = useCallback((): void => {
    remember();
    void bridge.DeviceStorage.setItem(SEEN_KEY, '1').catch(() => undefined);
  }, [bridge]);

  useEffect(() => {
    let active = true;

    const start = async (): Promise<void> => {
      if (!ready) return;

      const stored = await bridge.DeviceStorage.getItem(SEEN_KEY).catch(() => null);

      if (stored ?? remembered()) return;
      if (!active) return;

      setOpen(true);
      // Отметка ставится сразу: тур встречает один раз, чем бы ни кончился первый заход.
      mark();
    };

    void start();

    return () => {
      active = false;
    };
    // Отметку ставит сам эффект, поэтому пересоздавать его не на что.
  }, [bridge, ready]);

  const endTour = useCallback(() => {
    setOpen(false);
    mark();
  }, [mark]);

  // Шаги держатся за одну ссылку: подсветка тура смотрит на них из эффекта.
  const tour = useMemo(() => (open ? tourSteps(sections, demo) : []), [open, sections, demo]);

  return { tour, endTour };
};
