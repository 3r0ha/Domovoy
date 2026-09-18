import {
  describeWork,
  encodeTarget,
  DomainError,
  explainingWork,
  findJoinable,
  formatMoment,
  isFinal,
  isSharedInfrastructure,
  joinRequest,
  OPEN_STATUSES,
  promoteToShared,
  reportersCount,
  suggestCategory,
  type AnnouncementAudience,
  type LocatedRequest,
  type PlannedWork,
  type RequestCategory,
  type ServiceRequest,
} from '@domovoy/domain';

import { apartmentsOf, locateTarget } from '../apartments.js';
import { answerAboutHouse } from '../answers.js';
import { askAssistant, capabilitiesFor, findCapability, type Capability } from '../assistant.js';
import { actionsFor, noopNotifier, notifyResident } from '../notifier.js';
import { understandRequest, type HouseContext, type Place } from '../reasoner.js';
import { plannedWork, type Resident } from '../repository.js';
import { assertSaid } from '../said.js';
import { createServiceRequest, targetOf, type AppDeps, type CreateRequestCommand } from '../use-cases.js';
import { zoneOf } from '../zone.js';
import { confirmIncident, notifyStaff } from './notify.js';

/** Три исхода обращения: новая заявка, присоединение к открытой, ответ про работы. */
export type SubmitResult =
  | {
      kind: 'created' | 'joined';
      request: ServiceRequest;
      /** Сколько жильцов сообщили об этой проблеме, включая автора. */
      reporters: number;
      /** Чего не хватило в обращении: один вопрос. Заявка уже заведена и без ответа. */
      question?: string;
      /** Чем определена категория: разбором текста моделью или ключевыми словами. */
      categoryBy?: 'model' | 'keywords';
    }
  | { kind: 'planned'; work: PlannedWork; explanation: string }
  | { kind: 'answered'; answer: string };

/** Обращение, которое стало заявкой: плановые работы её не заводят. */
export type SubmittedRequest = Extract<SubmitResult, { kind: 'created' | 'joined' }>;

/**
 * Результат обращения, когда заявка обязана была появиться. Нужен там, где
 * вызывающий уже знает, что плановых работ по этому адресу нет. @throws {DomainError}
 */
export const asRequest = (result: SubmitResult): SubmittedRequest => {
  if (result.kind === 'planned') {
    throw new DomainError('request_not_found', 'Обращение объяснилось плановыми работами, заявки нет');
  }

  if (result.kind === 'answered') {
    throw new DomainError('request_not_found', 'Обращение оказалось вопросом, заявки нет');
  }

  return result;
};

/** Что модель знает о доме, когда разбирает обращение: адрес, подъезды и оборудование. */
const houseFor = async (deps: AppDeps, command: CreateRequestCommand, buildingId: string): Promise<HouseContext> => {
  const building = await deps.repository.findBuilding(buildingId);
  const equipment = await deps.repository.listEquipment(buildingId);
  const apartments = await deps.repository.listApartments(buildingId);
  const own = command.resident.apartmentId
    ? apartments.find((apartment) => apartment.id === command.resident.apartmentId)
    : undefined;

  return {
    ...(building?.address ? { address: building.address } : {}),
    equipment: equipment.map((item) => ({ code: item.code, title: item.title })),
    entrances: [...new Set(apartments.map((apartment) => apartment.entrance))].sort((left, right) => left - right),
    ...(own ? { apartment: own.number } : {}),
  };
};

/**
 * Адрес обращения по тому, о какой части дома написал человек. Считается только
 * там, где адрес не назван ни кодом с наклейки, ни выбором квартиры: иначе
 * заявка о подъезде досталась бы квартире автора.
 */
const placeParam = async (
  deps: AppDeps,
  command: CreateRequestCommand,
  place: Place | undefined,
  buildingId: string,
): Promise<string | undefined> => {
  if (command.startParam || command.apartmentId || command.house) return undefined;
  if (place !== 'entrance' && place !== 'house') return undefined;

  if (place === 'house') return encodeTarget({ kind: 'building', buildingId });

  const apartment = command.resident.apartmentId
    ? await deps.repository.findApartment(command.resident.apartmentId)
    : undefined;

  return apartment
    ? encodeTarget({ kind: 'entrance', buildingId: apartment.buildingId, entrance: apartment.entrance })
    : encodeTarget({ kind: 'building', buildingId });
};

/**
 * Вопрос о доме заявки не заводит: продукт отвечает данными дома, а заявку
 * человек заведёт кнопкой, если ответ его не устроил. Рассказ о неисправности
 * в ответ не превращается, даже если разбор счёл его вопросом: пропущенная
 * поломка дороже лишней заявки.
 */
const answerInstead = async (deps: AppDeps, command: CreateRequestCommand): Promise<SubmitResult | undefined> => {
  if (command.anyway || aboutTrouble(command.description)) return undefined;

  const answer = await answerAboutHouse(deps, command.resident, command.description).catch(() => undefined);

  if (answer?.text) return { kind: 'answered', answer: answer.text };

  const elsewhere = await otherSection(deps, command).catch(() => undefined);

  return elsewhere ? { kind: 'answered', answer: elsewhere } : undefined;
};

/**
 * Написанное про другой раздел продукта: «оператор», «показания», «собрание».
 * Решает это разбор текста: модели отдаются разделы роли, и она говорит, поломка
 * это или другое место продукта. Без модели остаётся подбор по словам, поэтому
 * продукт ведёт себя так же, только грубее.
 */
const otherSection = async (deps: AppDeps, command: CreateRequestCommand): Promise<string | undefined> => {
  const elsewhere = await sectionFor(deps, command.resident, command.description);

  if (!elsewhere) return undefined;

  const help = await askAssistant(deps, command.resident, command.description);

  return help.answer;
};

/**
 * Раздел, о котором написал человек, если это не поломка. «Открыть дверь» и
 * «оплатить счёт» это не обращение в управляющую компанию, а просьба сделать
 * дело: продукт открывает нужный раздел, а не заводит по ним заявку.
 * @returns раздел или `undefined`, если написанное про поломку.
 */
export const sectionFor = async (
  deps: AppDeps,
  resident: Resident,
  text: string,
): Promise<Capability | undefined> => {
  const role = resident.role;
  const own = capabilitiesFor(role);
  const sections = own.map((item) => ({ screen: item.screen, title: item.title, about: item.about }));

  const read = await deps.reasoner?.route?.({ text, sections }).catch(() => undefined);

  if (read?.kind === 'breakdown') return undefined;

  if (read?.kind === 'elsewhere') {
    // Раздела, которого у роли нет, модель не выбирает: ответ был бы в пустоту.
    return own.find((item) => item.screen === read.screen && item.screen !== 'new');
  }

  // Модель промолчала: подбор по словам осторожнее её. Заявкой не становится
  // только короткое обращение, где нет ни слова о неисправности, а название
  // другого раздела есть.
  if (suggestCategory(text) !== 'other') return undefined;
  if (text.trim().length > SHORT_ENOUGH) return undefined;
  if (TROUBLE.test(text)) return undefined;

  const asked = findCapability(text, role);

  return asked && asked.screen !== 'new' ? asked : undefined;
};

/** Человек спрашивает, а не рассказывает: вопросительный знак или вопросительное слово. */
const ASKING = /\?|^\s*(когда|почему|отчего|зачем|сколько|как(ой|ая|ое|ие)?|где|кто|что с|будет ли|есть ли|можно ли|подскажите|скажите)\b/i;

/** Рассказ о неисправности: слова о ней есть, а вопроса нет. */
const aboutTrouble = (text: string): boolean => TROUBLE.test(text) && !ASKING.test(text.trim());

/** Слова о неисправности: с ними обращение остаётся заявкой. */
const TROUBLE =
  /(^|[\s,.!?])(не|нет|сломал|слома|теч|подтека|капает|пахнет|дым|искр|застр|разбит|упал|прорв|шум|вон|грязь|мусор|засор|холодн|темно)/i;

/** Докуда обращение считается короткой репликой, а не рассказом о поломке. */
const SHORT_ENOUGH = 40;

/** Обращение жильца: новая заявка либо подтверждение уже открытой. */
export const submitProblem = async (deps: AppDeps, command: CreateRequestCommand): Promise<SubmitResult> => {
  const buildingId = command.resident.buildingId ?? deps.defaultBuildingId;

  await assertSaid(deps, command.description, {
    asked: 'что случилось в доме или в квартире',
    hint: 'Напишите словами, что случилось. Одного знака или цифры мало.',
    ...(command.attachments?.length ? { attachments: command.attachments } : {}),
  });

  const answered = await answerInstead(deps, command);

  if (answered) return answered;

  // Дом уходит в разбор вместе с текстом: по нему модель относит обращение
  // к настоящему лифту или домофону, а не к дому целиком.
  const house = deps.reasoner ? await houseFor(deps, command, buildingId).catch(() => undefined) : undefined;
  const read = await understandRequest(command.description, deps.reasoner, house);

  // Объект из ответа модели становится адресом обращения, если человек не указал свой.
  const named =
    !command.startParam && read.equipment
      ? encodeTarget({ kind: 'equipment', buildingId, equipmentId: read.equipment })
      : undefined;

  // Про подъезд и двор человек пишет теми же словами, что про свою квартиру,
  // поэтому адрес по умолчанию берётся не от привязки, а из разбора текста.
  const placed = named ? undefined : await placeParam(deps, command, read.place, buildingId);
  const where = named ?? placed;

  const enriched: CreateRequestCommand = {
    ...command,
    category: command.category ?? read.category,
    priority: command.priority ?? read.priority,
    ...(where ? { startParam: where } : {}),
    ...(command.title?.trim() ? {} : read.title ? { title: read.title } : {}),
  };

  const result = await serialize(buildingId, () =>
    deps.lock ? deps.lock(`${JOIN_LOCK_PREFIX}${buildingId}`, () => submit(deps, enriched)) : submit(deps, enriched),
  );

  if (result.kind === 'planned') return result;

  // Откуда взялась категория, человеку видно: предположение модели не выдаётся
  // за решение справочника.
  return {
    ...result,
    ...(command.category ? {} : { categoryBy: read.by }),
    ...(read.question && result.kind === 'created' ? { question: read.question } : {}),
  };
};

/** Ключ блокировки склейки: заявки соседних домов друг другу не мешают. */
export const JOIN_LOCK_PREFIX = 'domovoy:join:';

/** Сколько заявок жилец может завести за час. */
export const REQUESTS_PER_HOUR = 10;

const HOUR_MS = 60 * 60 * 1000;

/** @throws {DomainError} */
const checkRate = async (deps: AppDeps, command: CreateRequestCommand): Promise<void> => {
  if (command.resident.role !== 'resident') return;

  const recent = await deps.repository.listRequests({
    authorId: command.resident.id,
    createdAfter: new Date(deps.now().getTime() - HOUR_MS),
  });

  if (recent.length >= REQUESTS_PER_HOUR) {
    throw new DomainError('too_many_requests', 'Слишком много заявок за час. Продолжим в следующем часе');
  }
};

/** Сколько ждать повтора той же заявки. */
export const SAME_REQUEST_WINDOW_MS = 2 * 60_000;

/**
 * Та же заявка, только что поданная тем же человеком. Закрытая двойником
 * не считается: если работу успели завершить, повтор означает новую проблему.
 */
const recentTwin = async (deps: AppDeps, command: CreateRequestCommand): Promise<ServiceRequest | undefined> => {
  const text = command.description.trim().toLowerCase();

  const recent = await deps.repository.listRequests({
    authorId: command.resident.id,
    createdAfter: new Date(deps.now().getTime() - SAME_REQUEST_WINDOW_MS),
  });

  return recent.find(
    (request) => !isFinal(request.status) && request.description.trim().toLowerCase() === text,
  );
};

const submit = async (deps: AppDeps, command: CreateRequestCommand): Promise<SubmitResult> => {
  const twin = await recentTwin(deps, command);

  if (twin) return { kind: 'created', request: twin, reporters: reportersCount(twin) };

  await checkRate(deps, command);

  const category = command.category ?? suggestCategory(command.description);

  if (isSharedInfrastructure(category)) {
    const existing = command.anyway ? undefined : await findExisting(deps, command, category);

    if (existing) return joinExisting(deps, command.resident, existing);

    const planned = command.anyway ? undefined : await findPlannedWork(deps, command, category);

    if (planned) {
      return { kind: 'planned', work: planned, explanation: describeWork(planned, deps.now()) };
    }
  }

  const created = await createServiceRequest(deps, command);
  const request = await attachFlat(deps, created, command.resident);

  await notifyStaff(deps, request, reportersCount(request));

  return { kind: 'created', request, reporters: reportersCount(request) };
};

/**
 * Заявку по квартире завела смена: жильцы этой квартиры становятся её
 * заявителями и видят срок, ход работы и приёмку.
 */
const attachFlat = async (deps: AppDeps, request: ServiceRequest, author: Resident): Promise<ServiceRequest> => {
  if (request.target.kind !== 'apartment' || apartmentsOf(author).includes(request.target.apartmentId)) {
    return request;
  }

  const living = await deps.repository.listResidentsByApartments([request.target.apartmentId]);
  const notifier = deps.notifier ?? noopNotifier;
  const zone = await zoneOf(deps, request.buildingId);
  let joined = request;

  for (const person of living) {
    if (person.id === author.id) continue;

    joined = joinRequest(joined, person.id, deps.now());
  }

  if (joined === request) return request;

  const saved = await deps.repository.saveRequest(joined);

  for (const person of living) {
    if (person.id === author.id) continue;

    await notifyResident(
      notifier,
      person,
      `Управляющая компания завела заявку по вашей квартире: ${saved.title}.\n` +
        `${saved.number}, срок до ${formatMoment(saved.resolutionDueAt, zone)}.`,
      actionsFor(saved, person),
      saved.id,
    );
  }

  return saved;
};

/** Очередь обработки по ключу. */
const queues = new Map<string, Promise<unknown>>();

const serialize = <T>(key: string, run: () => Promise<T>): Promise<T> => {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);

  queues.set(
    key,
    next.catch(() => undefined),
  );

  return next;
};


/** Идут ли по этой части дома объявленные работы. */
const findPlannedWork = async (
  deps: AppDeps,
  command: CreateRequestCommand,
  category: RequestCategory,
): Promise<PlannedWork | undefined> => {
  const target = targetOf(command);

  if (!target) return undefined;

  const where = await locateTarget(deps, target);

  if (!where) return undefined;

  const now = deps.now();
  const announced = await deps.repository.listWorksBetween(where.buildingId, now, now);
  const works = announced.map(plannedWork).filter((work) => work !== undefined);

  return explainingWork(works, where, category, now);
};

const findExisting = async (
  deps: AppDeps,
  command: CreateRequestCommand,
  category: RequestCategory,
): Promise<{ request: ServiceRequest; audience: AnnouncementAudience } | undefined> => {
  const target = targetOf(command);

  if (!target) return undefined;

  const audience = await locateTarget(deps, target);

  if (!audience) return undefined;

  const open = await deps.repository.listRequests({
    buildingId: audience.buildingId,
    statuses: [...OPEN_STATUSES],
  });

  // Адреса открытых заявок разбираются по одному списку квартир: иначе каждая
  // квартирная заявка дома стоила бы отдельного чтения.
  const flats = open.some((request) => request.target.kind === 'apartment')
    ? new Map((await deps.repository.listApartments(audience.buildingId)).map((flat) => [flat.id, flat]))
    : undefined;

  const located: LocatedRequest[] = await Promise.all(
    open.map(async (request) => ({ request, audience: await locateTarget(deps, request.target, flats) })),
  );

  const found = findJoinable({ category, audience, at: deps.now(), authorId: command.resident.id }, located);

  return found ? { request: found, audience } : undefined;
};

const joinExisting = async (
  deps: AppDeps,
  resident: Resident,
  existing: { request: ServiceRequest; audience: AnnouncementAudience },
): Promise<SubmitResult> => {
  const promoted = promoteToShared(existing.request, existing.audience);
  const saved = await deps.repository.saveRequest(joinRequest(promoted, resident.id, deps.now()));
  const reporters = reportersCount(saved);

  await confirmIncident(deps, saved, reporters);

  return { kind: 'joined', request: saved, reporters };
};
