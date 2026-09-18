import { MESSAGE_MAX_LENGTH } from './status.js';
import { DomainError, type AnnouncementAudience, type NoticeKind } from './types.js';

/** Кому управляющая компания пишет в личную переписку. */
export type BroadcastScope =
  | { kind: 'building' }
  | { kind: 'entrance'; entrance: number }
  | { kind: 'riser'; entrance: number; riser: number }
  | { kind: 'apartments'; numbers: number[] }
  | { kind: 'debtors' }
  | { kind: 'meters' }
  | { kind: 'poll'; pollId: string }
  | { kind: 'staff' };

export type BroadcastKind = BroadcastScope['kind'];

export const BROADCAST_KINDS: readonly BroadcastKind[] = [
  'building',
  'entrance',
  'riser',
  'apartments',
  'debtors',
  'meters',
  'poll',
  'staff',
];

/** Сколько квартир можно перечислить номерами. */
export const BROADCAST_FLATS_LIMIT = 50;

/** Сколько знаков помещается в одну рассылку. */
export const BROADCAST_MAX_LENGTH = MESSAGE_MAX_LENGTH;

/** Адресат словами: его показывают перед отправкой и пишут в журнал. */
export const describeScope = (scope: BroadcastScope, pollTitle?: string): string => {
  switch (scope.kind) {
    case 'building':
      return 'весь дом';
    case 'entrance':
      return `подъезд ${scope.entrance}`;
    case 'riser':
      return `подъезд ${scope.entrance}, стояк ${scope.riser}`;
    case 'apartments':
      return `квартиры ${[...scope.numbers].sort((left, right) => left - right).join(', ')}`;
    case 'debtors':
      return 'должники дома';
    case 'meters':
      return 'не подали показания';
    case 'poll':
      return pollTitle ? `не проголосовали: ${pollTitle}` : 'не проголосовали';
    case 'staff':
      return 'смена дома';
  }
};

/** Адресат по адресу превращается в тот же отбор, что и у объявления. */
export const scopeAudience = (scope: BroadcastScope, buildingId: string): AnnouncementAudience | null => {
  switch (scope.kind) {
    case 'building':
      return { kind: 'building', buildingId };
    case 'entrance':
      return { kind: 'entrance', buildingId, entrance: scope.entrance };
    case 'riser':
      return { kind: 'riser', buildingId, entrance: scope.entrance, riser: scope.riser };
    default:
      return null;
  }
};

/**
 * Какое уведомление отключает рассылку. Адресное сообщение отключить нельзя:
 * долг и перечисленные квартиры касаются лично получателя.
 */
export const noticeForScope = (scope: BroadcastScope): NoticeKind | undefined => {
  switch (scope.kind) {
    case 'meters':
      return 'meters';
    case 'poll':
      return 'polls';
    case 'building':
    case 'entrance':
    case 'riser':
      return 'news';
    default:
      return undefined;
  }
};

/** Текст рассылки. @throws {DomainError} */
export const broadcastText = (text: string): string => {
  const trimmed = text.trim();

  if (trimmed.length === 0) throw new DomainError('message_empty', 'Текст рассылки пустой');

  if (trimmed.length > BROADCAST_MAX_LENGTH) {
    throw new DomainError('message_too_long', `Текст длиннее ${BROADCAST_MAX_LENGTH} знаков`);
  }

  return trimmed;
};
