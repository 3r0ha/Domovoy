import type { Translate } from '@domovoy/i18n';

import { responsibleKey, zoneKey, zoneNextKey } from './keys.js';
import { russian } from './moment.js';
import type { RequestCategory, RequestTarget } from './types.js';

/**
 * Кто отвечает за проблему. Граница между зонами задана правилами содержания
 * общего имущества, а не договором конкретной организации.
 */
export type ResponsibleKind = 'management' | 'resource' | 'contractor' | 'municipal' | 'owner';

export interface Responsibility {
  kind: ResponsibleKind;
  /** Как зона называется человеку. */
  title: string;
  /** Чем граница установлена: норма, а не решение продукта. */
  basis: string;
  /** То же словами жильца: ему нужна не статья, а кто чинит. */
  plain: string;
  /** Что делать дальше, если отвечает не управляющая организация. */
  next?: string;
}

export const RESPONSIBLE_TITLES: Readonly<Record<ResponsibleKind, string>> = {
  management: 'Управляющая организация',
  resource: 'Ресурсоснабжающая организация',
  contractor: 'Подрядчик по договору',
  municipal: 'Муниципальная служба',
  owner: 'Собственник помещения',
};

const COMMON_PROPERTY = 'Общее имущество дома: ч. 1 ст. 36 ЖК РФ, п. 2 Правил № 491';

const INSIDE_FLAT =
  'Внутриквартирное оборудование после первого отключающего устройства в общее имущество не входит: п. 5 и 6 Правил № 491';

const SPECIALIZED =
  'Обслуживание лифтов ведёт специализированная организация: п. 17 Правил № 491, ТР ТС 011/2011';

const OUTSIDE_LAND = 'За границей земельного участка дома общее имущество кончается: п. 4 Правил № 491';

/** Что известно о распространении проблемы: от этого зависит зона ответственности. */
export type Spreading = 'unknown' | 'shared' | 'local';

/** Категории, где внутри квартиры отвечает собственник, а на стояке, организация. */
const INSIDE_FLAT_CATEGORIES: readonly RequestCategory[] = ['plumbing', 'heating', 'electricity'];

/**
 * Зона ответственности по категории и адресу обращения. Возвращает только то,
 * что следует из правил: конкретную организацию подставляет прикладной слой.
 */
export const responsibilityFor = (
  category: RequestCategory,
  target: RequestTarget,
  spreading: Spreading = 'unknown',
  t: Translate = russian,
): Responsibility => {
  if (category === 'elevator') {
    return {
      kind: 'contractor',
      title: t(responsibleKey('contractor')),
      basis: SPECIALIZED,
      plain: t(zoneKey('elevator')),
      next: t(zoneNextKey('elevator')),
    };
  }

  if (target.kind === 'apartment' && INSIDE_FLAT_CATEGORIES.includes(category) && spreading === 'local') {
    return {
      kind: 'owner',
      title: t(responsibleKey('owner')),
      basis: INSIDE_FLAT,
      plain: t(zoneKey('insideFlat')),
      next: t(zoneNextKey('insideFlat')),
    };
  }

  if (category === 'yard') {
    return {
      kind: 'management',
      title: t(responsibleKey('management')),
      basis: COMMON_PROPERTY,
      plain: t(zoneKey('yard')),
      next: `${t(zoneNextKey('yard'))} ${OUTSIDE_LAND}`,
    };
  }

  return {
    kind: 'management',
    title: t(responsibleKey('management')),
    basis: COMMON_PROPERTY,
    plain: t(zoneKey('common')),
  };
};

/** Куда обращение передают, когда отвечает не управляющая организация. */
export type HandoffTarget = 'resource' | 'contractor' | 'municipal' | 'inspection';

export const HANDOFF_TITLES: Readonly<Record<HandoffTarget, string>> = {
  resource: 'Ресурсоснабжающая организация',
  contractor: 'Подрядчик',
  municipal: 'Муниципальная служба',
  inspection: 'Жилищная инспекция',
};

export const isHandoffTarget = (value: string): value is HandoffTarget => value in HANDOFF_TITLES;

/**
 * Срок ответа принимающей стороны в часах. Взят из нормы, а не назначен
 * продуктом: по нему же считается просрочка переданного обращения.
 */
export const HANDOFF_HOURS: Readonly<Record<HandoffTarget, number>> = {
  // Проверку качества коммунальной услуги согласовывают в течение двух часов.
  resource: 2,
  // Подрядчик работает в сроке самой заявки, отдельного норматива у него нет.
  contractor: 24,
  // Обращение в орган власти рассматривается 30 дней.
  municipal: 30 * 24,
  inspection: 30 * 24,
};

export const HANDOFF_BASIS: Readonly<Record<HandoffTarget, string>> = {
  resource: 'п. 108 Правил № 354: проверка качества услуги согласуется в течение двух часов',
  contractor: 'Срок работ по договору обслуживания, отдельного норматива ответа нет',
  municipal: 'ч. 1 ст. 12 59-ФЗ: обращение рассматривается в течение 30 дней',
  inspection: 'ч. 1 ст. 12 59-ФЗ: обращение рассматривается в течение 30 дней',
};

/** Состояние переданного обращения. */
export type HandoffStatus = 'sent' | 'accepted' | 'answered' | 'failed';

export const HANDOFF_STATUS_TITLES: Readonly<Record<HandoffStatus, string>> = {
  sent: 'передано',
  accepted: 'принято',
  answered: 'получен ответ',
  failed: 'не доставлено',
};

export interface Handoff {
  id: string;
  requestId: string;
  buildingId: string;
  to: HandoffTarget;
  /** Кому именно передано: название из карточки дома. */
  organization: string;
  /** Канал передачи. `manual` означает письмо или звонок вне продукта. */
  channel: string;
  /** Номер во внешней системе, если канал его вернул. */
  externalId?: string;
  status: HandoffStatus;
  /** Обращение отправил жилец, а не смена: это его жалоба, а не передача работы. */
  byResident?: boolean;
  /** До какого момента ждём ответ принимающей стороны. */
  dueAt: Date;
  answer?: string;
  createdAt: Date;
  answeredAt?: Date;
}

export const handoffDueAt = (to: HandoffTarget, at: Date): Date =>
  new Date(at.getTime() + HANDOFF_HOURS[to] * 60 * 60 * 1000);

/** Ответ не пришёл в срок: это видно и жильцу, и смене. */
export const isHandoffOverdue = (handoff: Handoff, now: Date): boolean =>
  handoff.status !== 'answered' && handoff.status !== 'failed' && now.getTime() > handoff.dueAt.getTime();
