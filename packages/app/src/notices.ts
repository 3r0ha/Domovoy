import { DomainError, NOTICE_KINDS, noticeKindKey, type NoticeKind } from '@domovoy/domain';

import { speak } from './language.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Отключено ли это уведомление у человека. */
export const isMuted = (resident: Resident | undefined, kind: NoticeKind): boolean =>
  resident?.mutes?.includes(kind) ?? false;

/** Кому из списка это уведомление ещё нужно. */
export const wanting = <T extends Resident>(people: readonly T[], kind: NoticeKind): T[] =>
  people.filter((person) => !isMuted(person, kind));

export interface NoticeView {
  kind: NoticeKind;
  title: string;
  /** Уведомление включено. */
  on: boolean;
}

export const listNotices = (resident: Resident): NoticeView[] => {
  const t = speak(resident);

  return NOTICE_KINDS.map((kind) => ({ kind, title: t(noticeKindKey(kind)), on: !isMuted(resident, kind) }));
};

/** Включает или выключает уведомление. @throws {DomainError} */
export const setNotice = async (
  deps: AppDeps,
  resident: Resident,
  kind: NoticeKind,
  on: boolean,
): Promise<NoticeView[]> => {
  if (!NOTICE_KINDS.includes(kind)) throw new DomainError('notice_unknown', 'Такого уведомления нет');

  const mutes = new Set(resident.mutes ?? []);

  if (on) mutes.delete(kind);
  else mutes.add(kind);

  const saved = await deps.repository.saveResident({ ...resident, mutes: [...mutes] });

  return listNotices(saved);
};
