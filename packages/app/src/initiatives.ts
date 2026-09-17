import {
  DomainError,
  INITIATIVE_SHARE,
  sign,
  standingOf,
  type Initiative,
  type InitiativeStanding,
  type Poll,
  type PollKind,
} from '@domovoy/domain';

import { apartmentIn, apartmentsOf } from './apartments.js';
import { homeBuildingOf, housesOf } from './buildings.js';
import { wanting } from './notices.js';
import { noopNotifier, notifyResident } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';
import { formatArea, startPoll } from './voting.js';

/** Предельная длина предложения. */
const TITLE_MAX = 120;
const QUESTION_MAX = 1000;

/** @throws {DomainError} */
const asOwner = (resident: Resident): string => {
  if (!resident.apartmentId) {
    throw new DomainError(
      'apartment_not_bound',
      'Инициативу заводят собственники помещений, сначала привяжите квартиру по коду из квитанции',
    );
  }

  return resident.apartmentId;
};

export interface StartInitiativeCommand {
  resident: Resident;
  title: string;
  question: string;
  /** Каким большинством решать. Порог выбирает тот, кто созывает собрание. */
  kind?: PollKind;
}

/** Предложение жильца, которое собирает подписи соседей. @throws {DomainError} */
export const startInitiative = async (deps: AppDeps, command: StartInitiativeCommand): Promise<Initiative> => {
  const apartmentId = asOwner(command.resident);
  const title = command.title.trim();
  const question = command.question.trim();

  if (title.length === 0) throw new DomainError('initiative_empty', 'Назовите предложение');
  if (title.length > TITLE_MAX) throw new DomainError('initiative_too_long', `Название длиннее ${TITLE_MAX} знаков`);
  if (question.length === 0) throw new DomainError('initiative_empty', 'Опишите, что предлагаете решить');

  if (question.length > QUESTION_MAX) {
    throw new DomainError('initiative_too_long', `Описание длиннее ${QUESTION_MAX} знаков`);
  }

  const buildingId = await homeBuildingOf(deps, command.resident);
  const open = (await deps.repository.listInitiatives(buildingId)).filter((item) => !item.pollId);

  if (open.some((item) => item.authorId === command.resident.id)) {
    throw new DomainError('initiative_exists', 'Ваше предложение уже собирает подписи');
  }

  const now = deps.now();

  const initiative = await deps.repository.saveInitiative({
    id: deps.createId(),
    buildingId,
    authorId: command.resident.id,
    title,
    question,
    kind: command.kind ?? 'simple',
    createdAt: now,
    signatures: [{ residentId: command.resident.id, apartmentId, at: now }],
  });

  await announce(deps, initiative);

  return initiative;
};

/** Сообщение соседям о новом предложении. */
const announce = async (deps: AppDeps, initiative: Initiative): Promise<void> => {
  const apartments = await deps.repository.listApartments(initiative.buildingId);
  const residents = await deps.repository.listResidentsByApartments(apartments.map((apartment) => apartment.id));
  const notifier = deps.notifier ?? noopNotifier;

  for (const resident of wanting(residents, 'polls')) {
    if (resident.id === initiative.authorId) continue;

    await notifyResident(
      notifier,
      resident,
      `Сосед предлагает: ${initiative.title}\n\n${initiative.question}`,
      [],
      undefined,
      undefined,
      initiative.id,
    );
  }
};

export interface InitiativeView {
  initiative: Initiative;
  standing: InitiativeStanding;
  /** Сколько помещений подписалось. */
  signatures: number;
  /** Помещение спрашивающего уже подписано. */
  mine: boolean;
  /** Предложение завёл спрашивающий. */
  author: boolean;
}

const describe = async (deps: AppDeps, initiative: Initiative, resident: Resident): Promise<InitiativeView> => {
  const apartments = await deps.repository.listApartments(initiative.buildingId);

  return {
    initiative,
    standing: standingOf(initiative, apartments),
    signatures: new Set(initiative.signatures.map((signature) => signature.apartmentId)).size,
    mine: initiative.signatures.some((signature) => apartmentsOf(resident).includes(signature.apartmentId)),
    author: initiative.authorId === resident.id,
  };
};

/** Предложения дома: сначала те, что ещё собирают подписи. */
export const listInitiativesFor = async (deps: AppDeps, resident: Resident): Promise<InitiativeView[]> => {
  const views: InitiativeView[] = [];

  for (const buildingId of await housesOf(deps, resident)) {
    for (const initiative of await deps.repository.listInitiatives(buildingId)) {
      views.push(await describe(deps, initiative, resident));
    }
  }

  return views.sort((left, right) => Number(Boolean(left.initiative.pollId)) - Number(Boolean(right.initiative.pollId)));
};

export interface SignCommand {
  resident: Resident;
  initiativeId: string;
}

/** Подпись соседа под предложением. @throws {DomainError} */
export const supportInitiative = async (deps: AppDeps, command: SignCommand): Promise<InitiativeView> => {
  const found = await deps.repository.findInitiative(command.initiativeId);

  if (!found) throw new DomainError('initiative_not_found', 'Предложение не найдено');

  const apartment = await apartmentIn(deps, command.resident, found.buildingId);

  if (!apartment) {
    throw new DomainError(
      'apartment_not_bound',
      'Подписываются собственники помещений этого дома, сначала привяжите квартиру по коду из квитанции',
    );
  }

  const apartments = await deps.repository.listApartments(found.buildingId);
  const before = standingOf(found, apartments);

  const saved = await deps.repository.saveInitiative(
    sign({ initiative: found, apartment, residentId: command.resident.id, at: deps.now() }),
  );

  const view = await describe(deps, saved, command.resident);

  if (!before.enough && view.standing.enough) await demand(deps, saved);

  return view;
};

/** Подписей хватает: дом вправе требовать собрания, смена получает уведомление. */
const demand = async (deps: AppDeps, initiative: Initiative): Promise<void> => {
  const notifier = deps.notifier ?? noopNotifier;
  const share = Math.round(INITIATIVE_SHARE * 100);

  for (const person of await deps.repository.listStaff(initiative.buildingId)) {
    await notifyResident(
      notifier,
      person,
      `Собственники требуют собрания: ${initiative.title}\n\n${initiative.question}\n\n` +
        `Подписи собраны более чем с ${share}% площади дома.`,
    );
  }
};

export interface CallMeetingCommand {
  resident: Resident;
  initiativeId: string;
  /** Сколько дней идёт голосование. */
  days: number;
  /** Каким большинством решать вопрос. */
  kind?: PollKind;
}

/** Созывает собрание по инициативе жильцов. @throws {DomainError} */
export const callMeeting = async (deps: AppDeps, command: CallMeetingCommand): Promise<Poll> => {
  const found = await deps.repository.findInitiative(command.initiativeId);

  if (!found) throw new DomainError('initiative_not_found', 'Предложение не найдено');

  if (found.pollId) throw new DomainError('initiative_closed', 'Собрание по этой инициативе уже объявлено');

  const poll = await startPoll(deps, {
    resident: command.resident,
    kind: command.kind ?? found.kind,
    title: found.title,
    question: found.question,
    days: command.days,
  });

  await deps.repository.saveInitiative({ ...found, pollId: poll.id });

  const author = await deps.repository.findResident(found.authorId);

  await notifyResident(
    deps.notifier ?? noopNotifier,
    author,
    `Собрание по вашему предложению объявлено: ${poll.title}.\nПроголосовать: команда /vote.`,
  );

  return poll;
};

/** Сколько площади не хватает, словами для чата. */
export const formatDemand = (view: InitiativeView): string =>
  view.standing.enough
    ? 'Подписей достаточно для созыва собрания'
    : `До требования о собрании не хватает ${formatArea(view.standing.areaToDemand)} м²`;
