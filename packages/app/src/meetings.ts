import type { Poll } from '@domovoy/domain';

import type { Building } from './repository.js';

/**
 * Система, в которой собрание собственников имеет силу: ГИС ЖКХ или мобильное
 * приложение «Госуслуги.Дом». Продукт готовит собрание и собирает решения,
 * а юридическую силу заочному голосованию даёт система, поэтому обмен с ней
 * вынесен за порт. В MVP подключение модельное: оно подтверждает приём
 * и выдаёт номера, настоящей передачи за ним нет.
 */
export interface MeetingRegistry {
  /** Как система называется человеку. */
  readonly title: string;
  /** Обмен модельный: это видно рядом с номером. */
  readonly model: boolean;
  /** Сообщение о проведении собрания. Возвращает номер размещения. */
  publishNotice(notice: MeetingNotice): Promise<{ noticeId: string }>;
  /** Решение собственника по вопросу повестки. */
  submitDecision(decision: MeetingDecision): Promise<{ decisionId: string }>;
  /** Протокол собрания и направление подлинников в надзор. */
  publishProtocol(protocol: MeetingProtocol): Promise<{ protocolId: string }>;
}

export interface MeetingNotice {
  poll: Poll;
  building?: Building;
  /** Кто ведёт собрание: администратор общего собрания. */
  administrator: string;
  votingFrom: Date;
  votingTo: Date;
}

export interface MeetingDecision {
  poll: Poll;
  apartmentId: string;
  /** Как проголосовало помещение. */
  choice: 'for' | 'against' | 'abstain';
  at: Date;
}

export interface MeetingProtocol {
  poll: Poll;
  building?: Building;
  /** Текст протокола: тот же, что видит человек. */
  text: string;
  /** До какого дня подлинники должны уйти в орган надзора. */
  toInspectionBy: Date;
}

export interface MockMeetingsOptions {
  title?: string;
  createId?: () => string;
}

/** Модельная система собраний: номера выдаёт, наружу ничего не передаёт. */
export const createMockMeetings = (
  options: MockMeetingsOptions = {},
): MeetingRegistry & { notices: MeetingNotice[]; decisions: MeetingDecision[]; protocols: MeetingProtocol[] } => {
  const notices: MeetingNotice[] = [];
  const decisions: MeetingDecision[] = [];
  const protocols: MeetingProtocol[] = [];
  let counter = 0;

  const number = (): string => (options.createId ? options.createId() : `${++counter}`.padStart(4, '0'));

  return {
    title: options.title ?? 'ГИС ЖКХ',
    model: true,
    notices,
    decisions,
    protocols,
    async publishNotice(notice) {
      notices.push(notice);

      return { noticeId: `ОСС-${number()}` };
    },
    async submitDecision(decision) {
      decisions.push(decision);

      return { decisionId: `РЕШ-${number()}` };
    },
    async publishProtocol(protocol) {
      protocols.push(protocol);

      return { protocolId: `ПР-${number()}` };
    },
  };
};
