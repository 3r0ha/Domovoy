import {
  formatMoney, describeUntil, formatMoment, OPEN_STATUSES, type ServiceRequest } from '@domovoy/domain';

import { chargesForResident } from './billing.js';
import { homeOf } from './buildings.js';
import { houseAhead, houseNow } from './now.js';
import { classifyIntent, type QuestionTopic } from './reasoner.js';
import { announcementAudience, type Resident } from './repository.js';
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

const aboutHouse = async (deps: AppDeps, resident: Resident): Promise<string | undefined> => {
  const now = await houseNow(deps, resident);
  const zone = await zoneOf(deps, await homeOf(deps, resident));
  const lines: string[] = [];

  for (const work of now.works) {
    if (!work.works) continue;

    lines.push(
      `${work.title}: ${describeUntil(
        { id: work.id, title: work.title, audience: announcementAudience(work), ...work.works },
        deps.now(),
        zone,
      )}.`,
    );
  }

  for (const incident of now.incidents) {
    lines.push(`${incident.title}: заявка ${incident.number}, срок ${formatMoment(incident.resolutionDueAt, zone)}.`);
  }

  if (lines.length === 0) {
    const ahead = await houseAhead(deps, resident);
    const next = ahead[0];

    return next
      ? `Сейчас в доме ничего не отключено. Ближайшее: ${next.title}, ${formatMoment(next.at, zone)}.`
      : 'Сейчас в доме ничего не отключено и аварий нет.';
  }

  return `Сейчас в доме:\n${lines.join('\n')}`;
};

const aboutBill = async (deps: AppDeps, resident: Resident): Promise<string | undefined> => {
  try {
    const charges = await chargesForResident(deps, resident);
    const left = Math.max(0, charges.total - charges.paid);

    if (charges.lines.length === 0) return 'За этот месяц начислений пока нет.';

    // Про команды жильцу не говорят: за разбором по строкам он идёт кнопкой.
    return left > 0
      ? `К оплате ${formatMoney(left)} до ${charges.dueDay} числа.`
      : 'За этот месяц всё оплачено.';
  } catch {
    return undefined;
  }
};

const aboutRequests = async (deps: AppDeps, resident: Resident): Promise<string | undefined> => {
  const own = (await listRequestsFor(deps, resident, 'mine')).filter((request) =>
    OPEN_STATUSES.includes(request.status),
  );

  if (own.length === 0) return 'Открытых заявок за вами нет.';

  const zone = await zoneOf(deps, await homeOf(deps, resident));

  const lines = own.map(
    (request) => `${request.number}: ${state(request)}, срок ${formatMoment(request.resolutionDueAt, zone)}.`,
  );

  return `Ваши заявки:\n${lines.join('\n')}`;
};

const state = (request: ServiceRequest): string =>
  request.status === 'done' ? 'ждёт вашей приёмки' : request.assigneeId ? 'в работе' : 'принята';

