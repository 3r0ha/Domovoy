import {
  DomainError,
  OPEN_STATUSES,
  decodeTarget,
  describeTarget,
  encodeTarget,
  isCompanyStaff,
  isSharedInfrastructure,
  type RequestTarget,
  type ServiceRequest,
} from '@domovoy/domain';

import { apartmentsOf } from './apartments.js';
import { speak } from './language.js';
import type { Reasoner } from './reasoner.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Один вариант ответа на уточняющий вопрос: подпись человеку и адрес продукту. */
export interface TargetOption {
  label: string;
  /** Код объекта: тот же, что приходит с наклейки. */
  startParam: string;
}

export interface Clarification {
  question: string;
  /** Варианты кнопками: их подписи человек и нажимает. */
  options: TargetOption[];
  /** Адресом может стать любая квартира дома: заявку завела смена. */
  anyApartment?: boolean;
}

/** Сколько кнопок помещается под сообщением, не превращая его в список. */
export const MAX_OPTIONS = 4;

/** Заявку уточняют, пока она не в работе: позже адрес меняет смена. */
const CHANGEABLE = ['new', 'accepted'];

/** Куда обращение вообще может относиться в этом доме. */
const candidatesFor = async (deps: AppDeps, resident: Resident, request: ServiceRequest): Promise<TargetOption[]> => {
  const buildingId = request.buildingId;
  const options: TargetOption[] = [];
  const t = speak(resident);

  for (const apartmentId of apartmentsOf(resident)) {
    const apartment = await deps.repository.findApartment(apartmentId);

    if (apartment?.buildingId !== buildingId) continue;

    options.push({
      label: t('app.clarify.flat', { номер: apartment.number }),
      startParam: encodeTarget({ kind: 'apartment', apartmentId: apartment.id }),
    });
  }

  const apartments = await deps.repository.listApartments(buildingId);

  for (const entrance of [...new Set(apartments.map((apartment) => apartment.entrance))].sort((a, b) => a - b)) {
    options.push({
      label: t('app.clarify.entrance', { номер: entrance }),
      startParam: encodeTarget({ kind: 'entrance', buildingId, entrance }),
    });
  }

  for (const item of await deps.repository.listEquipment(buildingId)) {
    options.push({
      label: item.title,
      startParam: encodeTarget({ kind: 'equipment', buildingId, equipmentId: item.code }),
    });
  }

  return options;
};

/** Вид объекта из его названия: «Домофон, подъезд 1» это «домоф». */
const kindOf = (label: string): string => (label.split(/[\s,]+/)[0] ?? '').toLowerCase().slice(0, 5);

/** Объекты дома, о которых человек, похоже, и написал. */
const named = (description: string, candidates: readonly TargetOption[]): TargetOption[] => {
  const text = description.toLowerCase();

  return candidates.filter((option) => option.startParam.startsWith('eqp_') && text.includes(kindOf(option.label)));
};

/**
 * Адрес заявки под вопросом. Спрашиваем там, где адрес взялся из привязки,
 * а не из слов человека: у него несколько квартир, речь о домовом оборудовании
 * или об общем имуществе. Названный самим человеком объект не переспрашиваем.
 */
const unclear = (
  request: ServiceRequest,
  resident: Resident,
  mine: number,
  mentioned: readonly TargetOption[],
): boolean => {
  if (!OPEN_STATUSES.includes(request.status)) return false;

  // Спрашивают того, кто завёл заявку: адрес знает он.
  if (request.authorId !== resident.id) return false;

  // Адресом стал дом: человек не привязан к квартире и объект не назвал.
  // Смену спрашиваем всегда: заявку по телефону она заводит за жильца и адрес
  // узнаёт у него, а «дом целиком» это ответ только про общее имущество.
  if (request.target.kind === 'building') {
    return isCompanyStaff(resident.role) || isSharedInfrastructure(request.category);
  }

  if (request.target.kind !== 'apartment') return false;

  // Квартиру выбрал не человек, а привязка: она могла остаться от прошлого раза.
  const byBinding = request.target.apartmentId === resident.apartmentId;

  if (!byBinding) return false;

  // Про домовое оборудование спрашиваем всегда: домофон и лифт в квартире не чинят.
  return mine > 1 || mentioned.length > 0;
};

/**
 * Уточняющий вопрос об адресе с готовыми вариантами. Варианты всегда настоящие:
 * модель только выбирает из них и формулирует вопрос, а придуманное отбрасывается.
 */
export const clarifyTarget = async (
  deps: AppDeps,
  resident: Resident,
  request: ServiceRequest,
): Promise<Clarification | undefined> => {
  const all = await candidatesFor(deps, resident, request);

  // Считаются только квартиры этого дома: вторая квартира в соседнем доме
  // адрес обращения не делает неясным.
  const mine = all.filter((option) => option.startParam.startsWith('apt_')).length;
  const mentioned = named(request.description, all);

  if (!unclear(request, resident, mine, mentioned) || all.length === 0) return undefined;

  // Смена вправе назвать любую квартиру дома: кнопками их не перечислить,
  // поэтому вместе с вариантами она получает выбор квартиры списком.
  const anyApartment = isCompanyStaff(resident.role) && request.target.kind === 'building';

  // Названный объект идёт первым: чаще всего человек имел в виду именно его.
  const candidates = [...mentioned, ...all.filter((option) => !mentioned.includes(option))];

  const reasoner: Reasoner | undefined = deps.reasoner;

  const read = reasoner?.clarify
    ? await reasoner
        .clarify({ description: request.description, candidates: candidates.map((option) => option.label) })
        .catch(() => undefined)
    : undefined;

  // Кнопкой становится только тот вариант, который в доме есть.
  const chosen = (read?.choices ?? [])
    .map((label) => candidates.find((option) => option.label === label))
    .filter((option): option is TargetOption => option !== undefined)
    .slice(0, MAX_OPTIONS);

  const options = chosen.length > 0 ? chosen : candidates.slice(0, MAX_OPTIONS);
  const t = speak(resident);
  const asked = read?.question?.trim() ? read.question.trim().slice(0, 200) : t('app.clarify.where');

  // Смене вопрос задаёт сам продукт: список квартир модели не отдавали, и её
  // вопрос про подъезд разошёлся бы с кнопками.
  const question = anyApartment ? t('app.clarify.whichFlat') : asked;

  return { question, options, ...(anyApartment ? { anyApartment } : {}) };
};

export interface RetargetCommand {
  resident: Resident;
  requestId: string;
  /** Код объекта из уточняющего вопроса. */
  startParam: string;
}

/**
 * Своя ли это квартира. Жилец уточняет адрес только своими квартирами,
 * смена любой квартирой своего дома. @throws {DomainError}
 */
const assertOwnApartment = async (
  deps: AppDeps,
  resident: Resident,
  request: ServiceRequest,
  apartmentId: string,
): Promise<void> => {
  const apartment = await deps.repository.findApartment(apartmentId);

  if (!apartment || apartment.buildingId !== request.buildingId) {
    throw new DomainError('wrong_object', 'Этот объект из другого дома');
  }

  if (isCompanyStaff(resident.role)) return;

  if (!apartmentsOf(resident).includes(apartmentId)) {
    throw new DomainError('forbidden', 'Это чужая квартира');
  }
};

/** Уточнение адреса заявки самим автором. @throws {DomainError} */
export const retargetRequest = async (deps: AppDeps, command: RetargetCommand): Promise<ServiceRequest> => {
  const request = await deps.repository.findRequest(command.requestId);

  if (!request) throw new DomainError('request_not_found', 'Заявка не найдена');

  if (request.authorId !== command.resident.id) {
    throw new DomainError('forbidden', 'Адрес уточняет тот, кто подал обращение');
  }

  if (!CHANGEABLE.includes(request.status)) {
    throw new DomainError('request_closed', 'Заявка уже в работе: адрес поменяет управляющая организация');
  }

  const target: RequestTarget | null = decodeTarget(command.startParam);

  if (!target) throw new DomainError('target_required', 'Такого объекта в доме нет');

  if (target.kind !== 'apartment' && target.buildingId !== request.buildingId) {
    throw new DomainError('wrong_object', 'Этот объект из другого дома');
  }

  if (target.kind === 'apartment') await assertOwnApartment(deps, command.resident, request, target.apartmentId);

  const saved = await deps.repository.saveRequest({
    ...request,
    target,
    history: [
      ...request.history,
      {
        at: deps.now(),
        status: request.status,
        role: command.resident.role,
        actorId: command.resident.id,
        kind: 'message',
        comment: `Адрес уточнён: ${describeTarget(target)}`,
      },
    ],
  });

  return saved;
};
