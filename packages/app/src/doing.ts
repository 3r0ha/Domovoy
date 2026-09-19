import {
  allowedTransitions,
  CLOSED_STATUSES,
  describeTarget,
  findTransition,
  isCompanyStaff,
  STATUS_TITLES,
  type RequestStatus,
  type ServiceRequest,
} from '@domovoy/domain';

import { listAssignable, type StaffMember } from './report.js';
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
      /** Кому поручить наряд: человек назван словами или выбирается кнопкой. */
      kind: 'assign';
      request?: ServiceRequest;
      choices: ServiceRequest[];
      /** Исполнитель, если в словах назван он один. */
      staff?: StaffMember;
      candidates: StaffMember[];
    }
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

/** Дела словами: имя дела для модели и то, как оно называется человеку. */
const DEEDS: Readonly<Record<string, { to: RequestStatus; about: string }>> = {
  take: { to: 'in_progress', about: 'взять наряд в работу, выехал, приступил' },
  accept: { to: 'accepted', about: 'принять заявку в работу' },
  done: { to: 'done', about: 'сдать работу, починил, заменил, сделал' },
  confirm: { to: 'confirmed', about: 'принять работу, всё сделали, претензий нет' },
  reopen: { to: 'in_progress', about: 'вернуть работу, не сделали, опять то же самое' },
  ask: { to: 'needs_info', about: 'спросить уточнение у жильца' },
  reject: { to: 'rejected', about: 'отклонить заявку' },
  withdraw: { to: 'withdrawn', about: 'снять своё обращение, уже не нужно' },
};

/** Слова о поручении наряда: у них своё дело, потому что нужен ещё и человек. */
const ASSIGNING = /назнач|поручи|отдай|пусть (сделает|идёт|едет)|отправь(те)? (мастера|на адрес)/iu;

/**
 * Кого назвали по имени. Имя сверяется началом слова: «назначь Сергея» и
 * «Сергею» это один и тот же Сергей, а падежи продукт не разбирает.
 */
const STEM = 5;

const named = (text: string, people: readonly StaffMember[]): StaffMember[] => {
  const words = (text.toLowerCase().match(/\p{L}{3,}/gu) ?? []).map((word) => word.slice(0, STEM));

  return people.filter((person) =>
    person.displayName
      .toLowerCase()
      .split(/\s+/u)
      .some((part) => part.length >= 3 && words.includes(part.slice(0, STEM))),
  );
};

/**
 * Поручение наряда словами: «назначь Сергея на 0007». Заявка и человек берутся
 * из того, что доступно этой смене: не названное остаётся выбором кнопкой.
 */
const assigning = async (
  deps: AppDeps,
  resident: Resident,
  text: string,
  open: readonly ServiceRequest[],
): Promise<Doing | undefined> => {
  if (!ASSIGNING.test(text)) return undefined;

  const candidates = await listAssignable(deps, resident).catch(() => []);

  if (candidates.length === 0) {
    return { kind: 'denied', reason: 'Поручить наряд может управляющая организация, и в доме нужны мастера.' };
  }

  const choices = open.filter((request) => !CLOSED_STATUSES.includes(request.status));

  if (choices.length === 0) return { kind: 'denied', reason: 'Открытых заявок, которые можно поручить, сейчас нет.' };

  const numbered = numberIn(text, choices);
  const person = named(text, candidates);

  return {
    kind: 'assign',
    ...(numbered ? { request: numbered } : choices.length === 1 ? { request: choices[0]! } : {}),
    choices: numbered ? [numbered] : choices,
    ...(person.length === 1 ? { staff: person[0]! } : {}),
    candidates,
  };
};

/** Сколько заявок уходит модели: дальше список только путает выбор. */
const LISTED = 10;

/**
 * Похоже ли сказанное на дело: законченное действие, номер заявки или слова о
 * наряде. Рассказ о поломке сюда не попадает, и лишнего запроса к модели не
 * будет: ответ человек ждёт и без него.
 */
const MAYBE_DEED =
  /(?<!\p{L})\p{L}{2,}(?:ал|ял|ил|ел|ла|ли|ло|но|ты|та)(?!\p{L})|заявк|наряд|номер|работ[уы]|\d{4}/iu;

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
  const open = await around(deps, resident);

  // Поручение наряда идёт отдельно от перехода состояния: кроме заявки нужен
  // ещё и человек, которому её отдают.
  if (isCompanyStaff(resident.role)) {
    const assign = await assigning(deps, resident, said, open);

    if (assign) return assign;
  }

  // Модель называет дело и заявку, но выбирает только из того, что человеку и
  // так доступно: прав она не добавляет, а ошибку в имени дела продукт молча
  // отбрасывает. Слова остаются страховкой и работают без сети.
  const read = await asked(deps, resident, said, open);

  if (!read && matched.length === 0) return undefined;

  // Номер заявки снимает выбор: и названный словами, и узнанный моделью.
  const numbered = numberIn(said, open) ?? open.find((request) => request.number === read?.number);
  const about = numbered ? [numbered] : open;

  // Одни и те же слова у разных ролей значат разное: «всё сделали» у мастера
  // это сдача работы, а у жильца её приёмка. Решает не слово, а то, что этот
  // человек вправе сделать с этой заявкой.
  for (const phrase of [...(read ? [read] : []), ...matched]) {
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

  if (matched.length === 0) return undefined;

  return { kind: 'denied', reason: matched[0]!.denied };
};

/**
 * Что о деле думает модель. Ответ принимается, только если и дело, и заявка
 * названы из переданных списков: выдуманное имя дела правом не становится.
 */
const asked = async (
  deps: AppDeps,
  resident: Resident,
  text: string,
  open: readonly ServiceRequest[],
): Promise<(Phrase & { number?: string }) | undefined> => {
  if (!deps.reasoner?.doing || open.length === 0 || !MAYBE_DEED.test(text)) return undefined;

  const deeds = Object.entries(DEEDS)
    .filter(([, deed]) => open.some((request) => able(request, deed.to, resident)))
    .map(([name, deed]) => ({ deed: name, about: deed.about }));

  if (deeds.length === 0) return undefined;

  const read = await deps.reasoner
    .doing({
      text,
      deeds,
      requests: open.slice(0, LISTED).map((request) => ({
        number: request.number,
        title: request.title,
        where: describeTarget(request.target),
        status: STATUS_TITLES[request.status],
      })),
    })
    .catch(() => undefined);

  const deed = read?.deed ? DEEDS[read.deed] : undefined;

  if (!deed || !deeds.some((item) => item.deed === read?.deed)) return undefined;

  // Номер принимается только из переданного списка: чужую заявку модель назвать
  // не сможет, а выдуманный номер продукт пропустит мимо.
  const number = open.find((request) => request.number === read?.number)?.number;

  return {
    to: deed.to,
    words: /(?:)/u,
    denied: 'Такое дело сейчас недоступно.',
    ...(number ? { number } : {}),
  };
};
