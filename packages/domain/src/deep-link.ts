import { DomainError, type RequestTarget } from './types.js';

/** Кодирование объекта в параметр запуска мини-приложения. */
export const START_PARAM_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/** Приставка ссылки на раздел приложения: `go-queue` открывает его сразу. */
export const SECTION_PREFIX = 'go-';

/** Параметр запуска, открывающий раздел приложения. */
export const sectionParam = (screen: string): string => `${SECTION_PREFIX}${screen}`;

export const isValidStartParam = (payload: string): boolean => START_PARAM_PATTERN.test(payload);

const assertPart = (value: string, field: string): string => {
  if (value.includes('_')) {
    throw new DomainError('invalid_identifier', `Идентификатор «${field}» не может содержать подчёркивание`);
  }
  return value;
};

export const encodeTarget = (target: RequestTarget): string => {
  switch (target.kind) {
    case 'apartment':
      return `apt_${assertPart(target.apartmentId, 'apartmentId')}`;
    case 'entrance':
      return `ent_${assertPart(target.buildingId, 'buildingId')}_${target.entrance}`;
    case 'riser':
      return `rsr_${assertPart(target.buildingId, 'buildingId')}_${target.entrance}_${target.riser}`;
    case 'equipment':
      return `eqp_${assertPart(target.buildingId, 'buildingId')}_${assertPart(target.equipmentId, 'equipmentId')}`;
    case 'building':
      return `bld_${assertPart(target.buildingId, 'buildingId')}`;
  }
};

const toNumber = (value: string | undefined): number | null => {
  if (value === undefined || value.length === 0) return null;

  const parsed = Number(value);

  // Ноль кодируется наравне с остальными номерами, значит, и разбираться
  // должен: иначе наклейка с нулевым подъездом не открывает ничего.
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

/** Разбирает параметр запуска обратно в объект. */
export const decodeTarget = (payload: string): RequestTarget | null => {
  if (!isValidStartParam(payload)) return null;

  const [kind, ...parts] = payload.split('_');

  switch (kind) {
    case 'apt': {
      const [apartmentId] = parts;
      return apartmentId ? { kind: 'apartment', apartmentId } : null;
    }
    case 'ent': {
      const [buildingId, entrance] = parts;
      const parsed = toNumber(entrance);
      return buildingId && parsed !== null ? { kind: 'entrance', buildingId, entrance: parsed } : null;
    }
    case 'rsr': {
      const [buildingId, entrance, riser] = parts;
      const parsedEntrance = toNumber(entrance);
      const parsedRiser = toNumber(riser);

      return buildingId && parsedEntrance !== null && parsedRiser !== null
        ? { kind: 'riser', buildingId, entrance: parsedEntrance, riser: parsedRiser }
        : null;
    }
    case 'eqp': {
      const [buildingId, equipmentId] = parts;
      return buildingId && equipmentId ? { kind: 'equipment', buildingId, equipmentId } : null;
    }
    case 'bld': {
      const [buildingId] = parts;
      return buildingId ? { kind: 'building', buildingId } : null;
    }
    default:
      return null;
  }
};

/** Один ли это объект: сравнение по полям. */
export const isSameTarget = (left: RequestTarget, right: RequestTarget): boolean => {
  if (left.kind !== right.kind) return false;

  // Дом сверяется везде: подъезд 1 одного дома и подъезд 1 другого, это разные
  // места, а от совпадения зависит, засчитан ли выезд мастера.
  switch (left.kind) {
    case 'apartment':
      return right.kind === 'apartment' && left.apartmentId === right.apartmentId;
    case 'equipment':
      return (
        right.kind === 'equipment' &&
        left.buildingId === right.buildingId &&
        left.equipmentId === right.equipmentId
      );
    case 'riser':
      return (
        right.kind === 'riser' &&
        left.buildingId === right.buildingId &&
        left.entrance === right.entrance &&
        left.riser === right.riser
      );
    case 'entrance':
      return right.kind === 'entrance' && left.buildingId === right.buildingId && left.entrance === right.entrance;
    case 'building':
      return right.kind === 'building' && left.buildingId === right.buildingId;
  }
};

/** Скан наклейки того же объекта доказывает, что мастер был на месте. */
export const provesPresence = (target: RequestTarget, scanned: string): boolean => {
  const decoded = decodeTarget(scanned);

  return decoded ? isSameTarget(target, decoded) : false;
};

const assertPayload = (target: RequestTarget): string => {
  const payload = encodeTarget(target);

  if (!isValidStartParam(payload)) {
    throw new DomainError('payload_too_long', 'Параметр запуска не укладывается в ограничения платформы');
  }

  return payload;
};

/** Ссылка на мини-приложение: открывает приложение сразу на нужном объекте. */
export const buildDeepLink = (botName: string, target: RequestTarget): string =>
  `https://max.ru/${botName}?startapp=${assertPayload(target)}`;

/** Ссылка на бота по готовому параметру запуска. */
export const botLinkTo = (botName: string, payload: string): string => {
  if (!isValidStartParam(payload)) {
    throw new DomainError('payload_too_long', 'Параметр запуска не укладывается в ограничения платформы');
  }

  return `https://max.ru/${botName}?start=${payload}`;
};

/** Ссылка на бота: открывает переписку, в которой объект уже известен. */
export const buildBotDeepLink = (botName: string, target: RequestTarget): string =>
  botLinkTo(botName, assertPayload(target));
