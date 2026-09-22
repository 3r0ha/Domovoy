import {
  formatMoney,
  STATUS_TITLES,
  CATEGORY_RULES,
  DomainError,
  METER_RULES,
  NOTICE_TITLES,
  formatDate,
  type Apartment,
  type ServiceRequest,
  type VoteChoice,
} from '@domovoy/domain';

import type { Translate } from '@domovoy/i18n';

import { periodTitle } from './debt.js';
import { speakDefault } from './language.js';

import { choiceTitle } from './voting.js';
import type { Building, Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

export interface PersonalRequest {
  number: string;
  title: string;
  description: string;
  category: string;
  status: string;
  createdAt: Date;
  /** Что человек писал по этой заявке: его собственные реплики. */
  comments: { at: Date; text: string }[];
}

export interface PersonalReading {
  meter: string;
  value: number;
  unit: string;
  at: Date;
}

export interface PersonalVote {
  poll: string;
  choice: VoteChoice;
  at: Date;
}

export interface PersonalPayment {
  /** За какой месяц заплатили. */
  period: string;
  amount: number;
  at: Date;
}

export interface PersonalData {
  displayName: string;
  role: Resident['role'];
  address?: string;
  apartment?: number;
  /** Телефон, если человек им поделился. */
  phone?: string;
  /** Какие уведомления он отключил. */
  muted: string[];
  requests: PersonalRequest[];
  readings: PersonalReading[];
  votes: PersonalVote[];
  /** Что платили по квартире. */
  payments: PersonalPayment[];
}

/** Заявки человека вместе с его собственными репликами по ним. */
const ownRequests = (requests: readonly ServiceRequest[], resident: Resident): PersonalRequest[] =>
  requests.map((request) => ({
    number: request.number,
    title: request.title,
    description: request.description,
    category: CATEGORY_RULES[request.category].title,
    status: STATUS_TITLES[request.status],
    createdAt: request.createdAt,
    comments: request.history
      .filter((event) => event.actorId === resident.id && event.comment)
      .map((event) => ({ at: event.at, text: event.comment ?? '' })),
  }));

/** Показания, поданные самим человеком: приборы и их история читаются пакетом. */
const ownReadings = async (
  deps: AppDeps,
  resident: Resident,
  apartment?: Apartment,
): Promise<PersonalReading[]> => {
  if (!apartment) return [];

  const meters = await deps.repository.listMetersByApartments([apartment.id]);

  if (meters.length === 0) return [];

  const history = await deps.repository.listReadingsFor(meters.map((meter) => meter.id));
  const readings: PersonalReading[] = [];

  for (const meter of meters) {
    for (const reading of history) {
      if (reading.meterId !== meter.id || reading.submittedBy !== resident.id) continue;

      readings.push({
        meter: meter.serial,
        value: reading.value,
        unit: METER_RULES[meter.kind].unit,
        at: reading.at,
      });
    }
  }

  return readings;
};

/** Голоса человека по собраниям его дома. */
const ownVotes = async (deps: AppDeps, resident: Resident, building?: Building): Promise<PersonalVote[]> => {
  if (!building) return [];

  const votes: PersonalVote[] = [];

  for (const poll of await deps.repository.listPolls(building.id)) {
    for (const vote of await deps.repository.listVotes(poll.id)) {
      if (vote.residentId === resident.id) votes.push({ poll: poll.title, choice: vote.choice, at: vote.at });
    }
  }

  return votes;
};

/** Платежи по квартире, если платежи вообще подключены. */
const ownPayments = async (deps: AppDeps, apartment?: Apartment): Promise<PersonalPayment[]> => {
  const history = apartment ? ((await deps.payments?.history(apartment.id)) ?? []) : [];

  return history.map((receipt) => ({ period: receipt.period, amount: receipt.amount, at: receipt.at }));
};

/** Всё, что продукт знает о человеке. */
export const exportPersonalData = async (deps: AppDeps, resident: Resident): Promise<PersonalData> => {
  const requests = await deps.repository.listRequests({ reporterId: resident.id });
  const apartment = resident.apartmentId ? await deps.repository.findApartment(resident.apartmentId) : undefined;
  const building = await deps.repository.findBuilding(apartment?.buildingId ?? resident.buildingId ?? '');

  return {
    displayName: resident.displayName,
    role: resident.role,
    ...(building ? { address: building.address } : {}),
    ...(apartment ? { apartment: apartment.number } : {}),
    ...(resident.phone ? { phone: resident.phone } : {}),
    muted: (resident.mutes ?? []).map((kind) => NOTICE_TITLES[kind]),
    requests: ownRequests(requests, resident),
    readings: await ownReadings(deps, resident, apartment),
    votes: await ownVotes(deps, resident, building),
    payments: await ownPayments(deps, apartment),
  };
};

const date = formatDate;


/** Что в выгрузке, одной строкой: сам список уходит файлом. */
export const personalDataSummary = (data: PersonalData, t: Translate = speakDefault()): string =>
  t('app.privacy.summary', {
    заявок: data.requests.length,
    показаний: data.readings.length,
    голосов: data.votes.length,
    платежей: data.payments.length,
  });

export const formatPersonalData = (data: PersonalData, timeZone: string): string => {
  const lines = [`${data.displayName}`];

  if (data.address) lines.push(`${data.address}${data.apartment ? `, кв. ${data.apartment}` : ''}`);
  if (data.phone) lines.push(`Телефон: ${data.phone}`);
  if (data.muted.length > 0) lines.push(`Отключено: ${data.muted.join(', ')}`);

  if (data.requests.length > 0) {
    lines.push('', `Заявки (${data.requests.length})`);

    for (const request of data.requests) {
      lines.push(`  ${request.number} · ${date(request.createdAt, timeZone)} · ${request.status}`);
      lines.push(`  ${request.title}`);

      for (const comment of request.comments) lines.push(`    ${date(comment.at, timeZone)}: ${comment.text}`);
    }
  }

  if (data.readings.length > 0) {
    lines.push('', `Показания (${data.readings.length})`);

    for (const reading of data.readings) {
      lines.push(
        `  ${reading.meter} · ${reading.value.toLocaleString('ru-RU')} ${reading.unit} · ${date(reading.at, timeZone)}`,
      );
    }
  }

  if (data.votes.length > 0) {
    lines.push('', `Голоса (${data.votes.length})`);

    for (const vote of data.votes) {
      lines.push(`  ${vote.poll} · ${choiceTitle(speakDefault(), vote.choice)} · ${date(vote.at, timeZone)}`);
    }
  }

  if (data.payments.length > 0) {
    lines.push('', `Платежи (${data.payments.length})`);

    for (const payment of data.payments) {
      lines.push(`  ${periodTitle(payment.period)} · ${formatMoney(payment.amount)} · ${date(payment.at, timeZone)}`);
    }
  }

  if (data.requests.length + data.readings.length + data.votes.length + data.payments.length === 0) {
    lines.push('', 'Заявок, показаний, голосов и платежей за вами не числится.');
  }

  return lines.join('\n');
};

/** Имя обезличенного профиля. */
export const FORGOTTEN_NAME = 'Профиль удалён';

/** Удаляет профиль по требованию человека. */
export const forgetResident = async (deps: AppDeps, resident: Resident): Promise<Resident> => {
  if (resident.role !== 'resident') {
    throw new DomainError('forbidden', 'Профиль сотрудника снимает управляющая организация');
  }

  const anonymous = { ...resident, displayName: FORGOTTEN_NAME, forgottenAt: deps.now() };

  delete anonymous.maxUserId;
  delete anonymous.apartmentId;
  delete anonymous.apartmentIds;
  delete anonymous.phone;
  delete anonymous.mutes;

  return deps.repository.saveResident(anonymous);
};
