import { useBridge } from '@maxkit/react';
import { useEffect, useState } from 'react';

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
export const tourSteps = (sections: readonly Section[], demo = false): TourStep[] => [
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

/** Тур при первом входе: показывается один раз, дальше его зовут из «Помощника». */
export const useTour = (
  sections: readonly Section[],
  demo = false,
): { tour: TourStep[]; endTour: () => void } => {
  const bridge = useBridge();
  const [open, setOpen] = useState(false);

  const mark = (): void => {
    remember();
    void bridge.DeviceStorage.setItem(SEEN_KEY, '1').catch(() => undefined);
  };

  useEffect(() => {
    let active = true;

    const start = async (): Promise<void> => {
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
  }, [bridge]);

  return {
    tour: open ? tourSteps(sections, demo) : [],
    endTour: () => {
      setOpen(false);
      mark();
    },
  };
};
