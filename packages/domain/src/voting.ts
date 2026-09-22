import { addYears } from './calendar.js';
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

/**
 * Кто сейчас старший по подъезду: истёкшие полномочия не считаются. Подъезд
 * номер один есть в каждом доме, поэтому список полномочий либо относится
 * к одному дому, либо дом называют отдельно. @throws {DomainError}
 */
export const elderNow = (
  elderships: readonly Eldership[],
  entrance: number,
  at: Date,
  buildingId?: string,
): Eldership | undefined => {
  if (buildingId === undefined && new Set(elderships.map((item) => item.buildingId)).size > 1) {
    throw new DomainError('wrong_object', 'В списке полномочия разных домов: укажите дом');
  }

  return elderships
    .filter(
      (item) =>
        (buildingId === undefined || item.buildingId === buildingId) &&
        item.entrance === entrance &&
        item.since.getTime() <= at.getTime() &&
        item.until.getTime() > at.getTime(),
    )
    .sort((left, right) => right.since.getTime() - left.since.getTime())[0];
};

/** Полномочия, начавшиеся сегодня. */
export const electElder = (poll: Poll, candidate: ElderCandidate, at: Date): Eldership => ({
  buildingId: poll.buildingId,
  entrance: candidate.entrance,
  residentId: candidate.residentId,
  since: at,
  until: addYears(at, ELDER_TERM_YEARS),
});

export interface Vote {
  pollId: string;
  apartmentId: string;
  choice: VoteChoice;
  at: Date;
  /** Кто проголосовал: собственник помещения. */
  residentId: string;
  /**
   * Доля этого собственника в помещении, 0…1. У единственного собственника
   * это единица. Сособственники голосуют каждый своей долей и вправе
   * разойтись во мнении.
   */
  share?: number;
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
  /** Голосующий собственник этого помещения. Наниматель голоса не имеет. */
  owner: boolean;
  /** Его доля в помещении, 0…1. Без доли считается, что помещение целиком его. */
  share?: number;
}

/** Доля собственника: больше нуля и не больше единицы. @throws {DomainError} */
export const checkShare = (share: number | undefined): number => {
  if (share === undefined) return 1;

  if (!Number.isFinite(share) || share <= 0 || share > 1) {
    throw new DomainError('share_invalid', 'Доля в помещении задаётся числом от 0 до 1');
  }

  return share;
};

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

  // Голос на общем собрании принадлежит собственнику, а не тому, кто живёт
  // в помещении: ч. 3 ст. 48 ЖК РФ. Наниматель и член семьи не голосуют.
  if (!input.owner) {
    throw new DomainError('not_an_owner', 'Голосуют собственники помещений. Если помещение ваше, скажите об этом управляющей организации');
  }

  const share = checkShare(input.share);

  return {
    pollId: input.poll.id,
    apartmentId: input.apartment.id,
    choice: input.choice,
    at: input.at,
    residentId: input.residentId,
    ...(share === 1 ? {} : { share }),
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
  /**
   * У скольких помещений дома площадь не внесена. Пока их больше нуля, доли
   * считаются по помещениям, а кворум и решение не подтверждаются.
   */
  areasMissing: number;
}

/** Итоги голосования. @throws {DomainError} */
export const countVotes = (
  poll: Poll,
  apartments: readonly Apartment[],
  votes: readonly Vote[],
): PollResult => {
  const rule = POLL_RULES[poll.kind];
  const byId = new Map(apartments.map((apartment) => [apartment.id, apartment]));

  // Голос весит долей площади. Если площади внесены не у всех, считать по ним
  // нельзя: половина дома выглядела бы стопроцентной явкой. Тогда помещения
  // весят поровну, счёт голосов виден, а решение по нему не принимается.
  const areasMissing = apartments.filter((apartment) => areaOf(apartment) <= 0).length;
  const weightOf = (apartment: Apartment): number => (areasMissing > 0 ? 1 : areaOf(apartment));
  const totalArea = apartments.reduce((sum, apartment) => sum + weightOf(apartment), 0);

  const shares: Record<VoteChoice, number> = { for: 0, against: 0, abstain: 0 };
  let votedArea = 0;

  // Свой голос каждый собственник меняет сам, и чужой этим не перебивается:
  // последним считается последний голос этого человека по этому помещению.
  const latest = new Map<string, Vote>();

  for (const vote of votes) {
    if (vote.pollId !== poll.id) continue;

    const key = `${vote.apartmentId} ${vote.residentId}`;
    const known = latest.get(key);

    if (!known || vote.at.getTime() >= known.at.getTime()) latest.set(key, vote);
  }

  // Доли сособственников складываются, но больше целого помещения дать не могут:
  // завышенная доля не должна раздувать явку.
  const taken = new Map<string, number>();
  const ordered = [...latest.values()].sort((one, other) => one.at.getTime() - other.at.getTime());

  for (const vote of ordered) {
    const apartment = byId.get(vote.apartmentId);

    if (!apartment) continue;

    const left = Math.max(0, 1 - (taken.get(vote.apartmentId) ?? 0));
    const part = Math.min(vote.share ?? 1, left);

    if (part <= 0) continue;

    taken.set(vote.apartmentId, (taken.get(vote.apartmentId) ?? 0) + part);

    const area = weightOf(apartment) * part;

    votedArea += area;
    shares[vote.choice] += area;
  }

  // Округление идёт только в отчёт: сравнивать с порогом округлённую долю
  // нельзя, иначе недобранные две трети становятся принятым решением.
  const exact = (value: number): number => (totalArea === 0 ? 0 : value / totalArea);
  const turnout = exact(votedArea);
  const quorum = areasMissing === 0 && turnout > rule.quorum;

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
    areasMissing,
  };
};

/** Площадь помещения. */
const areaOf = (apartment: Apartment): number => apartment.area ?? 0;

/** Сколько номеров помещений называть в отказе. */
const MISSING_SHOWN = 5;

/**
 * Почему кворум не подтверждается: площади внесены не у всех помещений. Пусто,
 * если внесены у всех. Этой строкой продукт и объясняет, что надо дозаполнить.
 */
export const areasMissingNote = (apartments: readonly Apartment[]): string | undefined => {
  const missing = apartments.filter((apartment) => areaOf(apartment) <= 0);

  if (missing.length === 0) return undefined;

  const numbers = missing
    .slice(0, MISSING_SHOWN)
    .map((apartment) => apartment.number)
    .join(', ');

  return (
    `Голоса считаются долями площади, а у ${missing.length} помещений она не внесена (${numbers}` +
    `${missing.length > MISSING_SHOWN ? ' и другие' : ''}). ` +
    'Пока площади не внесены, голоса считаются по помещениям, а решение не принимается.'
  );
};

const round = (value: number): number => Number(value.toFixed(4));

/** Наименьшая площадь, которую есть смысл называть жильцу. */
const AREA_STEP = 0.01;

/**
 * Сколько площади не хватает до кворума. Ноль, кворум уже есть. Кворум берётся
 * строго больше порога, поэтому ровно половина площади его не даёт: не хватает
 * ещё немного, а не нуля.
 */
export const areaToQuorum = (poll: Poll, result: PollResult): number => {
  if (result.quorum || result.totalArea <= 0) return 0;

  const needed = POLL_RULES[poll.kind].quorum * result.totalArea;

  return Math.max(AREA_STEP, round(needed - result.votedArea));
};

/** С какой доли площади собственники вправе требовать созыва собрания. */
export const INITIATIVE_SHARE = 0.1;

export interface Signature {
  residentId: string;
  apartmentId: string;
  at: Date;
  /** Доля подписавшегося в помещении, 0…1. */
  share?: number;
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
  const taken = new Map<string, number>();

  let area = 0;

  for (const signature of initiative.signatures) {
    const apartment = byId.get(signature.apartmentId);

    if (!apartment) continue;

    const left = Math.max(0, 1 - (taken.get(signature.apartmentId) ?? 0));
    const part = Math.min(signature.share ?? 1, left);

    if (part <= 0) continue;

    taken.set(signature.apartmentId, (taken.get(signature.apartmentId) ?? 0) + part);

    area += areaOf(apartment) * part;
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
  /** Подписывается собственник: требовать собрания вправе только он. */
  owner: boolean;
  share?: number;
}

/** Подписывает инициативу. @throws {DomainError} */
export const sign = (input: SignInput): Initiative => {
  if (input.initiative.pollId) {
    throw new DomainError('initiative_closed', 'Собрание по этой инициативе уже объявлено');
  }

  if (input.apartment.buildingId !== input.initiative.buildingId) {
    throw new DomainError('forbidden', 'Подписываются собственники помещений этого дома');
  }

  if (!input.owner) {
    throw new DomainError('not_an_owner', 'Требовать собрания вправе собственники помещений');
  }

  const share = checkShare(input.share);

  if (input.initiative.signatures.some((signature) => signature.residentId === input.residentId)) {
    return input.initiative;
  }

  return {
    ...input.initiative,
    signatures: [
      ...input.initiative.signatures,
      {
        residentId: input.residentId,
        apartmentId: input.apartment.id,
        at: input.at,
        ...(share === 1 ? {} : { share }),
      },
    ],
  };
};
