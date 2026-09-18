import { DomainError, type Apartment } from './types.js';

/** Голосование собственников. */
export type PollKind = 'simple' | 'qualified';

export interface PollRule {
  title: string;
  /** Какая доля голосов нужна для принятия решения. */
  threshold: number;
  /** От чего считается порог. */
  base: 'participants' | 'building';
  /** Порог берётся строго больше (большинство) или не меньше (две трети). */
  strict: boolean;
  /** Какая доля собственников должна поучаствовать, чтобы собрание состоялось. */
  quorum: number;
}

/** Пороги по видам вопросов. */
export const POLL_RULES: Readonly<Record<PollKind, PollRule>> = {
  simple: { title: 'Простое большинство', threshold: 0.5, base: 'participants', strict: true, quorum: 0.5 },
  qualified: {
    title: 'Квалифицированное большинство',
    threshold: 2 / 3,
    base: 'building',
    strict: false,
    quorum: 0.5,
  },
};

export type VoteChoice = 'for' | 'against' | 'abstain';

/** Выборы старшего по подъезду: собрание решает, кто им станет. */
export interface ElderCandidate {
  entrance: number;
  residentId: string;
}

/**
 * Что это: собрание собственников по закону или опрос жильцов для управляющей
 * организации. У собрания есть сроки, кворум и протокол, у опроса, только
 * мнение: юридической силы он не имеет и этим отличается прямо в интерфейсе.
 */
export type PollMode = 'meeting' | 'survey';

export interface Poll {
  id: string;
  buildingId: string;
  kind: PollKind;
  /** Собрание или опрос. Пусто означает собрание: так было до появления опросов. */
  mode?: PollMode;
  /** Номер сообщения о собрании в системе, если оно туда ушло. */
  noticeId?: string;
  /** Номер протокола в системе. */
  protocolId?: string;
  title: string;
  /** Формулировка вопроса: её увидят в бюллетене и в протоколе. */
  question: string;
  opensAt: Date;
  closesAt: Date;
  /** Кто объявил собрание: инициатор указывается в протоколе. */
  startedBy?: string;
  /** Когда подведены итоги. Пока пусто, протокола нет. */
  closedAt?: Date;
  /** Собрание выбирает старшего: принятое решение сразу даёт ему полномочия. */
  elder?: ElderCandidate;
}

/** Срок полномочий старшего: два года, как у совета дома (ЖК РФ, ст. 161.1). */
export const ELDER_TERM_YEARS = 2;

export interface Eldership {
  buildingId: string;
  entrance: number;
  residentId: string;
  since: Date;
  until: Date;
}

/** Кто сейчас старший по подъезду: истёкшие полномочия не считаются. */
export const elderNow = (
  elderships: readonly Eldership[],
  entrance: number,
  at: Date,
): Eldership | undefined =>
  elderships
    .filter(
      (item) =>
        item.entrance === entrance &&
        item.since.getTime() <= at.getTime() &&
        item.until.getTime() > at.getTime(),
    )
    .sort((left, right) => right.since.getTime() - left.since.getTime())[0];

/** Полномочия, начавшиеся сегодня. */
export const electElder = (poll: Poll, candidate: ElderCandidate, at: Date): Eldership => {
  const until = new Date(at.getTime());

  until.setUTCFullYear(until.getUTCFullYear() + ELDER_TERM_YEARS);

  return { buildingId: poll.buildingId, entrance: candidate.entrance, residentId: candidate.residentId, since: at, until };
};

export interface Vote {
  pollId: string;
  apartmentId: string;
  choice: VoteChoice;
  at: Date;
  /** Кто проголосовал: собственник помещения. */
  residentId: string;
}

export const isOpen = (poll: Poll, at: Date): boolean =>
  !poll.closedAt && at.getTime() >= poll.opensAt.getTime() && at.getTime() <= poll.closesAt.getTime();

/** Срок вышел, а итогов нет. */
export const needsClosing = (poll: Poll, at: Date): boolean =>
  !poll.closedAt && at.getTime() > poll.closesAt.getTime();

export interface CastVoteInput {
  poll: Poll;
  apartment: Apartment;
  residentId: string;
  choice: VoteChoice;
  at: Date;
}

/** Принимает голос. @throws {DomainError} */
export const castVote = (input: CastVoteInput): Vote => {
  if (input.poll.closedAt) {
    throw new DomainError('poll_closed', 'Итоги подведены, голос принять нельзя');
  }

  if (input.at.getTime() < input.poll.opensAt.getTime()) {
    throw new DomainError('poll_not_open', 'Голосование ещё не началось');
  }

  if (input.at.getTime() > input.poll.closesAt.getTime()) {
    throw new DomainError('poll_closed', 'Голосование завершено, голос принять нельзя');
  }

  if (input.apartment.buildingId !== input.poll.buildingId) {
    throw new DomainError('forbidden', 'Голосуют собственники помещений этого дома');
  }

  return {
    pollId: input.poll.id,
    apartmentId: input.apartment.id,
    choice: input.choice,
    at: input.at,
    residentId: input.residentId,
  };
};

export interface PollResult {
  /** Сумма площадей помещений дома: знаменатель во всех долях. */
  totalArea: number;
  /** Площадь проголосовавших. */
  votedArea: number;
  /** Доля участия, 0…1. */
  turnout: number;
  quorum: boolean;
  /** Доли «за», «против» и «воздержался» от общей площади дома. */
  shares: Record<VoteChoice, number>;
  /** Доля «за», посчитанная по правилу этого вопроса. */
  support: number;
  /** Решение принято: и кворум есть, и порог «за» набран. */
  passed: boolean;
}

/** Итоги голосования. */
export const countVotes = (
  poll: Poll,
  apartments: readonly Apartment[],
  votes: readonly Vote[],
): PollResult => {
  const rule = POLL_RULES[poll.kind];
  const byId = new Map(apartments.map((apartment) => [apartment.id, apartment]));
  const totalArea = apartments.reduce((sum, apartment) => sum + areaOf(apartment), 0);

  const shares: Record<VoteChoice, number> = { for: 0, against: 0, abstain: 0 };
  let votedArea = 0;

  const latest = new Map<string, Vote>();

  for (const vote of votes) {
    if (vote.pollId !== poll.id) continue;

    const known = latest.get(vote.apartmentId);

    if (!known || vote.at.getTime() >= known.at.getTime()) latest.set(vote.apartmentId, vote);
  }

  for (const vote of latest.values()) {
    const apartment = byId.get(vote.apartmentId);

    if (!apartment) continue;

    const area = areaOf(apartment);

    votedArea += area;
    shares[vote.choice] += area;
  }

  // Округление идёт только в отчёт: сравнивать с порогом округлённую долю
  // нельзя, иначе недобранные две трети становятся принятым решением.
  const exact = (value: number): number => (totalArea === 0 ? 0 : value / totalArea);
  const turnout = exact(votedArea);
  const quorum = turnout > rule.quorum;

  const support =
    rule.base === 'building' ? exact(shares.for) : votedArea === 0 ? 0 : shares.for / votedArea;

  const enough = rule.strict ? support > rule.threshold : support >= rule.threshold;
  const share = (value: number): number => round(exact(value));

  return {
    totalArea: round(totalArea),
    votedArea: round(votedArea),
    turnout: round(turnout),
    quorum,
    shares: { for: share(shares.for), against: share(shares.against), abstain: share(shares.abstain) },
    support: round(support),
    passed: quorum && enough,
  };
};

/** Площадь помещения. */
const areaOf = (apartment: Apartment): number => apartment.area ?? 0;

const round = (value: number): number => Number(value.toFixed(4));

/**
 * Сколько площади не хватает до кворума. Ноль, кворум уже есть. Кворум берётся
 * строго больше порога, поэтому ровно половина площади его не даёт.
 */
export const areaToQuorum = (poll: Poll, result: PollResult): number => {
  if (result.quorum) return 0;

  const needed = POLL_RULES[poll.kind].quorum * result.totalArea;

  return Math.max(0, round(needed - result.votedArea));
};

/** С какой доли площади собственники вправе требовать созыва собрания. */
export const INITIATIVE_SHARE = 0.1;

export interface Signature {
  residentId: string;
  apartmentId: string;
  at: Date;
}

/** Предложение жильца, которое собирает подписи соседей. */
export interface Initiative {
  id: string;
  buildingId: string;
  authorId: string;
  title: string;
  question: string;
  kind: PollKind;
  createdAt: Date;
  signatures: Signature[];
  /** Собрание, созванное по этой инициативе. */
  pollId?: string;
}

export interface InitiativeStanding {
  /** Доля площади подписавшихся, 0…1. */
  share: number;
  /** Сколько площади не хватает до права требовать собрания. */
  areaToDemand: number;
  /** Подписей хватает: собрание созывать обязаны. */
  enough: boolean;
}

/** Много ли собрано: подписи весят площадью так же, как голоса на собрании. */
export const standingOf = (
  initiative: Initiative,
  apartments: readonly Apartment[],
): InitiativeStanding => {
  const byId = new Map(apartments.map((apartment) => [apartment.id, apartment]));
  const totalArea = apartments.reduce((sum, apartment) => sum + areaOf(apartment), 0);
  const signed = new Set(initiative.signatures.map((signature) => signature.apartmentId));

  let area = 0;

  for (const id of signed) {
    const apartment = byId.get(id);

    if (apartment) area += areaOf(apartment);
  }

  const needed = INITIATIVE_SHARE * totalArea;

  return {
    share: totalArea === 0 ? 0 : round(area / totalArea),
    areaToDemand: Math.max(0, round(needed - area)),
    enough: totalArea > 0 && area >= needed,
  };
};

export interface SignInput {
  initiative: Initiative;
  apartment: Apartment;
  residentId: string;
  at: Date;
}

/** Подписывает инициативу. @throws {DomainError} */
export const sign = (input: SignInput): Initiative => {
  if (input.initiative.pollId) {
    throw new DomainError('initiative_closed', 'Собрание по этой инициативе уже объявлено');
  }

  if (input.apartment.buildingId !== input.initiative.buildingId) {
    throw new DomainError('forbidden', 'Подписываются собственники помещений этого дома');
  }

  if (input.initiative.signatures.some((signature) => signature.apartmentId === input.apartment.id)) {
    return input.initiative;
  }

  return {
    ...input.initiative,
    signatures: [
      ...input.initiative.signatures,
      { residentId: input.residentId, apartmentId: input.apartment.id, at: input.at },
    ],
  };
};
