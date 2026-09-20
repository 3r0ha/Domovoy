import { apartmentKeyParam } from './apartment-code.js';
import { botLinkTo, buildBotDeepLink, encodeTarget } from './deep-link.js';
import { DomainError, type RequestTarget } from './types.js';

/** Наклейка объекта: код ведёт в переписку, подпись объясняет человеку, что это. */
export interface StickerPlan {
  target: RequestTarget;
  /** Что за объект: подъезд, стояк, лифт, квартира. */
  caption: string;
  link: string;
  payload: string;
}

/** Квартира глазами наклеек: из них берутся подъезды и стояки дома. */
export interface StickerApartment {
  id: string;
  number: number;
  entrance?: number;
  riser?: number;
  /** Код из квитанции. Без него код квартиры не печатается. */
  code?: string;
}

export interface StickerPlanOptions {
  botName: string;
  buildingId: string;
  /** Квартиры дома: по ним считаются подъезды и стояки. */
  apartments?: StickerApartment[];
  /** Коды оборудования: лифты, домофоны, узлы учёта. */
  equipment?: { code: string; title: string }[];
  /** Коды квартир печатаются в квитанциях, а не клеятся на стену. */
  withApartments?: boolean;
}

/** Подъезды дома со стояками каждого. */
const layoutOf = (apartments: StickerApartment[]): Map<number, number[]> => {
  const layout = new Map<number, Set<number>>();

  for (const apartment of apartments) {
    if (apartment.entrance === undefined) continue;

    const risers = layout.get(apartment.entrance) ?? new Set<number>();

    if (apartment.riser !== undefined) risers.add(apartment.riser);
    layout.set(apartment.entrance, risers);
  }

  return new Map(
    [...layout.entries()]
      .sort(([left], [right]) => left - right)
      .map(([entrance, risers]) => [entrance, [...risers].sort((left, right) => left - right)]),
  );
};

/** Что и куда клеить. */
export const planStickers = (options: StickerPlanOptions): StickerPlan[] => {
  const plans: StickerPlan[] = [];
  const apartments = options.apartments ?? [];

  const add = (target: RequestTarget, caption: string): void => {
    plans.push({
      target,
      caption,
      link: buildBotDeepLink(options.botName, target),
      payload: encodeTarget(target),
    });
  };

  for (const [entrance, risers] of layoutOf(apartments)) {
    add({ kind: 'entrance', buildingId: options.buildingId, entrance }, `Подъезд ${entrance}`);

    for (const riser of risers) {
      add(
        { kind: 'riser', buildingId: options.buildingId, entrance, riser },
        `Подъезд ${entrance}, стояк ${riser}`,
      );
    }
  }

  for (const item of options.equipment ?? []) {
    add({ kind: 'equipment', buildingId: options.buildingId, equipmentId: item.code }, item.title);
  }

  if (options.withApartments) {
    for (const apartment of [...apartments].sort((left, right) => left.number - right.number)) {
      // В коде квартиры лежит код из квитанции, а не её идентификатор: по нему
      // квартира привязывается к человеку, поэтому подобрать его нельзя.
      if (!apartment.code) continue;

      const payload = apartmentKeyParam(apartment.code);

      plans.push({
        target: { kind: 'apartment', apartmentId: apartment.id },
        caption: `Квартира ${apartment.number}: код для квитанции`,
        link: botLinkTo(options.botName, payload),
        payload,
      });
    }
  }

  return plans;
};

export interface StickerStyle {
  title: string;
  /** Фон наклейки. */
  paper: string;
  /** Цвет кода и подписи. */
  ink: string;
  /** Цвет уголков-искателей: он и отличает стиль издалека. */
  accent: string;
  /** Второй цвет фона для перелива. Пусто: фон ровный. */
  paperEnd?: string;
  /** Цвет подписей на фоне. Пусто: тот же, что у кода. */
  text?: string;
}

export const STICKER_STYLES = {
  classic: { title: 'Классика', paper: '#f6f6f4', paperEnd: '#e9e9e4', ink: '#151515', accent: '#151515' },
  sky: { title: 'Небо', paper: '#e4eeff', paperEnd: '#cfe0ff', ink: '#0d2a66', accent: '#2f6fe4' },
  grass: { title: 'Трава', paper: '#e3f6e9', paperEnd: '#c9ecd6', ink: '#0f3d27', accent: '#22a06b' },
  sunset: { title: 'Закат', paper: '#ffeede', paperEnd: '#ffd9c2', ink: '#5e2408', accent: '#f26a1b' },
  night: { title: 'Ночь', paper: '#161a2b', paperEnd: '#0b0e1a', ink: '#12162a', accent: '#4a7fe8', text: '#f4f6fb' },
} as const satisfies Record<string, StickerStyle>;

export type StickerStyleName = keyof typeof STICKER_STYLES;

export const DEFAULT_STICKER_STYLE: StickerStyleName = 'classic';

export const isStickerStyle = (name: string): name is StickerStyleName => name in STICKER_STYLES;

/** Своя надпись под кодом. */
export const STICKER_NOTE_MAX_LENGTH = 80;

/** Надпись жильца: печатается на самой наклейке, поэтому длину ограничивает лист. @throws {DomainError} */
export const cleanStickerNote = (note: string | undefined): string | undefined => {
  const clean = note?.replace(/\s+/g, ' ').trim();

  if (!clean) return undefined;

  if (clean.length > STICKER_NOTE_MAX_LENGTH) {
    throw new DomainError('note_too_long', `Надпись длиннее ${STICKER_NOTE_MAX_LENGTH} символов не поместится`);
  }

  return clean;
};

/** Как нарисовать наклейку. */
export interface StickerLook {
  style?: StickerStyleName;
  /** Своя надпись под кодом. */
  note?: string;
  /** Сторона картинки в точках. */
  size?: number;
}

/** Имя файла наклейки: по нему её находят среди скачанных. */
export const stickerFileName = (plan: StickerPlan, extension: string): string =>
  `${plan.payload}.${extension}`;
