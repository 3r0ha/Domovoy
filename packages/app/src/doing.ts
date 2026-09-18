import {
  allowedTransitions,
  findTransition,
  requestNumberIn,
  type RequestStatus,
  type ServiceRequest,
} from '@domovoy/domain';

import { listRequestsFor } from './use-cases/requests.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/**
 * Дело, которое человек назвал словами. Продукт его не выполняет молча: сначала
 * показывает, что понял, и ждёт подтверждения. Слова человека остаются отчётом
 * или причиной перехода, чтобы не заставлять писать то же самое второй раз.
 */
export interface Doing {
  kind: 'transition';
  /** Заявка, если она одна. Пусто означает, что выбрать должен человек. */
  request?: ServiceRequest;
  /** Из чего выбирать, когда подходящих заявок несколько. */
  choices: ServiceRequest[];
  to: RequestStatus;
  /** Что пойдёт в отчёт или причину: слова самого человека. */
  comment: string;
  /** Переход без объяснения не принимается. */
  requiresComment: boolean;
}

/** Слова, которыми называют дело. Роль решает, какие из них вообще доступны. */
interface Phrase {
  to: RequestStatus;
  words: RegExp;
}

/**
 * Что человек говорит о заявке. Порядок важен: сначала более точные слова,
 * иначе «не сделали» совпадёт с «сделали».
 */
const PHRASES: readonly Phrase[] = [
  { to: 'in_progress', words: /не сделал|не починил|не устранил|переделать|верните в работу|не приняли работ/i },
  { to: 'rejected', words: /отклон|не наша зона|не по адресу|не подтвердил/i },
  { to: 'withdrawn', words: /отзыв|отозв|снимаю заявк|уже не нужно|больше не нужно|само прошло|решилось сам/i },
  { to: 'needs_info', words: /уточн|нужны подробност|спросить у жильц|не понял, что/i },
  {
    to: 'done',
    words: /почин|устранил|заменил|сделал|готово|выполнил|закрыл наряд|работу сдал|прочистил|отремонтировал/i,
  },
  { to: 'confirmed', words: /вс[её] сдела|работу принял|принимаю работ|спасибо, вс[её] хорошо|претензий нет/i },
  { to: 'accepted', words: /принял заявк|беру заявк|в работу беру|взял в работу/i },
  { to: 'in_progress', words: /выехал|еду на|приступил|начал работ|взял наряд/i },
];

/** Заявки, к которым человек может что-то сделать: свои и порученные ему. */
const mine = async (deps: AppDeps, resident: Resident): Promise<ServiceRequest[]> => {
  const listed = await listRequestsFor(deps, resident, 'mine');
  const found: ServiceRequest[] = [];

  for (const item of listed) {
    const request = await deps.repository.findRequest(item.id);

    if (request) found.push(request);
  }

  return found;
};

/**
 * Дело по словам человека. Возвращает пусто, если слов о деле нет или роль
 * такого перехода не делает: тогда сказанное разбирается как обычно.
 */
export const doingFor = async (deps: AppDeps, resident: Resident, text: string): Promise<Doing | undefined> => {
  const said = text.trim();
  const matched = PHRASES.filter((item) => item.words.test(said));

  if (matched.length === 0) return undefined;

  const open = await mine(deps, resident);

  // Номер заявки в тексте снимает выбор: «по 0007 всё сделано» это про неё.
  const numbered = open.find((request) => requestNumberIn(said) === request.number);
  const about = numbered ? [numbered] : open;

  // Одни и те же слова у разных ролей значат разное: «всё сделали» у мастера
  // это сдача работы, а у жильца её приёмка. Решает не слово, а то, что этот
  // человек вправе сделать с этой заявкой.
  for (const phrase of matched) {
    const choices = about.filter((request) =>
      allowedTransitions(request.status, resident.role).includes(phrase.to),
    );

    if (choices.length === 0) continue;

    const requiresComment =
      choices.length === 1
        ? (findTransition(choices[0]!.status, phrase.to, resident.role)?.requiresComment ?? false)
        : true;

    return {
      kind: 'transition',
      ...(choices.length === 1 ? { request: choices[0]! } : {}),
      choices,
      to: phrase.to,
      comment: said,
      requiresComment,
    };
  }

  return undefined;
};
