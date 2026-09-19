import {
  DomainError,
  POLL_RULES,
  PROTOCOL_TO_INSPECTION_DAYS,
  PROTOCOL_TO_MANAGEMENT_DAYS,
  meetingSchedule,
  areaToQuorum,
  castVote,
  countVotes,
  electElder,
  formatDate,
  formatDay,
  isOpen,
  needsClosing,
  type Apartment,
  type Poll,
  type PollKind,
  type PollMode,
  type PollResult,
  type VoteChoice,
} from '@domovoy/domain';

import { apartmentIn, apartmentsOf } from './apartments.js';
import { recordAction } from './audit.js';
import { assertServes, houseHintFor, housesOf, type HouseHint } from './buildings.js';
import { wanting } from './notices.js';
import { noopNotifier, notifyAbout, notifyResident } from './notifier.js';
import { zoneOf } from './zone.js';
import type { Building, Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

const CAN_START: Resident['role'][] = ['manager', 'dispatcher'];

export interface StartPollCommand {
  resident: Resident;
  kind: PollKind;
  title: string;
  question: string;
  /** Сколько дней идёт голосование. */
  days: number;
  /**
   * Собрание собственников или опрос жильцов. У собрания сроки закона: десять
   * дней на сообщение и от семи до шестидесяти дней голосования. Опрос идёт
   * сразу и юридической силы не имеет.
   */
  mode?: PollMode;
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
  const apartments = await deps.repository.listApartments(buildingId);

  if (apartments.every((apartment) => !apartment.area)) {
    throw new DomainError(
      'areas_missing',
      'У дома не внесены площади помещений, а голос считается их долей: без площадей собрание не провести',
    );
  }

  const now = deps.now();
  const mode: PollMode = command.mode ?? 'meeting';

  // Сроки закона считаются там, где собрание имеет силу: в системе заочного
  // голосования. Жильцы получают сообщение за десять дней до начала, само
  // голосование идёт от недели до двух месяцев. Опрос управляющей организации
  // и дом без подключённой системы обходятся без отсрочки: решения там нет.
  const plan =
    mode === 'meeting' && deps.meetings ? meetingSchedule({ announcedAt: now, days: command.days }) : undefined;
  const opensAt = plan?.votingFrom ?? now;
  const closesAt = plan?.votingTo ?? new Date(opensAt.getTime() + command.days * 24 * 3600_000);

  const created = await deps.repository.savePoll({
    id: deps.createId(),
    buildingId,
    kind: command.kind,
    mode,
    title: command.title,
    question: command.question,
    opensAt,
    closesAt,
    startedBy: command.resident.id,
  });

  // Сообщение о собрании размещается в системе: заочное голосование имеет силу
  // только там. Без подключения продукт остаётся подготовкой к собранию.
  const house = await deps.repository.findBuilding(buildingId);

  const notice =
    mode === 'meeting' && deps.meetings
      ? await deps.meetings
          .publishNotice({
            poll: created,
            administrator: command.resident.displayName,
            votingFrom: opensAt,
            votingTo: closesAt,
            ...(house ? { building: house } : {}),
          })
          .catch(() => undefined)
      : undefined;

  const poll = notice ? await deps.repository.savePoll({ ...created, noticeId: notice.noticeId }) : created;

  await recordAction(deps, { actor: command.resident, action: 'poll_started', subject: poll.title, buildingId });

  const residents = await deps.repository.listResidentsByApartments(apartments.map((apartment) => apartment.id));
  const notifier = deps.notifier ?? noopNotifier;
  const zone = await zoneOf(deps, buildingId);
  const closes = formatDay(poll.closesAt, zone);
  const opens = formatDay(poll.opensAt, zone);

  for (const resident of wanting(residents, 'polls')) {
    await notifyAbout(
      notifier,
      resident,
      `${mode === 'meeting' ? 'Собрание собственников' : 'Опрос жильцов'}: ${poll.title}\n\n${poll.question}\n\n` +
        (mode === 'meeting'
          ? `${POLL_RULES[poll.kind].title}. Голосование идёт с ${opens} по ${closes}.`
          : `Ответить можно до ${closes}. Опрос не заменяет собрание собственников.`),
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
  /** Когда голос подан. */
  votedAt?: Date;
  /** Кто из живущих в квартире подал этот голос, если это не спрашивающий. */
  votedBy?: string;
}

/** Квартиры дома передаются готовыми там, где их уже прочитали. */
const describePoll = async (
  deps: AppDeps,
  poll: Poll,
  resident: Resident,
  known?: readonly Apartment[],
): Promise<PollView> => {
  const apartments = known ?? (await deps.repository.listApartments(poll.buildingId));
  const votes = await deps.repository.listVotes(poll.id);
  const result = countVotes(poll, apartments, votes);
  const own = new Set(apartmentsOf(resident));
  // Голос у помещения один, а живущих в нём несколько: берётся последний,
  // и человек должен видеть, что он заменит голос соседа, а не добавит свой.
  const ours = votes
    .filter((vote) => own.has(vote.apartmentId))
    .sort((left, right) => left.at.getTime() - right.at.getTime());

  const mine = ours.at(-1);
  const byOther = mine && mine.residentId !== resident.id ? await deps.repository.findResident(mine.residentId) : undefined;

  return {
    poll,
    result,
    open: isOpen(poll, deps.now()),
    areaToQuorum: areaToQuorum(poll, result),
    ...(mine ? { myChoice: mine.choice, votedAt: mine.at } : {}),
    ...(byOther ? { votedBy: byOther.displayName } : {}),
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
  // Квартиры, пояс и подсказка с адресом читаются, только когда есть кому
  // напоминать, и одни на все собрания дома.
  let known: { apartments: Apartment[]; zone: string; hintOf: HouseHint } | undefined;

  for (const poll of await deps.repository.listPolls(buildingId)) {
    const left = poll.closesAt.getTime() - now.getTime();

    if (!isOpen(poll, now) || left > soon || left <= 0) continue;

    if (!known) {
      const apartments = await deps.repository.listApartments(buildingId);

      known = {
        apartments,
        zone: await zoneOf(deps, buildingId),
        hintOf: houseHintFor(deps, buildingId, apartments),
      };
    }

    const { apartments, zone, hintOf } = known;
    const votes = await deps.repository.listVotes(poll.id);
    const voted = new Set(votes.map((vote) => vote.apartmentId));
    const silent = apartments.filter((apartment) => !voted.has(apartment.id));
    const result = countVotes(poll, apartments, votes);

    if (silent.length === 0 || result.quorum) continue;

    const people = wanting(
      await deps.repository.listResidentsByApartments(silent.map((apartment) => apartment.id)),
      'polls',
    );

    const closes = formatDay(poll.closesAt, zone);

    for (const resident of people) {
      const house = await hintOf(resident);

      await notifyAbout(
        notifier,
        resident,
        `${house ? `${house}\n` : ''}Собрание «${poll.title}» закрывается ${closes}.\n` +
          (result.areasMissing > 0
            ? 'Проголосовали не все: пока голосов мало, решение не примут.'
            : `Проголосовали собственники не всей площади: не хватает ${formatArea(
                areaToQuorum(poll, result),
              )} м². Пока голосов мало, решение не примут.`),
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
    const polls = await deps.repository.listPolls(buildingId);

    if (polls.length === 0) continue;

    const apartments = await deps.repository.listApartments(buildingId);

    for (const poll of polls) {
      views.push(await describePoll(deps, poll, resident, apartments));
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

  // Голос у помещения один: новый заменяет прежний, и тот, чей голос заменили,
  // узнаёт об этом. Иначе жильцы одной квартиры молча перебивают друг друга.
  const before = (await deps.repository.listVotes(poll.id))
    .filter((item) => item.apartmentId === apartment.id)
    .sort((left, right) => left.at.getTime() - right.at.getTime())
    .at(-1);

  await deps.repository.saveVote(
    castVote({
      poll,
      apartment,
      residentId: command.resident.id,
      choice: command.choice,
      at: deps.now(),
    }),
  );

  // Решение собственника уходит в систему: там заочное голосование имеет силу.
  if (poll.mode !== 'survey' && deps.meetings) {
    await deps.meetings
      .submitDecision({ poll, apartmentId: apartment.id, choice: command.choice, at: deps.now() })
      .catch(() => undefined);
  }

  if (before && before.residentId !== command.resident.id) {
    const notifier = deps.notifier ?? noopNotifier;

    await notifyResident(
      notifier,
      await deps.repository.findResident(before.residentId),
      `Голос квартиры ${apartment.number} по собранию «${poll.title}» изменил ${command.resident.displayName}: ` +
        `${CHOICES[command.choice]}.\nУ помещения один голос, считается последний.`,
    );
  }

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
  const survey = poll.mode === 'survey';

  const lines = [
    `${poll.title}`,
    poll.question,
    '',
    survey
      ? `Опрос жильцов, решением собрания не является. Ответили: ${percent(result.turnout)} площади дома.`
      : `${POLL_RULES[poll.kind].title}. Участие: ${percent(result.turnout)} площади дома.`,
  ];

  if (!result.quorum && !survey) {
    // «Кворум» знают не все: то же самое говорится обычными словами.
    lines.push(
      `Проголосовали пока не все: чтобы решение состоялось, нужны голоса собственников ещё ${formatArea(
        view.areaToQuorum,
      )} м² квартир.`,
    );
  }

  lines.push(
    '',
    `За: ${percent(result.shares.for)}`,
    `Против: ${percent(result.shares.against)}`,
    `Воздержались: ${percent(result.shares.abstain)}`,
    needed(poll.kind, result.support),
  );

  if (view.myChoice && options.personal !== false) {
    const whose = view.votedBy ? ` (подал ${view.votedBy}, у квартиры один голос)` : '';

    lines.push('', `Голос квартиры: ${CHOICES[view.myChoice]}${whose}.`);
  }

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
  const closedAt = deps.now();
  const house = await deps.repository.findBuilding(poll.buildingId);
  const saved = await deps.repository.savePoll({ ...poll, closedAt });
  const protocol = await formatProtocol(deps, saved, result);

  // Протокол размещается в системе, а подлинники уходят в надзор: без этого
  // решение собрания остаётся у организации и силы не имеет.
  const published =
    saved.mode !== 'survey' && deps.meetings
      ? await deps.meetings
          .publishProtocol({
            poll: saved,
            text: protocol,
            toInspectionBy: new Date(
              closedAt.getTime() + (PROTOCOL_TO_MANAGEMENT_DAYS + PROTOCOL_TO_INSPECTION_DAYS) * 24 * 3600_000,
            ),
            ...(house ? { building: house } : {}),
          })
          .catch(() => undefined)
      : undefined;

  const closed = published ? await deps.repository.savePoll({ ...saved, protocolId: published.protocolId }) : saved;
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

/** Шапка протокола: чей документ, по какому дому и кто его вёл. */
const head = (poll: Poll, survey: boolean, building?: Building, initiator?: string): string[] => [
  survey ? 'Итоги опроса жильцов' : 'Протокол общего собрания собственников',
  ...(poll.protocolId ? [`№ ${poll.protocolId}`] : []),
  ...(building?.address ? [building.address] : []),
  ...(building?.managementCompany ? [`Управляющая компания: ${building.managementCompany}`] : []),
  survey
    ? 'Опрос управляющей организации: решением общего собрания не является'
    : 'Форма: заочное голосование с использованием системы',
  ...(poll.noticeId ? [`Сообщение о собрании: ${poll.noticeId}`] : []),
  ...(initiator ? [`${survey ? 'Провёл' : 'Инициатор'}: ${initiator}`] : []),
  ...(survey || !initiator ? [] : [`Администратор собрания: ${initiator}`]),
];

/** Протокол общего собрания. */
export const formatProtocol = async (deps: AppDeps, poll: Poll, result: PollResult): Promise<string> => {
  const timeZone = await zoneOf(deps, poll.buildingId);
  const building = await deps.repository.findBuilding(poll.buildingId);
  const initiator = poll.startedBy ? await deps.repository.findResident(poll.startedBy) : undefined;
  const rule = POLL_RULES[poll.kind];
  const area = (share: number): string => formatArea(share * result.totalArea);
  const line = (choice: VoteChoice): string =>
    `${TALLY[choice]}: ${area(result.shares[choice])} м² (${percent(result.shares[choice])})`;

  const survey = poll.mode === 'survey';

  const lines = [
    ...head(poll, survey, building, initiator?.displayName),
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
      : result.areasMissing > 0
        ? `Кворум: не подтверждается, у ${result.areasMissing} помещений не внесена площадь`
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
  ];

  if (poll.closedAt) {
    lines.push('', `${survey ? 'Итоги подведены' : 'Протокол сформирован'} ${formatDate(poll.closedAt, timeZone)}`);
  }

  if (!survey) {
    lines.push(
      '',
      'Приложения: реестр собственников, решения собственников, сообщение о проведении собрания.',
      'Подлинники решений и протокола передаются в управляющую организацию и далее в орган ' +
        'государственного жилищного надзора.',
    );
  }

  return lines.join('\n');
};
