import {
  DomainError,
  HANDOFF_BASIS,
  HANDOFF_STATUS_TITLES,
  HANDOFF_TITLES,
  formatMoment,
  handoffDueAt,
  isCompanyStaff,
  isHandoffOverdue,
  reporterIds,
  responsibilityFor,
  spreadOf,
  type Handoff,
  type HandoffStatus,
  type HandoffTarget,
  type Responsibility,
  type ServiceRequest,
} from '@domovoy/domain';

import { recordAction } from './audit.js';
import { assertServes } from './buildings.js';
import { noopNotifier, notifyResident } from './notifier.js';
import type { Building, HousePartner, Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/**
 * Канал передачи обращения смежной организации. В MVP канал модельный: он
 * возвращает номер и подтверждение, но настоящего обмена за ним нет.
 */
export interface HandoffGateway {
  /** Как канал называется в журнале: `gis_zhkh`, `pos`, `email`. */
  readonly channel: string;
  /** Обмен модельный: человеку это показывается рядом с номером. */
  readonly model: boolean;
  send(outbound: OutboundHandoff): Promise<HandoffReceipt>;
}

export interface OutboundHandoff {
  handoffId: string;
  to: HandoffTarget;
  organization: string;
  request: ServiceRequest;
  building: Building;
  /** Что передающая сторона добавила от себя. */
  note?: string;
}

export interface HandoffReceipt {
  /** Номер обращения во внешней системе. */
  externalId?: string;
  /** Принимающая сторона подтвердила приём. */
  accepted?: boolean;
}

/** Передача без канала: обращение ушло письмом или звонком, факт записан в продукте. */
export const MANUAL_CHANNEL = 'manual';

/** Кто отвечает за обращение и кому его можно передать. */
export interface ResponsibilityView {
  responsibility: Responsibility;
  /** Организация из карточки дома, если зона не управляющей. */
  organization?: string;
  /** Кому обращение можно передать: только заведённые в доме организации. */
  targets: { to: HandoffTarget; organization: string; basis: string }[];
}

const partnerFor = (building: Building | undefined, to: HandoffTarget, request: ServiceRequest): HousePartner | undefined =>
  (building?.partners ?? []).find(
    (partner) => partner.kind === to && (!partner.categories || partner.categories.includes(request.category)),
  );

/** Зона ответственности по заявке и организации дома, которым её можно передать. */
export const responsibilityOf = async (deps: AppDeps, request: ServiceRequest): Promise<ResponsibilityView> => {
  const building = await deps.repository.findBuilding(request.buildingId);
  const responsibility = responsibilityFor(request.category, request.target, spreadOf(request).verdict);
  const partner = partnerFor(building, responsibility.kind as HandoffTarget, request);

  // Тот, кто уже ждёт ответа, кнопкой не предлагается: повторная передача
  // всё равно вернула бы отказ.
  const waiting = await deps.repository.listHandoffs({ requestId: request.id, waiting: true });

  const targets = (building?.partners ?? [])
    .filter((item) => !item.categories || item.categories.includes(request.category))
    .filter((item) => !waiting.some((handoff) => handoff.to === item.kind))
    .map((item) => ({ to: item.kind, organization: item.title, basis: HANDOFF_BASIS[item.kind] }));

  return {
    responsibility,
    ...(partner ? { organization: partner.title } : {}),
    targets,
  };
};

export interface PassRequestInput {
  staff: Resident;
  requestId: string;
  to: HandoffTarget;
  note?: string;
}

const assertStaff = (staff: Resident): void => {
  if (!isCompanyStaff(staff.role)) {
    throw new DomainError('forbidden', 'Передавать обращение вправе управляющая организация');
  }
};

/** Передаёт обращение смежной организации. @throws {DomainError} */
export const passRequest = async (deps: AppDeps, input: PassRequestInput): Promise<Handoff> => {
  assertStaff(input.staff);

  const request = await deps.repository.findRequest(input.requestId);

  if (!request) throw new DomainError('request_not_found', 'Заявка не найдена');

  await assertServes(deps, input.staff, request.buildingId);

  const building = await deps.repository.findBuilding(request.buildingId);
  const partner = partnerFor(building, input.to, request);

  if (!partner) {
    throw new DomainError('partner_unknown', `В карточке дома нет организации: ${HANDOFF_TITLES[input.to]}`);
  }

  const waiting = await deps.repository.listHandoffs({ requestId: request.id, waiting: true });

  if (waiting.some((handoff) => handoff.to === input.to)) {
    throw new DomainError('handoff_exists', `Обращение уже передано: ${partner.title}`);
  }

  const now = deps.now();
  const id = deps.createId();
  const gateway = deps.handoffs;

  const receipt = gateway
    ? await gateway
        .send({
          handoffId: id,
          to: input.to,
          organization: partner.title,
          request,
          ...(building ? { building } : {}),
          ...(input.note ? { note: input.note } : {}),
        } as OutboundHandoff)
        .catch(() => undefined)
    : undefined;

  const handoff: Handoff = {
    id,
    requestId: request.id,
    buildingId: request.buildingId,
    to: input.to,
    organization: partner.title,
    channel: gateway?.channel ?? partner.channel ?? MANUAL_CHANNEL,
    status: receipt?.accepted ? 'accepted' : gateway && !receipt ? 'failed' : 'sent',
    dueAt: handoffDueAt(input.to, now),
    createdAt: now,
    ...(receipt?.externalId ? { externalId: receipt.externalId } : {}),
  };

  const saved = await deps.repository.saveHandoff(handoff);

  await recordAction(deps, {
    actor: input.staff,
    action: 'request_passed',
    subject: request.number,
    details: `${partner.title}, канал ${saved.channel}`,
    buildingId: request.buildingId,
  });

  const notifier = deps.notifier ?? noopNotifier;
  const text = formatPassed(saved, request);

  for (const residentId of reporterIds(request)) {
    await notifyResident(notifier, await deps.repository.findResident(residentId), text);
  }

  return saved;
};

export interface AnswerHandoffInput {
  handoffId: string;
  status: HandoffStatus;
  answer?: string;
  externalId?: string;
  /** Кто записал ответ. Пусто означает, что ответ пришёл каналом. */
  staff?: Resident;
}

/** Записывает ответ принимающей стороны. @throws {DomainError} */
export const answerHandoff = async (deps: AppDeps, input: AnswerHandoffInput): Promise<Handoff> => {
  if (input.staff) assertStaff(input.staff);

  const handoff = await deps.repository.findHandoff(input.handoffId);

  if (!handoff) throw new DomainError('handoff_not_found', 'Переданное обращение не найдено');

  if (input.staff) await assertServes(deps, input.staff, handoff.buildingId);

  const now = deps.now();
  const answered = input.status === 'answered' || input.status === 'failed';

  const saved = await deps.repository.saveHandoff({
    ...handoff,
    status: input.status,
    ...(input.answer ? { answer: input.answer } : {}),
    ...(input.externalId ? { externalId: input.externalId } : {}),
    ...(answered ? { answeredAt: now } : {}),
  });

  const request = await deps.repository.findRequest(handoff.requestId);

  if (answered && request) {
    const notifier = deps.notifier ?? noopNotifier;
    const text = formatAnswered(saved, request);

    for (const residentId of reporterIds(request)) {
      await notifyResident(notifier, await deps.repository.findResident(residentId), text);
    }
  }

  return saved;
};

/** Переданные обращения по заявке. */
export const handoffsOf = async (deps: AppDeps, requestId: string): Promise<Handoff[]> =>
  deps.repository.listHandoffs({ requestId });

/** Переданные обращения дома, по которым ответа ещё нет. @throws {DomainError} */
export const waitingHandoffs = async (deps: AppDeps, staff: Resident, buildingId?: string): Promise<Handoff[]> => {
  assertStaff(staff);

  const house = buildingId ?? staff.buildingId ?? deps.defaultBuildingId;

  await assertServes(deps, staff, house);

  return deps.repository.listHandoffs({ buildingId: house, waiting: true });
};

/** Строка о передаче для переписки и карточки заявки. */
export const formatHandoff = (handoff: Handoff, now: Date): string => {
  const overdue = isHandoffOverdue(handoff, now) ? ', срок ответа вышел' : '';
  const external = handoff.externalId ? `, номер ${handoff.externalId}` : '';
  const answer = handoff.answer ? `\nОтвет: ${handoff.answer}` : '';

  return (
    `${handoff.organization}: ${HANDOFF_STATUS_TITLES[handoff.status]}${external}${overdue}\n` +
    `Ответ ожидается до ${formatMoment(handoff.dueAt)}. ${HANDOFF_BASIS[handoff.to]}${answer}`
  );
};

/** Что видит жилец, когда его обращение передали. */
export const formatPassed = (handoff: Handoff, request: ServiceRequest): string =>
  `Заявка ${request.number}: обращение передано в ${handoff.organization}.\n` +
  `Ответ ожидается до ${formatMoment(handoff.dueAt)}. ${HANDOFF_BASIS[handoff.to]}` +
  (handoff.externalId ? `\nНомер во внешней системе: ${handoff.externalId}` : '') +
  '\nЗаявка остаётся на контроле управляющей организации.';

/** Что видит жилец, когда пришёл ответ. */
export const formatAnswered = (handoff: Handoff, request: ServiceRequest): string =>
  handoff.status === 'failed'
    ? `Заявка ${request.number}: обращение в ${handoff.organization} не доставлено. Управляющая организация передаст его другим способом.`
    : `Заявка ${request.number}: ${handoff.organization} ответила.` + (handoff.answer ? `\n${handoff.answer}` : '');
