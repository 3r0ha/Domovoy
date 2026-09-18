import { useCallback, useMemo, useState } from 'react';

import type { Profile } from './views.js';

export type Screen =
  | 'new'
  | 'list'
  | 'home'
  | 'camera'
  | 'guest'
  | 'journal'
  | 'meters'
  | 'news'
  | 'broadcast'
  | 'polls'
  | 'profile'
  | 'support'
  | 'stickers'
  | 'quality'
  | 'document'
  | 'audit'
  | 'tariffs'
  | 'house-meters'
  | 'capital'
  | 'debtors'
  | 'import'
  | 'queue'
  | 'report'
  | 'bind'
  | 'residents'
  | 'more'
  | 'help'
  | 'object'
  | 'equipment'
  | 'plan'
  | 'buildings'
  | 'inspections'
  | 'visits'
  | 'demo'
  | 'request';

export interface Screens {
  /** Верхний экран стопки; пустая стопка означает «показать стартовый». */
  top: Screen | undefined;
  /** Экран под верхним: туда и вернёт «назад». */
  under: Screen | undefined;
  deep: boolean;
  open: (screen: Screen) => void;
  /** `base` кладётся под низ, если стопка ещё пуста: с неё и начинали. */
  push: (screen: Screen, base: Screen) => void;
  back: () => void;
  /** Начальная стопка. Ничего не делает, если человек уже куда-то перешёл. */
  seed: (stack: Screen[]) => void;
}

/** Стопка экранов: вкладка начинает новую, переход вглубь добавляет лист. */
export const useScreens = (): Screens => {
  const [stack, setStack] = useState<Screen[]>([]);

  // Переходы держатся за одну ссылку: иначе эффекты, которые на них смотрят, идут заново каждый рендер.
  const open = useCallback((next: Screen) => setStack([next]), []);

  const push = useCallback(
    (next: Screen, base: Screen) =>
      setStack((current) => (current.length > 0 ? [...current, next] : [base, next])),
    [],
  );

  const back = useCallback(() => setStack((current) => current.slice(0, -1)), []);
  const seed = useCallback((next: Screen[]) => setStack((current) => (current.length > 0 ? current : next)), []);

  return useMemo(
    () => ({ top: stack.at(-1), under: stack.at(-2), deep: stack.length > 1, open, push, back, seed }),
    [stack, open, push, back, seed],
  );
};

/** С чего человек начинает: сотрудник со смены, жилец со своих заявок. */
export const startScreen = (profile: Profile): Screen => {
  // Мастер и подрядчик работают по своим нарядам, очередь дома, дело диспетчера.
  if (profile.role === 'contractor' || profile.role === 'technician') return 'list';
  if (profile.role !== 'resident') return 'queue';

  return profile.apartmentId === null ? 'bind' : 'list';
};

/** Что написано в шапке. Разделы называет их же список, остальное само по себе. */
export const titleFor = (
  screen: Screen,
  named: { object: string | null; device: string | null; document: string | null; section: string | undefined },
): string => {
  const own: Partial<Record<Screen, string | null>> = {
    new: 'Новая заявка',
    more: 'Ещё',
    request: 'Заявка',
    journal: 'Журнал',
    object: named.object ?? 'Объект',
    camera: named.device ?? '',
    guest: named.device ?? '',
    document: named.document ?? 'Документ',
  };

  return own[screen] ?? named.section ?? '';
};

/** Разделы, на которые ведут ссылки из чата: `?startapp=go-queue`. */
const LINKED: readonly Screen[] = [
  'list',
  'queue',
  'news',
  'meters',
  'polls',
  'support',
  'stickers',
  'debtors',
  'report',
  'home',
  'plan',
  'equipment',
  'inspections',
  'residents',
  'audit',
  'tariffs',
  'house-meters',
  'capital',
  'buildings',
  'import',
  'quality',
  'broadcast',
  'visits',
  'profile',
];

/** Приставка ссылки на раздел: та же, что в `@domovoy/domain`. */
const SECTION_PREFIX = 'go-';

/** Параметр ведёт в раздел, а не на объект: паспорт по нему открывать не нужно. */
export const isSectionParam = (param?: string): boolean => param !== undefined && param.startsWith(SECTION_PREFIX);

/** Раздел из параметра запуска. Пусто, если параметр ведёт на объект, а не в раздел. */
export const screenFromStartParam = (param?: string): Screen | undefined => {
  if (!isSectionParam(param)) return undefined;

  const name = (param ?? '').slice(SECTION_PREFIX.length) as Screen;

  return LINKED.includes(name) ? name : undefined;
};

/** Запасной путь к коду объекта: на стенде разработки платформы нет. */
export const startParamFromUrl = (): string | undefined => {
  if (typeof globalThis.location === 'undefined') return undefined;

  return new URLSearchParams(globalThis.location.search).get('startapp') ?? undefined;
};
