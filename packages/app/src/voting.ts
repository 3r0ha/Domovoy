import {
  DomainError,
  POLL_RULES,
  areaToQuorum,
  castVote,
  countVotes,
  electElder,
  formatDate,
  formatDay,
  isOpen,
  needsClosing,
  type Poll,
  type PollKind,
  type PollResult,
  type VoteChoice,
} from '@domovoy/domain';

import { apartmentIn, apartmentsOf } from './apartments.js';
import { recordAction } from './audit.js';
import { assertServes, houseHint, housesOf } from './buildings.js';
import { wanting } from './notices.js';
import { noopNotifier, notifyAbout, notifyResident } from './notifier.js';
import { zoneOf } from './zone.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

const CAN_START: Resident['role'][] = ['manager', 'dispatcher'];

export interface StartPollCommand {
  resident: Resident;
  kind: PollKind;
  title: string;
  question: string;
  /** Сколько дней идёт голосование. */
  days: number;
}

/** Объявляет собрание собственников. */
export const startPoll = async (deps: AppDeps, command: StartPollCommand): Promise<Poll> => {
  if (!CAN_START.includes(command.resident.role)) {
    throw new DomainError('forbidden', 'Собрание объявляет управляющая компания');
  }

  if (command.days <= 0) {
    throw new DomainError('poll_period_invalid', 'Голосование должно идти хотя бы день');
  }

  const buildingId = command.resident.buildingId ?? deps.defaultBuildingId;

  if ((await deps.repository.listApartments(buildingId)).every((apartment) => !apartment.area)) {
    throw new DomainError(
      'areas_missing',
      'У дома не внесены площади помещений, а голос считается их долей: без площадей собрание не провести',
    );
  }

  const opensAt = deps.now();

  const poll = await deps.repository.savePoll({
    id: deps.createId(),
    buildingId,
    kind: command.kind,
    title: command.title,
    question: command.question,
    opensAt,
    closesAt: new Date(opensAt.getTime() + command.days * 24 * 3600_000),
    startedBy: command.resident.id,
  });

  await recordAction(deps, { actor: command.resident, action: 'poll_started', subject: poll.title, buildingId });

  const apartments = await deps.repository.listApartments(buildingId);
  const residents = await deps.repository.listResidentsByApartments(apartments.map((apartment) => apartment.id));
  const notifier = deps.notifier ?? noopNotifier;
  const closes = formatDay(poll.closesAt);

  for (const resident of wanting(residents, 'polls')) {
    await notifyAbout(
      notifier,
      resident,
      `Собрание собственников: ${poll.title}\n\n${poll.question}\n\n` +
        `${POLL_RULES[poll.kind].title}. Голосование открыто до ${closes}.`,
      { section: 'polls', mutable: 'polls' },
    );
  }

  return poll;
};

export interface PollView {
  poll: Poll;
  result: PollResult;
  open: boolean;
  /** Сколько площади не хватает до кворума. */
  areaToQuorum: number;
  /** Как проголосовало помещение спрашивающего, если оно голосовало. */
  myChoice?: VoteChoice;
}

const describePoll = async (deps: AppDeps, poll: Poll, resident: Resident): Promise<PollView> => {
  const apartments = await deps.repository.listApartments(poll.buildingId);
  const votes = await deps.repository.listVotes(poll.id);
  const result = countVotes(poll, apartments, votes);
  const own = new Set(apartmentsOf(resident));
  const mine = votes.find((vote) => own.has(vote.apartmentId));

  return {
    poll,
    result,
    open: isOpen(poll, deps.now()),
    areaToQuorum: areaToQuorum(poll, result),
    ...(mine ? { myChoice: mine.choice } : {}),
  };
};

/** За сколько дней до конца собрания напоминаем тем, кто ещё не голосовал. */
export const POLL_REMINDER_DAYS = 2;

/** Напоминание о собрании тем, кто ещё не голосовал. */
export const remindAboutPolls = async (deps: AppDeps, buildingId: string): Promise<Resident[]> => {
  const now = deps.now();
  const soon = POLL_REMINDER_DAYS * 24 * 3600_000;
  const notifier = deps.notifier ?? noopNotifier;
  const reminded: Resident[] = [];

  for (const poll of await deps.repository.listPolls(buildingId)) {
    const left = poll.closesAt.getTime() - now.getTime();

    if (!isOpen(poll, now) || left > soon || left <= 0) continue;

    const apartments = await deps.repository.listApartments(buildingId);
    const voted = new Set((await deps.repository.listVotes(poll.id)).map((vote) => vote.apartmentId));
    const silent = apartments.filter((apartment) => !voted.has(apartment.id));
    const result = countVotes(poll, apartments, await deps.repository.listVotes(poll.id));

    if (silent.length === 0 || result.quorum) continue;

    const people = wanting(
      await deps.repository.listResidentsByApartments(silent.map((apartment) => apartment.id)),
      'polls',
    );

    const closes = formatDay(poll.closesAt, await zoneOf(deps, buildingId));

    for (const resident of people) {
      const house = await houseHint(deps, resident, buildingId);

      await notifyAbout(
        notifier,
        resident,
        `${house ? `${house}\n` : ''}Собрание «${poll.title}» закрывается ${closes}.\n` +
          `Не хватает ${formatArea(areaToQuorum(poll, result))} м² до кворума, без него решения не будет.`,
        { section: 'polls', mutable: 'polls' },
      );

      reminded.push(resident);
    }
  }

  return reminded;
};

/** Собрания дома: сначала идущие, потом завершённые. */
export const listPollsFor = async (deps: AppDeps, resident: Resident): Promise<PollView[]> => {
  const views: PollView[] = [];

  for (const buildingId of await housesOf(deps, resident)) {
    for (const poll of await deps.repository.listPolls(buildingId)) {
      views.push(await describePoll(deps, poll, resident));
    }
  }

  return views.sort(
    (left, right) => Number(right.open) - Number(left.open) || right.poll.opensAt.getTime() - left.poll.opensAt.getTime(),
  );
};

export interface VoteCommand {
  resident: Resident;
  pollId: string;
  choice: VoteChoice;
}

/** Принимает голос собственника. */
export const vote = async (deps: AppDeps, command: VoteCommand): Promise<PollView> => {
  const poll = await deps.repository.findPoll(command.pollId);

  if (!poll) throw new DomainError('poll_not_found', 'Голосование не найдено');

  if (poll.closedAt) throw new DomainError('poll_closed', 'Итоги подведены, голос принять нельзя');

  const apartment = await apartmentIn(deps, command.resident, poll.buildingId);

  if (!apartment) {
    throw new DomainError(
      'apartment_not_bound',
      'Голосуют собственники помещений этого дома, сначала привяжите квартиру по коду из квитанции',
    );
  }

  await deps.repository.saveVote(
    castVote({
      poll,
      apartment,
      residentId: command.resident.id,
      choice: command.choice,
      at: deps.now(),
    }),
  );

  return describePoll(deps, poll, command.resident);
};

const CHOICES: Record<VoteChoice, string> = { for: 'за', against: 'против', abstain: 'воздержался' };

/** Те же ответы в протоколе, множественным числом. */
const TALLY: Record<VoteChoice, string> = { for: 'За', against: 'Против', abstain: 'Воздержались' };

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** Площадь для человека: один знак после запятой, без хвоста из нулей. */
export const formatArea = (area: number): string => String(Math.round(area * 10) / 10);

/** Итоги словами для чата и протокола. */
export interface PollTextOptions {
  /** Показывать ли собственный голос: в общем чате его видели бы соседи. */
  personal?: boolean;
}

/** Сколько «за» нужно по правилу вопроса и сколько уже есть. */
const needed = (kind: PollKind, support: number): string => {
  const rule = POLL_RULES[kind];
  const base = rule.base === 'participants' ? 'от проголосовавших' : 'от всех собственников';
  const bar = `${rule.strict ? 'больше ' : ''}${percent(rule.threshold)}`;

  return `Нужно ${bar} ${base}, набрано ${percent(support)}.`;
};

export const formatPollResult = (view: PollView, options: PollTextOptions = {}): string => {
  const { poll, result } = view;
  const lines = [
    `${poll.title}`,
    poll.question,
    '',
    `${POLL_RULES[poll.kind].title}. Участие: ${percent(result.turnout)} площади дома.`,
  ];

  if (!result.quorum) {
    lines.push(`Кворума пока нет: не хватает ${formatArea(view.areaToQuorum)} м².`);
  }

  lines.push(
    '',
    `За: ${percent(result.shares.for)}`,
    `Против: ${percent(result.shares.against)}`,
    `Воздержались: ${percent(result.shares.abstain)}`,
    needed(poll.kind, result.support),
  );

  if (view.myChoice && options.personal !== false) lines.push('', `Ваш голос: ${CHOICES[view.myChoice]}.`);

  if (!view.open) {
    lines.push('', result.passed ? 'Решение принято.' : 'Решение не принято.');
  }

  return lines.join('\n');
};

export const choiceTitle = (choice: VoteChoice): string => CHOICES[choice];

export interface ClosedPoll {
  poll: Poll;
  result: PollResult;
  protocol: string;
}

/** Выбранный старший вступает в полномочия в день подведения итогов. */
const applyElderResult = async (deps: AppDeps, poll: Poll, result: PollResult): Promise<void> => {
  if (!poll.elder || !result.passed) return;

  const eldership = await deps.repository.saveEldership(electElder(poll, poll.elder, deps.now()));
  const elder = await deps.repository.findResident(poll.elder.residentId);
  const notifier = deps.notifier ?? noopNotifier;

  await notifyResident(
    notifier,
    elder,
    `Соседи выбрали вас старшим по подъезду ${eldership.entrance}.\n` +
      'Заявки по общему имуществу подъезда теперь ваши: их видно вам, и работу по ним принимаете вы.',
  );

  for (const person of await deps.repository.listStaff(poll.buildingId)) {
    await notifyResident(
      notifier,
      person,
      `Старший по подъезду ${eldership.entrance}: ${elder?.displayName ?? 'выбран'}.`,
    );
  }
};

/** Подводит итоги собрания. */
export const closePoll = async (deps: AppDeps, poll: Poll): Promise<ClosedPoll> => {
  const apartments = await deps.repository.listApartments(poll.buildingId);
  const votes = await deps.repository.listVotes(poll.id);
  const result = countVotes(poll, apartments, votes);
  const closed = await deps.repository.savePoll({ ...poll, closedAt: deps.now() });
  const protocol = await formatProtocol(deps, closed, result);
  const residents = await deps.repository.listResidentsByApartments(apartments.map((apartment) => apartment.id));
  const notifier = deps.notifier ?? noopNotifier;

  await applyElderResult(deps, closed, result);

  const outcome = !result.quorum
    ? 'Кворума нет, собрание не состоялось.'
    : result.passed
      ? 'Решение принято.'
      : 'Решение не принято.';

  for (const resident of wanting(residents, 'polls')) {
    await notifyAbout(
      notifier,
      resident,
      `Собрание завершено: ${poll.title}\n${outcome}\nУчастие: ${percent(result.turnout)}, за: ${percent(
        result.shares.for,
      )} площади дома.`,
      { section: 'polls', mutable: 'polls' },
    );
  }

  return { poll: closed, result, protocol };
};

/** Собрания, у которых вышел срок, по всем домам компании. */
export const closeDuePolls = async (deps: AppDeps): Promise<ClosedPoll[]> => {
  const now = deps.now();
  const closed: ClosedPoll[] = [];

  for (const building of await deps.repository.listBuildings()) {
    for (const poll of await deps.repository.listPolls(building.id)) {
      if (needsClosing(poll, now)) closed.push(await closePoll(deps, poll));
    }
  }

  return closed;
};

/** Протокол завершённого собрания: тот же документ, что и в день закрытия. @throws {DomainError} */
export const pollProtocol = async (deps: AppDeps, viewer: Resident, pollId: string): Promise<string> => {
  const poll = await deps.repository.findPoll(pollId);

  if (!poll) throw new DomainError('poll_not_found', 'Голосование не найдено');

  await assertServes(deps, viewer, poll.buildingId);

  if (!poll.closedAt) throw new DomainError('poll_open', 'Собрание ещё идёт, протокол составляют по итогам');

  const apartments = await deps.repository.listApartments(poll.buildingId);
  const votes = await deps.repository.listVotes(poll.id);

  return formatProtocol(deps, poll, countVotes(poll, apartments, votes));
};

/** Протокол общего собрания. */
export const formatProtocol = async (deps: AppDeps, poll: Poll, result: PollResult): Promise<string> => {
  const timeZone = await zoneOf(deps, poll.buildingId);
  const building = await deps.repository.findBuilding(poll.buildingId);
  const initiator = poll.startedBy ? await deps.repository.findResident(poll.startedBy) : undefined;
  const rule = POLL_RULES[poll.kind];
  const area = (share: number): string => formatArea(share * result.totalArea);
  const line = (choice: VoteChoice): string =>
    `${TALLY[choice]}: ${area(result.shares[choice])} м² (${percent(result.shares[choice])})`;

  const lines = ['Протокол общего собрания собственников'];

  if (building?.address) lines.push(building.address);
  if (building?.managementCompany) lines.push(`Управляющая компания: ${building.managementCompany}`);

  lines.push(
    'Форма: заочное голосование',
    ...(initiator ? [`Инициатор: ${initiator.displayName}`] : []),
    `Голосование: с ${formatDate(poll.opensAt, timeZone)} по ${formatDate(poll.closesAt, timeZone)}`,
    '',
    'Вопрос повестки дня',
    poll.title,
    poll.question,
    '',
    'Подсчёт голосов',
    `Общая площадь помещений: ${formatArea(result.totalArea)} м²`,
    `Приняли участие: ${formatArea(result.votedArea)} м² (${percent(result.turnout)})`,
    result.quorum
      ? `Кворум: есть, требуется более ${percent(rule.quorum)}`
      : `Кворум: нет, не хватает ${formatArea(areaToQuorum(poll, result))} м²`,
    '',
    line('for'),
    line('against'),
    line('abstain'),
    '',
    'Решение',
    `${rule.title}: ${percent(result.support)} ${
      rule.base === 'participants' ? 'от проголосовавших' : 'от всех собственников'
    } при пороге ${rule.strict ? 'более' : 'не менее'} ${percent(rule.threshold)}.`,
    result.quorum
      ? result.passed
        ? 'Решение принято.'
        : 'Решение не принято.'
      : 'Собрание не состоялось: кворума нет.',
  );

  if (poll.closedAt) lines.push('', `Протокол сформирован ${formatDate(poll.closedAt, timeZone)}`);

  return lines.join('\n');
};
