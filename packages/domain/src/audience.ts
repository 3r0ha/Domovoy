import type { Translate } from '@domovoy/i18n';

import { audienceKey, targetKey } from './keys.js';
import { russian } from './moment.js';
import type { AnnouncementAudience, Apartment, RequestTarget } from './types.js';

/** Кто попадает в адресат объявления. */
export const isInAudience = (apartment: Apartment, audience: AnnouncementAudience): boolean => {
  if (apartment.buildingId !== audience.buildingId) return false;

  switch (audience.kind) {
    case 'building':
      return true;
    case 'entrance':
      return apartment.entrance === audience.entrance;
    case 'riser':
      return apartment.entrance === audience.entrance && apartment.riser === audience.riser;
  }
};

export const selectAudience = (apartments: readonly Apartment[], audience: AnnouncementAudience): Apartment[] =>
  apartments.filter((apartment) => isInAudience(apartment, audience));

/** Квартира над этой: этажа в карточке нет, порядок номеров в стояке и есть порядок этажей. */
export const flatAbove = (apartments: readonly Apartment[], flat: Apartment): Apartment | undefined =>
  apartments
    .filter(
      (apartment) =>
        apartment.buildingId === flat.buildingId &&
        apartment.entrance === flat.entrance &&
        apartment.riser === flat.riser &&
        apartment.number > flat.number,
    )
    .sort((left, right) => left.number - right.number)[0];

/** Адресат словами. Без переводчика строка русская: её читает смена. */
export const describeAudience = (audience: AnnouncementAudience, t: Translate = russian): string => {
  switch (audience.kind) {
    case 'building':
      return t(audienceKey('building'));
    case 'entrance':
      return t(audienceKey('entrance'), { подъезд: audience.entrance });
    case 'riser':
      return t(audienceKey('riser'), { подъезд: audience.entrance, стояк: audience.riser });
  }
};

/** Объявление, вытекающее из заявки. */
export const audienceForTarget = (target: RequestTarget): AnnouncementAudience | null => {
  switch (target.kind) {
    case 'riser':
      return { kind: 'riser', buildingId: target.buildingId, entrance: target.entrance, riser: target.riser };
    case 'entrance':
      return { kind: 'entrance', buildingId: target.buildingId, entrance: target.entrance };
    case 'equipment':
    case 'building':
      return { kind: 'building', buildingId: target.buildingId };
    case 'apartment':
      return null;
  }
};

/**
 * Описание объекта заявки: без него диспетчер звонит и уточняет адрес.
 * Название оборудования берётся из справочника дома и не переводится.
 */
export const describeTarget = (
  target: RequestTarget,
  apartmentNumber?: number,
  t: Translate = russian,
): string => {
  switch (target.kind) {
    case 'apartment': {
      const number = apartmentNumber ?? target.number;

      return number === undefined ? t(targetKey('apartmentAny')) : t(targetKey('apartment'), { номер: number });
    }
    case 'entrance':
      return t(targetKey('entrance'), { подъезд: target.entrance });
    case 'riser':
      return t(targetKey('riser'), { подъезд: target.entrance, стояк: target.riser });
    case 'equipment':
      return target.title ?? t(targetKey('equipment'), { код: target.equipmentId });
    case 'building':
      return t(targetKey('building'));
  }
};
