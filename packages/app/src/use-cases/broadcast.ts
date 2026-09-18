import {
  DomainError,
  broadcastText,
  describeScope,
  noticeForScope,
  scopeAudience,
  selectAudience,
  type Apartment,
  type BroadcastScope,
  type Role,
} from '@domovoy/domain';

import { apartmentsOf } from '../apartments.js';
import { recordAction } from '../audit.js';
import { actingHouse, assertServes, houseHintFor } from '../buildings.js';
import { houseDebt } from '../collection.js';
import { pendingReadings } from '../meters.js';
import { wanting } from '../notices.js';
import { formatBroadcast, noopNotifier, notifyAbout } from '../notifier.js';
import type { Resident } from '../repository.js';
import type { AppDeps } from './deps.js';

/** Кто вправе писать жильцам от имени дома. */
const CAN_BROADCAST: readonly Role[] = ['dispatcher', 'manager'];

export interface BroadcastCommand {
  actor: Resident;
  scope: BroadcastScope;
  text: string;
  buildingId?: string;
}

export interface BroadcastAim {
  scope: BroadcastScope;
  /** Адресат словами: «подъезд 2, стояк 1». */
  description: string;
  /** Сколько человек подходит под адресат. */
  people: number;
  /** Из них получат сообщение: у остальных нет MAX или такие уведомления отключены. */
  recipients: number;
  /** Сколько квартир охватывает адресат. */
  apartments: number;
}

export interface BroadcastResult extends BroadcastAim {
  /** Сколько сообщений ушло. */
  sent: number;
}

export interface BroadcastRiser {
  riser: number;
  flats: number;
}

export interface BroadcastEntrance {
  entrance: number;
  flats: number;
  risers: BroadcastRiser[];
}

export interface BroadcastTargets {
  /** Подъезды и стояки дома: по ним и выбирают адресата. */
  entrances: BroadcastEntrance[];
  /** Квартир в доме всего. */
  flats: number;
  /** Открытые собрания: по ним можно написать тем, кто ещё не голосовал. */
  polls: { id: string; title: string }[];
  /** Сколько человек в смене дома. */
  staff: number;
}

const assertMayBroadcast = (actor: Resident): void => {
  if (!CAN_BROADCAST.includes(actor.role)) {
    throw new DomainError('forbidden', 'Рассылку отправляет управляющая компания');
  }
};

/** Кто подходит под адресат и сколько квартир он охватывает. */
interface Aimed {
  description: string;
  people: Resident[];
  apartments: number;
}

/** Сколько разных квартир дома занимают эти люди. */
const flatsOf = (people: readonly Resident[], inHouse: ReadonlySet<string>): number => {
  const flats = new Set<string>();

  for (const person of people) {
    for (const apartmentId of apartmentsOf(person)) {
      if (inHouse.has(apartmentId)) flats.add(apartmentId);
    }
  }

  return flats.size;
};

const byFlats = async (deps: AppDeps, flats: readonly Apartment[], description: string): Promise<Aimed> => ({
  description,
  people: await deps.repository.listResidentsByApartments(flats.map((flat) => flat.id)),
  apartments: flats.length,
});

/** Те, кто не голосовал: голос подаётся от квартиры, поэтому и считаем по квартирам. */
const notVoted = async (deps: AppDeps, buildingId: string, pollId: string): Promise<Aimed> => {
  const poll = await deps.repository.findPoll(pollId);

  if (!poll || poll.buildingId !== buildingId) {
    throw new DomainError('poll_not_found', 'Собрание не найдено');
  }

  const voted = new Set((await deps.repository.listVotes(poll.id)).map((vote) => vote.apartmentId));
  const flats = (await deps.repository.listApartments(buildingId)).filter((flat) => !voted.has(flat.id));

  return byFlats(deps, flats, describeScope({ kind: 'poll', pollId }, poll.title));
};

const withDebt = async (deps: AppDeps, actor: Resident, buildingId: string): Promise<Aimed> => {
  const debt = await houseDebt(deps, actor, buildingId);
  const people: Resident[] = [];

  for (const debtor of debt.debtors) {
    const resident = await deps.repository.findResident(debtor.residentId);

    if (resident) people.push(resident);
  }

  return {
    description: describeScope({ kind: 'debtors' }),
    people,
    apartments: new Set(debt.debtors.map((debtor) => debtor.apartmentId)).size,
  };
};

/** Кто подходит под выбранный адресат. @throws {DomainError} */
const resolve = async (
  deps: AppDeps,
  actor: Resident,
  buildingId: string,
  scope: BroadcastScope,
): Promise<Aimed> => {
  const audience = scopeAudience(scope, buildingId);

  if (audience) {
    const flats = selectAudience(await deps.repository.listApartments(buildingId), audience);

    return byFlats(deps, flats, describeScope(scope));
  }

  if (scope.kind === 'apartments') {
    const numbers = new Set(scope.numbers);
    const flats = (await deps.repository.listApartments(buildingId)).filter((flat) => numbers.has(flat.number));

    if (flats.length === 0) throw new DomainError('apartment_unknown', 'Таких квартир в доме нет');

    return byFlats(deps, flats, describeScope(scope));
  }

  if (scope.kind === 'poll') return notVoted(deps, buildingId, scope.pollId);

  if (scope.kind === 'debtors') return withDebt(deps, actor, buildingId);

  const inHouse = new Set((await deps.repository.listApartments(buildingId)).map((flat) => flat.id));

  if (scope.kind === 'meters') {
    const people = await pendingReadings(deps, buildingId);

    return { description: describeScope(scope), people, apartments: flatsOf(people, inHouse) };
  }

  const staff = await deps.repository.listStaff(buildingId);

  return { description: describeScope(scope), people: staff, apartments: 0 };
};

/** Кому сообщение дойдёт: остальные без MAX или с отключёнными уведомлениями. */
const reachable = (people: readonly Resident[], scope: BroadcastScope): Resident[] => {
  const notice = noticeForScope(scope);
  const wants = notice ? wanting(people, notice) : [...people];

  return wants.filter((person) => person.maxUserId !== undefined && person.forgottenAt === undefined);
};

/** Отправителя в адресате нет: он и так знает, что написал. */
const others = (people: readonly Resident[], actor: Resident): Resident[] =>
  people.filter((person) => person.id !== actor.id);

/** Сколько человек получит сообщение, прежде чем его отправят. @throws {DomainError} */
export const aimBroadcast = async (
  deps: AppDeps,
  actor: Resident,
  scope: BroadcastScope,
  buildingId?: string,
): Promise<BroadcastAim> => {
  assertMayBroadcast(actor);

  const house = actingHouse(deps, actor, buildingId);

  await assertServes(deps, actor, house);

  const aimed = await resolve(deps, actor, house, scope);
  const audience = others(aimed.people, actor);

  return {
    scope,
    description: aimed.description,
    people: audience.length,
    recipients: reachable(audience, scope).length,
    apartments: aimed.apartments,
  };
};

/** Рассылка по личным перепискам. @throws {DomainError} */
export const sendBroadcast = async (deps: AppDeps, command: BroadcastCommand): Promise<BroadcastResult> => {
  assertMayBroadcast(command.actor);

  const text = broadcastText(command.text);
  const house = actingHouse(deps, command.actor, command.buildingId);

  await assertServes(deps, command.actor, house);

  const aimed = await resolve(deps, command.actor, house, command.scope);
  const audience = others(aimed.people, command.actor);
  const recipients = reachable(audience, command.scope);

  if (recipients.length === 0) {
    throw new DomainError('nothing_to_send', 'Под этот адресат никто не подходит');
  }

  const notifier = deps.notifier ?? noopNotifier;
  const notice = noticeForScope(command.scope);
  const hintOf = houseHintFor(deps, house);
  let sent = 0;

  for (const resident of recipients) {
    const hint = await hintOf(resident);

    await notifyAbout(notifier, resident, formatBroadcast(text, hint), {
      section: 'news',
      ...(notice ? { mutable: notice } : {}),
    });
    sent += 1;
  }

  await recordAction(deps, {
    actor: command.actor,
    action: 'broadcast_sent',
    buildingId: house,
    subject: aimed.description,
    details: text,
  });

  return {
    scope: command.scope,
    description: aimed.description,
    people: audience.length,
    recipients: recipients.length,
    apartments: aimed.apartments,
    sent,
  };
};

/** Из чего выбирают адресата: подъезды, стояки и открытые собрания дома. */
export const broadcastTargets = async (
  deps: AppDeps,
  actor: Resident,
  buildingId?: string,
): Promise<BroadcastTargets> => {
  assertMayBroadcast(actor);

  const house = actingHouse(deps, actor, buildingId);

  await assertServes(deps, actor, house);

  const flats = await deps.repository.listApartments(house);
  const entrances = new Map<number, Map<number, number>>();

  for (const flat of flats) {
    const risers = entrances.get(flat.entrance) ?? new Map<number, number>();

    risers.set(flat.riser, (risers.get(flat.riser) ?? 0) + 1);
    entrances.set(flat.entrance, risers);
  }

  const now = deps.now();
  const polls = (await deps.repository.listPolls(house))
    .filter((poll) => !poll.closedAt && poll.closesAt.getTime() >= now.getTime())
    .map((poll) => ({ id: poll.id, title: poll.title }));

  return {
    entrances: [...entrances.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([entrance, risers]) => ({
        entrance,
        flats: [...risers.values()].reduce((total, count) => total + count, 0),
        risers: [...risers.entries()]
          .sort((left, right) => left[0] - right[0])
          .map(([riser, count]) => ({ riser, flats: count })),
      })),
    flats: flats.length,
    polls,
    staff: (await deps.repository.listStaff(house)).length,
  };
};
