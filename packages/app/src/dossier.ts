import {
  STATUS_TITLES,
  isCompanyStaff,
  describeTarget,
  formatMoment,
  formatMoney,
  isConfirmedIncident,
  reportersCount,
  type ServiceRequest,
} from '@domovoy/domain';

import { arrearsFor } from './debt.js';
import { buildingReport, formatReportShort } from './report.js';
import { waitingHandoffs } from './handoff.js';
import { waitingSupport } from './helpdesk.js';
import { chargesForResident } from './billing.js';
import { contactsFor, formatContacts, homeOf } from './buildings.js';
import { houseAhead, houseNow } from './now.js';
import { listPollsFor } from './voting.js';
import { metersFor } from './meters.js';
import { supportableFor } from './support.js';
import type { Resident } from './repository.js';
import { listRequestsFor, type AppDeps } from './use-cases.js';

/** Сколько строк одного вида уходит в разбор: дальше начинается пересказ ленты. */
const SHOWN = 5;

/** Одна строка о заявке: номер, суть, состояние и срок. */
const requestLine = (request: ServiceRequest, now: Date): string =>
  `  ${request.number}, ${request.title}: ` +
  `${STATUS_TITLES[request.status]}, ${describeTarget(request.target)}, ` +
  `срок до ${formatMoment(request.resolutionDueAt)}${request.resolutionDueAt < now ? ' (просрочен)' : ''}`;

/** Заявки соседей по общему имуществу: о них человек и так знает из ленты дома. */
const neighbourLine = (request: ServiceRequest): string =>
  `  ${request.number}, ${request.title}: ` +
  `${describeTarget(request.target)}, сообщили ${reportersCount(request)}, ${STATUS_TITLES[request.status]}`;

const section = (title: string, lines: readonly string[]): string =>
  lines.length > 0 ? `${title}:\n${lines.join('\n')}` : '';

/** Что в доме у смены: очередь, вопросы жильцов и переданные обращения. */
const shiftFacts = async (deps: AppDeps, resident: Resident): Promise<string[]> => {
  const lines: string[] = [];
  const report = await buildingReport(deps, resident).catch(() => undefined);

  if (report) lines.push(...formatReportShort(report).split('\n').map((line) => `  ${line}`));

  const waiting = await waitingSupport(deps, resident.buildingId ?? deps.defaultBuildingId).catch(() => 0);

  if (waiting > 0) lines.push(`  Вопросов жильцов без ответа: ${waiting}`);

  const passed = await waitingHandoffs(deps, resident).catch(() => []);

  if (passed.length > 0) {
    lines.push(
      ...passed
        .slice(0, SHOWN)
        .map((handoff) => `  Передано ${handoff.organization}: ответ до ${formatMoment(handoff.dueAt)}`),
    );
  }

  return lines;
};

/**
 * Что помощник знает о доме и человеке. Правило одно: сюда попадает только то,
 * что человек и так видит своими глазами в продукте, его собственные начисления
 * и заявки и то, что в доме открыто для всех жильцов. Чужих имён, телефонов
 * и чужих квартирных заявок здесь нет, поэтому вытащить их из помощника нечем.
 */
export const dossierFor = async (deps: AppDeps, resident: Resident): Promise<string> => {
  const now = deps.now();
  const home = await homeOf(deps, resident).catch(() => undefined);
  const building = home ? await deps.repository.findBuilding(home) : undefined;
  const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;

  const mine = await listRequestsFor(deps, resident, 'mine').catch(() => []);
  const state = await houseNow(deps, resident).catch(() => undefined);
  const ahead = await houseAhead(deps, resident).catch(() => []);
  const nearby = await supportableFor(deps, resident).catch(() => []);
  const contacts = await contactsFor(deps, resident).catch(() => undefined);
  const charges = await chargesForResident(deps, resident).catch(() => undefined);
  const debt = await arrearsFor(deps, resident).catch(() => undefined);
  const meters = await metersFor(deps, resident).catch(() => []);
  const polls = await listPollsFor(deps, resident).catch(() => []);

  // Смене нужны её дела: очередь, просрочка, вопросы без ответа и переданное.
  const shift = isCompanyStaff(resident.role) ? await shiftFacts(deps, resident) : [];

  const left = charges ? Math.max(0, charges.total - charges.paid) : 0;

  const billing = charges
    ? [
        `  Период ${charges.period}, начислено ${formatMoney(charges.total)}, оплачено ${formatMoney(charges.paid)}, к оплате ${formatMoney(left)} до ${charges.dueDay} числа`,
        ...charges.lines.map(
          (line) => `  ${line.title}: ${formatMoney(line.amount)}${line.detail ? ` (${line.detail})` : ''}`,
        ),
      ]
    : [];

  const arrears = debt?.total
    ? [
        `  Долг за прошлые месяцы ${formatMoney(debt.total)}${debt.penalty > 0 ? `, пени ${formatMoney(debt.penalty)}` : ''}`,
        ...debt.periods.map((item) => `  ${item.period}: осталось ${formatMoney(item.left)}`),
      ]
    : [];

  return [
    `Роль: ${resident.role}.`,
    `Имя: ${resident.displayName}.`,
    building?.address ? `Дом: ${building.address}.` : 'Дом не определён.',
    building?.managementCompany ? `Управляющая организация: ${building.managementCompany}.` : '',
    apartment ? `Квартира: ${apartment.number}.` : 'Квартира не привязана: счётчики и квитанция закрыты.',
    section('Заявки этого человека', mine.slice(0, SHOWN).map((request) => requestLine(request, now))),
    section(
      'Аварии в доме сейчас',
      (state?.incidents ?? [])
        .slice(0, SHOWN)
        .map(
          (request) =>
            `  ${request.number}, ${request.title}: ${describeTarget(request.target)}` +
            `${isConfirmedIncident(request) ? ', подтверждена соседями' : ''}, срок до ${formatMoment(request.resolutionDueAt)}`,
        ),
    ),
    section(
      'Работы идут сейчас',
      (state?.works ?? []).slice(0, SHOWN).map((work) => `  ${work.title}${work.body ? `: ${work.body}` : ''}`),
    ),
    section(
      'Что в доме будет',
      ahead.slice(0, SHOWN).map((event) => `  ${event.title}, ${event.where}, ${formatMoment(event.at)}`),
    ),
    section('О чём уже сообщили соседи', nearby.slice(0, SHOWN).map(neighbourLine)),
    section('Начисления', billing),
    section('Долг', arrears),
    section(
      'Счётчики',
      meters
        .slice(0, SHOWN)
        .map(
          (state) =>
            `  ${state.meter.kind}, номер ${state.meter.serial}: ` +
            `${state.submittedThisMonth ? 'показание за месяц подано' : 'показание за месяц не подано'}` +
            `${state.last ? `, последнее ${state.last.value}` : ''}`,
        ),
    ),
    section('Дела смены', shift),
    section(
      'Собрания',
      polls
        .filter((view) => view.open)
        .slice(0, SHOWN)
        .map((view) => `  ${view.poll.title}: до ${formatMoment(view.poll.closesAt)}${view.myChoice ? ', ваш голос учтён' : ''}`),
    ),
    contacts ? `Контакты дома:\n${formatContacts(contacts)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};
