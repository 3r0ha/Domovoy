import {
  formatMoney, describeUntil, formatMoment, OPEN_STATUSES, statusKey, isFinal, type ServiceRequest } from '@domovoy/domain';

import type { Translate } from '@domovoy/i18n';

import { chargesForResident } from './billing.js';
import { homeOf } from './buildings.js';
import { speak } from './language.js';
import { houseAhead, houseNow } from './now.js';
import { classifyIntent, type QuestionTopic } from './reasoner.js';
import { announcementAudience, type Resident } from './repository.js';
import { supportableFor } from './support.js';
import { listRequestsFor, type AppDeps } from './use-cases.js';
import { zoneOf } from './zone.js';

export interface HouseAnswer {
  /** Готовый ответ жильцу. Пусто, если продукт такого не знает. */
  text?: string;
  topic: QuestionTopic;
}

/** Ответ на вопрос жильца о доме. Модель относит вопрос к теме, текст собирается из данных. */
export const answerAboutHouse = async (deps: AppDeps, resident: Resident, text: string): Promise<HouseAnswer> => {
  const read = await classifyIntent(text, deps.reasoner);

  if (read.intent !== 'question') return { topic: 'unknown' };

  const answer = await composeAnswer(deps, resident, read.topic);

  return { topic: read.topic, ...(answer ? { text: answer } : {}) };
};

const composeAnswer = async (deps: AppDeps, resident: Resident, topic: QuestionTopic): Promise<string | undefined> => {
  switch (topic) {
    case 'works':
    case 'incident':
      return aboutHouse(deps, resident);
    case 'bill':
      return aboutBill(deps, resident);
    case 'request':
      return aboutRequests(deps, resident);
    default:
      return undefined;
  }
};

/** Что в доме сейчас: идущие работы и аварии, а если их нет, ближайшее событие. */
export const describeHouseNow = async (deps: AppDeps, resident: Resident): Promise<string | undefined> =>
  aboutHouse(deps, resident);

const aboutHouse = async (deps: AppDeps, resident: Resident): Promise<string | undefined> => {
  const now = await houseNow(deps, resident);
  const zone = await zoneOf(deps, await homeOf(deps, resident));
  const t = speak(resident);
  const lines: string[] = [];

  for (const work of now.works) {
    if (!work.works) continue;

    lines.push(
      t('app.answer.houseWork', {
        название: work.title,
        до: describeUntil(
          { id: work.id, title: work.title, audience: announcementAudience(work), ...work.works },
          deps.now(),
          zone,
        ),
      }),
    );
  }

  for (const incident of now.incidents) {
    lines.push(
      t('app.answer.houseIncident', {
        название: incident.title,
        номер: incident.number,
        срок: formatMoment(incident.resolutionDueAt, zone),
      }),
    );
  }

  if (lines.length > 0) return t('app.answer.houseNow', { строки: lines.join('\n') });

  // Аварии не объявлено, но открытые заявки по общему имуществу уже могут
  // быть: свои и соседские. Человеку с отключённой водой они и нужны.
  const reported = await sharedRequests(deps, resident);

  if (reported.length > 0) {
    return t('app.answer.houseShared', {
      строки: reported
        .map((request) =>
          t('app.answer.houseSharedLine', {
            название: request.title,
            номер: request.number,
            состояние: t(statusKey(request.status)),
          }),
        )
        .join('\n'),
    });
  }

  const ahead = await houseAhead(deps, resident);
  const next = ahead[0];

  return next
    ? t('app.answer.houseAhead', { событие: next.title, когда: formatMoment(next.at, zone) })
    : t('app.answer.houseQuiet');
};

/** Открытые заявки по общему имуществу, которые касаются человека: его собственные и соседские. */
const sharedRequests = async (deps: AppDeps, resident: Resident): Promise<ServiceRequest[]> => {
  const mine = (await listRequestsFor(deps, resident, 'mine')).filter(
    (request) => !isFinal(request.status) && request.target.kind !== 'apartment',
  );

  return [...mine, ...(await supportableFor(deps, resident))];
};

const aboutBill = async (deps: AppDeps, resident: Resident): Promise<string | undefined> => {
  const t = speak(resident);

  try {
    const charges = await chargesForResident(deps, resident);
    const left = Math.max(0, charges.total - charges.paid);

    if (charges.lines.length === 0) return t('app.answer.billEmpty');

    // Про команды жильцу не говорят: за разбором по строкам он идёт кнопкой.
    return left > 0
      ? t('app.answer.billLeft', { сумма: formatMoney(left), число: charges.dueDay })
      : t('app.answer.billPaid');
  } catch {
    return undefined;
  }
};

const aboutRequests = async (deps: AppDeps, resident: Resident): Promise<string | undefined> => {
  const own = (await listRequestsFor(deps, resident, 'mine')).filter((request) =>
    OPEN_STATUSES.includes(request.status),
  );
  const t = speak(resident);

  if (own.length === 0) return t('app.answer.requestsEmpty');

  const zone = await zoneOf(deps, await homeOf(deps, resident));

  const lines = own.map((request) =>
    t('app.answer.requestLine', {
      номер: request.number,
      состояние: state(t, request),
      срок: formatMoment(request.resolutionDueAt, zone),
    }),
  );

  return t('app.answer.requests', { строки: lines.join('\n') });
};

const state = (t: Translate, request: ServiceRequest): string =>
  request.status === 'done'
    ? t('app.answer.requestWaiting')
    : request.assigneeId
      ? t('app.answer.requestWorking')
      : t('app.answer.requestNew');

