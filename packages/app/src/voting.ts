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
  pollRuleKey,
  voteChoiceKey,
  type Apartment,
  type Poll,
  type PollKind,
  type PollMode,
  type PollResult,
  type VoteChoice,
} from '@domovoy/domain';

import { numberIn, type Translate } from '@domovoy/i18n';

import { apartmentIn, apartmentsOf } from './apartments.js';
import { recordAction } from './audit.js';
import { assertServes, houseHintFor, housesOf, type HouseHint } from './buildings.js';
import { speak, speakDefault } from './language.js';
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

  for (const resident of wanting(residents, 'polls')) {
    const t = speak(resident);
    const closes = formatDay(poll.closesAt, zone, t);
    const opens = formatDay(poll.opensAt, zone, t);

    await notifyAbout(
      notifier,
      resident,
      t('app.poll.started', {
        вид: t(mode === 'meeting' ? 'app.poll.meeting' : 'app.poll.survey'),
        название: poll.title,
        вопрос: poll.question,
        порядок:
          mode === 'meeting'
            ? t('app.poll.orderMeeting', { правило: t(pollRuleKey(poll.kind)), от: opens, до: closes })
            : t('app.poll.orderSurvey', { до: closes }),
      }),
      // Бюллетень стоит под самим уведомлением: голосовать можно, не открывая приложение.
      { section: 'polls', mutable: 'polls', voteAbout: poll.id },
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

    for (const resident of people) {
      const house = await hintOf(resident);
      const t = speak(resident);
      const closes = formatDay(poll.closesAt, zone, t);

      await notifyAbout(
        notifier,
        resident,
        (house ? `${house}\n` : '') +
          t('app.poll.remind', {
            название: poll.title,
            до: closes,
            нехватка:
              result.areasMissing > 0
                ? t('app.poll.remindFew')
                : t('app.poll.remindArea', { площадь: formatArea(areaToQuorum(poll, result), t) }),
          }),
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
    const replaced = await deps.repository.findResident(before.residentId);
    const t = speak(replaced);

    await notifyResident(
      notifier,
      replaced,
      t('app.poll.voteReplaced', {
        квартира: apartment.number,
        название: poll.title,
        кто: command.resident.displayName,
        ответ: t(`app.poll.choice.${command.choice}`),
      }),
    );
  }

  return describePoll(deps, poll, command.resident);
};

/** Порядок ответов один и в итогах, и в протоколе. */
const CHOICES: readonly VoteChoice[] = ['for', 'against', 'abstain'];

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** Площадь для человека: один знак после запятой, разделитель по языку. */
export const formatArea = (area: number, t: Translate = speakDefault()): string =>
  numberIn(t, Math.round(area * 10) / 10, { maximumFractionDigits: 1 });

/** Итоги словами для чата и протокола. */
export interface PollTextOptions {
  /** Показывать ли собственный голос: в общем чате его видели бы соседи. */
  personal?: boolean;
  /** Язык читающего. Общий чат дома читают все соседи, там итоги остаются русскими. */
  t?: Translate;
}

/** Сколько «за» нужно по правилу вопроса и сколько уже есть. */
const needed = (t: Translate, kind: PollKind, support: number): string => {
  const rule = POLL_RULES[kind];
  const порог = t(rule.strict ? 'app.poll.threshold.strict' : 'app.poll.threshold.plain', {
    доля: percent(rule.threshold),
  });

  return t('app.poll.result.needed', {
    порог,
    база: t(`app.poll.base.${rule.base}`),
    набрано: percent(support),
  });
};

/** Доли ответов столбиком: «За: 60%». */
const shareLines = (t: Translate, result: PollResult): string[] =>
  CHOICES.map((choice) =>
    t('app.poll.result.share', { ответ: t(`app.poll.tally.${choice}`), доля: percent(result.shares[choice]) }),
  );

export const formatPollResult = (view: PollView, options: PollTextOptions = {}): string => {
  const { poll, result } = view;
  const survey = poll.mode === 'survey';
  const t = options.t ?? speakDefault();

  const lines = [
    `${poll.title}`,
    poll.question,
    '',
    survey
      ? t('app.poll.result.survey', { участие: percent(result.turnout) })
      : t('app.poll.result.meeting', { правило: t(pollRuleKey(poll.kind)), участие: percent(result.turnout) }),
  ];

  if (!result.quorum && !survey) {
    // «Кворум» знают не все: то же самое говорится обычными словами.
    lines.push(t('app.poll.result.quorum', { площадь: formatArea(view.areaToQuorum, t) }));
  }

  lines.push('', ...shareLines(t, result), needed(t, poll.kind, result.support));

  if (view.myChoice && options.personal !== false) {
    const ответ = t(voteChoiceKey(view.myChoice));

    lines.push(
      '',
      view.votedBy ? t('app.poll.result.mineBy', { ответ, кто: view.votedBy }) : t('app.poll.result.mine', { ответ }),
    );
  }

  if (!view.open) {
    lines.push('', t(result.passed ? 'app.poll.passed' : 'app.poll.failed'));
  }

  return lines.join('\n');
};

export const choiceTitle = (t: Translate, choice: VoteChoice): string => t(voteChoiceKey(choice));

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

  await notifyResident(notifier, elder, speak(elder)('app.poll.elder', { подъезд: eldership.entrance }));

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

  const outcomeKey = !result.quorum ? 'app.poll.noQuorum' : result.passed ? 'app.poll.passed' : 'app.poll.failed';

  for (const resident of wanting(residents, 'polls')) {
    const t = speak(resident);

    await notifyAbout(
      notifier,
      resident,
      t('app.poll.closed', {
        название: poll.title,
        итог: t(outcomeKey),
        участие: percent(result.turnout),
        за: percent(result.shares.for),
      }),
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

  return formatProtocol(deps, poll, countVotes(poll, apartments, votes), speak(viewer));
};

/** Шапка протокола: чей документ, по какому дому и кто его вёл. */
const head = (t: Translate, poll: Poll, survey: boolean, building?: Building, initiator?: string): string[] => [
  t(survey ? 'app.protocol.surveyTitle' : 'app.protocol.title'),
  ...(poll.protocolId ? [t('app.protocol.number', { номер: poll.protocolId })] : []),
  ...(building?.address ? [building.address] : []),
  ...(building?.managementCompany
    ? [t('app.protocol.company', { название: building.managementCompany })]
    : []),
  t(survey ? 'app.protocol.surveyForm' : 'app.protocol.form'),
  ...(poll.noticeId ? [t('app.protocol.notice', { номер: poll.noticeId })] : []),
  ...(initiator ? [t(survey ? 'app.protocol.surveyBy' : 'app.protocol.initiator', { кто: initiator })] : []),
  ...(survey || !initiator ? [] : [t('app.protocol.administrator', { кто: initiator })]),
];

/** Строка о кворуме: есть, нет или не считается без площадей. */
const quorumLine = (t: Translate, poll: Poll, result: PollResult): string => {
  if (result.quorum) return t('app.protocol.quorumYes', { порог: percent(POLL_RULES[poll.kind].quorum) });

  return result.areasMissing > 0
    ? t('app.protocol.quorumUnknown', { сколько: result.areasMissing })
    : t('app.protocol.quorumNo', { площадь: formatArea(areaToQuorum(poll, result)) });
};

/**
 * Протокол общего собрания. Без языка протокол остаётся русским: таким он
 * уходит в систему и в надзор, а жилец читает его на своём.
 */
export const formatProtocol = async (
  deps: AppDeps,
  poll: Poll,
  result: PollResult,
  t: Translate = speakDefault(),
): Promise<string> => {
  const timeZone = await zoneOf(deps, poll.buildingId);
  const building = await deps.repository.findBuilding(poll.buildingId);
  const initiator = poll.startedBy ? await deps.repository.findResident(poll.startedBy) : undefined;
  const rule = POLL_RULES[poll.kind];
  const survey = poll.mode === 'survey';

  const line = (choice: VoteChoice): string =>
    t('app.protocol.line', {
      ответ: t(`app.poll.tally.${choice}`),
      площадь: formatArea(result.shares[choice] * result.totalArea),
      доля: percent(result.shares[choice]),
    });

  const lines = [
    ...head(t, poll, survey, building, initiator?.displayName),
    t('app.protocol.voting', { от: formatDate(poll.opensAt, timeZone), до: formatDate(poll.closesAt, timeZone) }),
    '',
    t('app.protocol.agenda'),
    poll.title,
    poll.question,
    '',
    t('app.protocol.counting'),
    t('app.protocol.totalArea', { площадь: formatArea(result.totalArea) }),
    t('app.protocol.turnout', { площадь: formatArea(result.votedArea), доля: percent(result.turnout) }),
    quorumLine(t, poll, result),
    '',
    ...CHOICES.map(line),
    '',
    t('app.protocol.decision'),
    t('app.protocol.rule', {
      правило: t(pollRuleKey(poll.kind)),
      набрано: percent(result.support),
      база: t(`app.poll.base.${rule.base}`),
      порог: t(rule.strict ? 'app.protocol.moreThan' : 'app.protocol.atLeast', { доля: percent(rule.threshold) }),
    }),
    result.quorum ? t(result.passed ? 'app.poll.passed' : 'app.poll.failed') : t('app.protocol.noQuorum'),
  ];

  if (poll.closedAt) {
    const дата = formatDate(poll.closedAt, timeZone);

    lines.push('', t(survey ? 'app.protocol.surveyFormed' : 'app.protocol.formed', { дата }));
  }

  if (!survey) lines.push('', t('app.protocol.attachments'), t('app.protocol.originals'));

  return lines.join('\n');
};
