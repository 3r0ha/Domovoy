import {
  allowedTransitions,
  findTransition,
  isCompanyStaff,
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
export type Doing =
  | {
      kind: 'transition';
      /** Заявка, если она одна. Пусто означает, что выбрать должен человек. */
      request?: ServiceRequest;
      /** Из чего выбирать, когда подходящих заявок несколько. */
      choices: ServiceRequest[];
      /** Из какого состояния идёт переход: от него зависят слова на кнопке. */
      from: RequestStatus;
      to: RequestStatus;
      /** Что пойдёт в отчёт или причину: слова самого человека. */
      comment: string;
      /** Переход без объяснения не принимается. */
      requiresComment: boolean;
    }
  | {
      /** Слова о деле есть, а делать его этому человеку нечем или не по правам. */
      kind: 'denied';
      reason: string;
    };

/** Слова, которыми называют дело. Роль решает, какие из них вообще доступны. */
interface Phrase {
  to: RequestStatus;
  words: RegExp;
  /** Чем объяснить отказ, если слова понятны, а дела нет. */
  denied: string;
}

/**
 * Что человек говорит о заявке. Порядок важен: сначала более точные слова,
 * иначе «не сделали» совпадёт с «сделали».
 */
const PHRASES: readonly Phrase[] = [
  {
    to: 'in_progress',
    words: /не сделал|не починил|не устранил|переделать|верните в работу|не приняли работ|опять теч|то же самое/i,
    denied: 'Вернуть заявку в работу можно, пока она не закрыта.',
  },
  {
    to: 'rejected',
    words: /отклон|не наша зона|не по адресу|не подтвердил/i,
    denied: 'Отклоняет заявки управляющая организация.',
  },
  {
    to: 'withdrawn',
    words: /отзыв|отозв|снимаю заявк|снять заявк|уже не нужно|больше не нужно|само прошло|решилось сам/i,
    denied: 'Снять обращение может только тот, кто его подал, и пока оно не закрыто.',
  },
  {
    to: 'needs_info',
    words: /уточн|нужны подробност|спросить у жильц|не понял, что/i,
    denied: 'Спрашивать уточнение у жильца может управляющая организация.',
  },
  {
    to: 'done',
    words: /почин|устранил|заменил|сделал|готово|выполнил|закрыл наряд|работу сдал|прочистил|отремонтировал/i,
    denied: 'Сдать работу может исполнитель наряда, который взят в работу.',
  },
  {
    to: 'confirmed',
    words: /вс[её] сдела|работу принял|принимаю работ|претензий нет|спасибо, вс[её]/i,
    denied: 'Принять работу можно, когда мастер её сдал.',
  },
  {
    to: 'accepted',
    words: /принял заявк|беру заявк|в работу беру|взял в работу/i,
    denied: 'Принимает заявки в работу управляющая организация.',
  },
  {
    to: 'in_progress',
    words: /выехал|еду на|приступил|начал работ|взял наряд|я на месте|я на адресе/i,
    denied: 'Взять наряд в работу может его исполнитель.',
  },
];

/** Человек спрашивает, а не делает: с вопросом это разговор, а не дело. */
const ASKING = /\?|^\s*(когда|почему|зачем|сколько|как|где|кто|что с|можно ли|подскажите|скажите)\b/iu;

/** Номер заявки внутри фразы: целиком или хвостом из четырёх цифр. */
const numberIn = (text: string, open: readonly ServiceRequest[]): ServiceRequest | undefined => {
  const full = /([A-Za-zА-Яа-я0-9]+-\d{4}-\d{4})/u.exec(text)?.[1];

  if (full) return open.find((request) => request.number === full);

  const tail = /(?<![\d-])(\d{4})(?![\d-])/u.exec(text)?.[1];

  return tail ? open.find((request) => request.number.endsWith(`-${tail}`)) : undefined;
};

/**
 * Заявки, с которыми человек может что-то сделать. Жилец и подрядчик работают
 * со своими, смена ещё и с очередью дома: «принял 0007» диспетчер говорит про
 * заявку, которую сам не подавал.
 */
const around = async (deps: AppDeps, resident: Resident): Promise<ServiceRequest[]> => {
  const own = await listRequestsFor(deps, resident, 'mine');

  if (!isCompanyStaff(resident.role)) return own;

  const queue = await listRequestsFor(deps, resident, 'queue').catch(() => []);
  const seen = new Set(own.map((request) => request.id));

  return [...own, ...queue.filter((request) => !seen.has(request.id))];
};

/** Снять обращение вправе только тот, кто его подал: правила переходов этого не знают. */
const able = (request: ServiceRequest, to: RequestStatus, resident: Resident): boolean => {
  if (!allowedTransitions(request.status, resident.role).includes(to)) return false;

  return to !== 'withdrawn' || request.authorId === resident.id;
};

/**
 * Дело по словам человека. Возвращает пусто, если слов о деле нет: тогда
 * сказанное разбирается как обычно. Если слова о деле есть, а сделать его
 * нечем, возвращается отказ с объяснением: молча заводить по такой фразе
 * новую заявку хуже, чем сказать, почему не вышло.
 */
export const doingFor = async (deps: AppDeps, resident: Resident, text: string): Promise<Doing | undefined> => {
  const said = text.trim();

  if (ASKING.test(said)) return undefined;

  const matched = PHRASES.filter((item) => item.words.test(said));

  if (matched.length === 0) return undefined;

  const open = await around(deps, resident);

  // Номер заявки в тексте снимает выбор: «по 0007 всё сделано» это про неё.
  const numbered = numberIn(said, open);
  const about = numbered ? [numbered] : open;

  // Одни и те же слова у разных ролей значат разное: «всё сделали» у мастера
  // это сдача работы, а у жильца её приёмка. Решает не слово, а то, что этот
  // человек вправе сделать с этой заявкой.
  for (const phrase of matched) {
    const choices = about.filter((request) => able(request, phrase.to, resident));

    if (choices.length === 0) continue;

    const requiresComment =
      choices.length === 1
        ? (findTransition(choices[0]!.status, phrase.to, resident.role)?.requiresComment ?? false)
        : true;

    return {
      kind: 'transition',
      ...(choices.length === 1 ? { request: choices[0]! } : {}),
      choices,
      from: choices[0]!.status,
      to: phrase.to,
      comment: said,
      requiresComment,
    };
  }

  return { kind: 'denied', reason: matched[0]!.denied };
};
