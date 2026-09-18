import {
  STATUS_TITLES,
  isCompanyStaff,
  describeTarget,
  formatDay,
  formatMoment,
  formatMoney,
  formatSpan,
  isConfirmedIncident,
  reportersCount,
  type ServiceRequest,
} from '@domovoy/domain';

import type { CapitalRepairPlan } from './capital.js';
import { withReadCache } from './cached-repository.js';
import { arrearsFor, dueAt, withoutPeriod, type Debt } from './debt.js';
import { buildingReport, formatReportShort, listAssignable } from './report.js';
import { formatHouseDebtShort, houseDebt } from './collection.js';
import { roleTitle } from './roles.js';
import { waitingHandoffs } from './handoff.js';
import { waitingSupport } from './helpdesk.js';
import { chargesForResident } from './billing.js';
import type { Charges } from '@domovoy/domain';
import { contactsFor, formatContacts, homeOf } from './buildings.js';
import { houseAhead, houseNow } from './now.js';
import { listPollsFor, type PollView } from './voting.js';
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

/** Строка очереди для смены: кто ведёт, сколько осталось и что просрочено. */
const queueLine = (request: ServiceRequest, now: Date): string => {
  const late = request.resolutionDueAt.getTime() < now.getTime();
  const due = late
    ? `просрочено на ${formatSpan(request.resolutionDueAt, now)}`
    : `осталось ${formatSpan(now, request.resolutionDueAt)}`;

  return (
    `${request.number}, ${request.title}: ${STATUS_TITLES[request.status]}, ` +
    `${describeTarget(request.target)}, ${due}${request.assigneeId ? '' : ', исполнитель не назначен'}`
  );
};

/** Заявки соседей по общему имуществу: о них человек и так знает из ленты дома. */
const neighbourLine = (request: ServiceRequest): string =>
  `  ${request.number}, ${request.title}: ` +
  `${describeTarget(request.target)}, сообщили ${reportersCount(request)}, ${STATUS_TITLES[request.status]}`;

/** Состояние работ капремонта словами. */
const WORK_STATES: Record<string, string> = {
  planned: 'по плану',
  running: 'идут работы',
  done: 'сделано',
};

/** Одно собрание строкой: что это, до какого дня и подан ли голос квартиры. */
const pollLine = (view: PollView): string => {
  const what = view.poll.mode === 'survey' ? 'Опрос жильцов' : 'Собрание';
  const voted = view.votedBy ? `, голос квартиры подал ${view.votedBy}` : ', голос квартиры учтён';

  return `  ${what} «${view.poll.title}»: до ${formatMoment(view.poll.closesAt)}${view.myChoice ? voted : ', голос не подан'}`;
};

/** Капитальный ремонт: взнос, накопленное и ближайшие работы. */
const capitalLines = (plan?: CapitalRepairPlan): string[] => {
  if (!plan) return [];

  const saved = plan.balance === undefined ? '' : `, накоплено ${formatMoney(plan.balance)}`;

  return [
    `  Взнос ${plan.contribution} рублей за м² в месяц${saved}`,
    ...plan.works.slice(0, SHOWN).map((work) => `  ${work.title}: ${work.year} год, ${WORK_STATES[work.state]}`),
  ];
};

/** Квитанция за месяц строками: итог и из чего он сложился. */
const billingLines = (charges?: Charges): string[] => {
  if (!charges) return [];

  const left = Math.max(0, charges.total - charges.paid);

  return [
    // Срок стоит датой, а не числом месяца: иначе его приходится вычислять,
    // и в ответе появляется месяц, которого никто не называл.
    `  Период ${charges.period}, начислено ${formatMoney(charges.total)}, ` +
      `оплачено ${formatMoney(charges.paid)}, к оплате ${formatMoney(left)} до ${formatDay(dueAt(charges.period))}`,
    ...charges.lines.map(
      (line) => `  ${line.title}: ${formatMoney(line.amount)}${line.detail ? ` (${line.detail})` : ''}`,
    ),
  ];
};

/** Долг по месяцам и итог с пенями: складывать числа модели нельзя. */
const arrearsLines = (debt?: Debt): string[] => {
  if (!debt?.total) return [];

  const penalty = debt.penalty > 0 ? `, пени ${formatMoney(debt.penalty)}` : '';

  return [
    `  Долг за прошлые месяцы ${formatMoney(debt.total)}${penalty}`,
    `  Погасить долг с пенями ${formatMoney(debt.total + debt.penalty)}`,
    ...debt.periods.map((item) => `  ${item.period}: осталось ${formatMoney(item.left)}`),
  ];
};

const section = (title: string, lines: readonly string[]): string =>
  lines.length > 0 ? `${title}:\n${lines.join('\n')}` : '';

/** Что в доме у смены: очередь, вопросы жильцов и переданные обращения. */
const shiftFacts = async (deps: AppDeps, resident: Resident): Promise<string[]> => {
  const lines: string[] = [];

  const [report, waiting, passed, staff, debt, queue] = await Promise.all([
    buildingReport(deps, resident).catch(() => undefined),
    waitingSupport(deps, resident.buildingId ?? deps.defaultBuildingId).catch(() => 0),
    waitingHandoffs(deps, resident).catch(() => []),
    listAssignable(deps, resident).catch(() => []),
    houseDebt(deps, resident).catch(() => undefined),
    listRequestsFor(deps, resident, 'queue').catch(() => []),
  ]);

  if (report) lines.push(...formatReportShort(report).split('\n').map((line) => `  ${line}`));

  // Первые строки очереди: «что горит» спрашивают именно про них.
  if (queue.length > 0) {
    lines.push(
      ...queue
        .slice(0, SHOWN)
        .map((request) => `  Очередь: ${queueLine(request, deps.now())}`),
    );
  }

  if (waiting > 0) lines.push(`  Вопросов жильцов без ответа: ${waiting}`);

  // Кому поручить, спрашивают чаще прочего: имена и нагрузка идут сразу.
  if (staff.length > 0) {
    lines.push(
      `  Кому можно поручить: ${staff
        .slice(0, SHOWN)
        .map((person) => `${person.displayName} (${roleTitle(person.role)}, нарядов ${person.load})`)
        .join('; ')}`,
    );
  }

  if (debt && debt.debtors.length > 0) {
    lines.push(`  ${formatHouseDebtShort(debt)}`);
    lines.push(
      ...debt.debtors
        .slice(0, SHOWN)
        .map(
          (debtor) =>
            `  Должник: кв. ${debtor.apartmentNumber ?? '?'}, ${debtor.displayName}, ` +
            `${formatMoney(debtor.debt + debtor.penalty)}`,
        ),
    );
  }

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
  // Разделы независимы, а дом и квартиру спрашивают почти все: читаем разом и один раз.
  const scoped: AppDeps = { ...deps, repository: withReadCache(deps.repository) };

  const [home, mine, state, ahead, nearby, contacts, charges, debt, meters, polls] = await Promise.all([
    homeOf(scoped, resident).catch(() => undefined),
    listRequestsFor(scoped, resident, 'mine').catch(() => []),
    houseNow(scoped, resident).catch(() => undefined),
    houseAhead(scoped, resident).catch(() => []),
    supportableFor(scoped, resident).catch(() => []),
    contactsFor(scoped, resident).catch(() => undefined),
    chargesForResident(scoped, resident).catch(() => undefined),
    arrearsFor(scoped, resident).catch(() => undefined),
    metersFor(scoped, resident).catch(() => []),
    listPollsFor(scoped, resident).catch(() => []),
  ]);

  const [building, apartment] = await Promise.all([
    home ? scoped.repository.findBuilding(home) : undefined,
    resident.apartmentId ? scoped.repository.findApartment(resident.apartmentId) : undefined,
  ]);

  // Смене нужны её дела: очередь, просрочка, вопросы без ответа и переданное.
  const [capital, shift] = await Promise.all([
    home ? scoped.capitalRepair?.planFor(home, building).catch(() => undefined) : undefined,
    isCompanyStaff(resident.role) ? shiftFacts(scoped, resident) : [],
  ]);

  return [
    // Сейчас стоит первой строкой: без неё «сегодня» и «завтра» модель считает сама.
    `Сейчас: ${formatMoment(now)}.`,
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
    section('Начисления', billingLines(charges)),
    // Месяц квитанции из долга вычитается: на экране он отдельной строкой,
    // и без этого одно и то же начисление считается дважды.
    section('Долг', arrearsLines(debt && charges ? withoutPeriod(debt, charges.period) : debt)),
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
    section('Собрания', polls.filter((view) => view.open).slice(0, SHOWN).map(pollLine)),
    section('Капитальный ремонт', capitalLines(capital)),
    contacts ? `Контакты дома:\n${formatContacts(contacts)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};
