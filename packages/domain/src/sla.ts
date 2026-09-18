import { isConfirmedIncident } from './incident.js';
import { crossedIn, median } from './numbers.js';
import { isFinal, statusChanges } from './status.js';
import type { Priority, RequestCategory, ServiceRequest } from './types.js';

export interface CategoryRule {
  /** Как показывать категорию жильцу. */
  title: string;
  /** Одно слово для кнопки отбора. */
  short: string;
  /** Сколько минут есть у диспетчера на приём заявки. */
  reactionMinutes: number;
  /** Сколько часов есть на выполнение работ. */
  resolutionHours: number;
  /** Срочность по умолчанию, если жилец не указал иное. */
  defaultPriority: Priority;
}

/** Сроки по категориям. */
export const CATEGORY_RULES: Readonly<Record<RequestCategory, CategoryRule>> = {
  elevator: { title: 'Лифт', short: 'Лифт', reactionMinutes: 15, resolutionHours: 24, defaultPriority: 'emergency' },
  plumbing: { title: 'Водоснабжение и канализация', short: 'Вода', reactionMinutes: 30, resolutionHours: 24, defaultPriority: 'normal' },
  heating: { title: 'Отопление', short: 'Тепло', reactionMinutes: 30, resolutionHours: 24, defaultPriority: 'normal' },
  electricity: { title: 'Электричество', short: 'Свет', reactionMinutes: 30, resolutionHours: 12, defaultPriority: 'normal' },
  cleaning: { title: 'Уборка', short: 'Уборка', reactionMinutes: 240, resolutionHours: 72, defaultPriority: 'planned' },
  yard: { title: 'Двор и территория', short: 'Двор', reactionMinutes: 240, resolutionHours: 120, defaultPriority: 'planned' },
  safety: { title: 'Безопасность', short: 'Безопасность', reactionMinutes: 15, resolutionHours: 6, defaultPriority: 'emergency' },
  document: { title: 'Справки и документы', short: 'Справки', reactionMinutes: 240, resolutionHours: 72, defaultPriority: 'planned' },
  other: { title: 'Другое', short: 'Другое', reactionMinutes: 120, resolutionHours: 72, defaultPriority: 'normal' },
};

/**
 * Что сделать до приезда мастера. Совет короткий и только по аварии: в обычной
 * заявке он был бы шумом.
 */
const EMERGENCY_HINTS: Partial<Record<RequestCategory, string>> = {
  plumbing: 'Если можете, перекройте воду до приезда мастера.',
  electricity: 'Не трогайте проводку и щиток: дождитесь мастера.',
  elevator: 'Если в кабине люди, нажмите кнопку связи и не открывайте двери сами.',
  heating: 'Не пытайтесь стравливать батареи самостоятельно.',
  safety: 'Если есть угроза жизни, сначала звоните 112.',
};

/** Совет по аварийной заявке. Пусто, если заявка не аварийная или совета нет. */
export const emergencyHint = (category: RequestCategory, priority: Priority): string | undefined =>
  priority === 'emergency' ? EMERGENCY_HINTS[category] : undefined;

/** Срочность сжимает или растягивает сроки категории. */
export const PRIORITY_FACTOR: Readonly<Record<Priority, number>> = {
  emergency: 0.25,
  normal: 1,
  planned: 2,
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface Deadlines {
  reactionDueAt: Date;
  resolutionDueAt: Date;
}

/** Локализация аварийного повреждения: полчаса с момента регистрации заявки. */
export const NORM_LOCALIZATION_MINUTES = 30;

/** Ликвидация засора внутридомовой системы водоотведения: два часа. */
export const NORM_BLOCKAGE_HOURS = 2;

/** Устранение аварийного повреждения: трое суток с даты повреждения. */
export const NORM_EMERGENCY_HOURS = 72;

/** Норма, которая ограничивает срок сверху помимо регламента организации. */
export type NormLimit = 'blockage' | 'emergency';

const normHours = (limit: NormLimit | undefined): number | undefined => {
  if (limit === 'blockage') return NORM_BLOCKAGE_HOURS;

  return limit === 'emergency' ? NORM_EMERGENCY_HOURS : undefined;
};

/**
 * Сроки заявки. Регламент организации бывает строже нормы, мягче нет: п. 13
 * Правил № 416 даёт полчаса на локализацию аварии, два часа на засор и трое
 * суток на устранение аварийного повреждения, и эти потолки продукт держит сам.
 */
export const computeDeadlines = (
  category: RequestCategory,
  priority: Priority,
  createdAt: Date,
  limit?: NormLimit,
): Deadlines => {
  const rule = CATEGORY_RULES[category];
  const factor = PRIORITY_FACTOR[priority];

  const reaction =
    priority === 'emergency'
      ? Math.min(rule.reactionMinutes * factor, NORM_LOCALIZATION_MINUTES)
      : rule.reactionMinutes * factor;

  const capped = normHours(limit);
  const resolution = capped === undefined ? rule.resolutionHours * factor : Math.min(rule.resolutionHours * factor, capped);

  return {
    reactionDueAt: new Date(createdAt.getTime() + Math.round(reaction) * MINUTE_MS),
    resolutionDueAt: new Date(createdAt.getTime() + Math.round(resolution * 60) * MINUTE_MS),
  };
};

/** Срок реакции нарушен: заявку не приняли вовремя. */
export const isReactionOverdue = (request: ServiceRequest, now: Date): boolean =>
  request.status === 'new' && now.getTime() > request.reactionDueAt.getTime();

/** Работа сдана или заявка закрыта: срок по ней больше не идёт. */
export const isSettled = (request: ServiceRequest): boolean => request.status === 'done' || isFinal(request.status);

/** Срок выполнения нарушен. */
export const isResolutionOverdue = (request: ServiceRequest, now: Date): boolean => {
  if (isSettled(request) || request.status === 'needs_info') return false;

  return now.getTime() > request.resolutionDueAt.getTime();
};

export const isOverdue = (request: ServiceRequest, now: Date): boolean =>
  isReactionOverdue(request, now) || isResolutionOverdue(request, now);

/** Какой срок был нарушен в промежутке между двумя проверками. */
export const deadlineCrossedIn = (
  request: ServiceRequest,
  from: Date,
  to: Date,
): 'reaction' | 'resolution' | null => {
  const within = (at: Date): boolean => crossedIn(at, from, to);

  if (request.status === 'new' && within(request.reactionDueAt)) return 'reaction';

  const settled =
    isSettled(request) || request.status === 'needs_info';

  if (!settled && within(request.resolutionDueAt)) return 'resolution';

  return null;
};

/** Какая доля срока считается последней. */
export const WARNING_SHARE = 0.25;

const warningPoint = (from: Date, due: Date): Date =>
  new Date(due.getTime() - (due.getTime() - from.getTime()) * WARNING_SHARE);

/** Какой срок подходит к концу в промежутке между двумя проверками. */
export const warningCrossedIn = (
  request: ServiceRequest,
  from: Date,
  to: Date,
): 'reaction' | 'resolution' | null => {
  const within = (at: Date): boolean => crossedIn(at, from, to);

  if (request.status === 'new') {
    return within(warningPoint(request.createdAt, request.reactionDueAt)) ? 'reaction' : null;
  }

  const settled =
    isSettled(request) || request.status === 'needs_info';

  if (settled) return null;

  return within(warningPoint(request.createdAt, request.resolutionDueAt)) ? 'resolution' : null;
};

/** Когда управляющая компания впервые ответила: любой переход из «новой». */
export const reactedAt = (request: ServiceRequest): Date | undefined =>
  statusChanges(request).find((event) => event.status !== 'new')?.at;

/** Когда работа была сдана: последний отчёт о выполнении или отказ. */
export const settledAt = (request: ServiceRequest): Date | undefined => {
  if (!isSettled(request)) return undefined;

  return statusChanges(request).findLast((event) => event.status === 'done' || event.status === 'rejected')?.at;
};

/** Норматив реакции нарушен. */
export const missedReaction = (request: ServiceRequest, now: Date): boolean => {
  const reacted = reactedAt(request);

  return reacted ? reacted.getTime() > request.reactionDueAt.getTime() : isReactionOverdue(request, now);
};

/** Норматив выполнения нарушен: срок сравнивается со временем сдачи работы. */
export const missedResolution = (request: ServiceRequest, now: Date): boolean => {
  const settled = settledAt(request);

  return settled ? settled.getTime() > request.resolutionDueAt.getTime() : isResolutionOverdue(request, now);
};

/** Заявка не уложилась в норматив: по реакции или по выполнению. */
export const missedDeadline = (request: ServiceRequest, now: Date): boolean =>
  missedReaction(request, now) || missedResolution(request, now);

/** Сколько миллисекунд осталось до срока выполнения. Отрицательное значение, просрочка. */
export const timeToResolution = (request: ServiceRequest, now: Date): number =>
  request.resolutionDueAt.getTime() - now.getTime();

/**
 * Сколько миллисекунд осталось до срока, который идёт по заявке сейчас. У
 * непринятой это срок ответа, а когда он уже нарушен, срок работ: иначе две
 * просроченные заявки выстроились бы по одинаковому нормативу реакции.
 * Отрицательное значение, просрочка.
 */
export const timeToDeadline = (request: ServiceRequest, now: Date): number => {
  const reaction = request.reactionDueAt.getTime() - now.getTime();

  return request.status === 'new' && reaction > 0 ? reaction : timeToResolution(request, now);
};

/** Кому сейчас принадлежит ход. */
const turn = (request: ServiceRequest): number => {
  if (isFinal(request.status)) return 2;
  if (request.status === 'done') return 1;

  return 0;
};

/** Сортировка очереди диспетчера: сначала просроченное, потом подтверждённая авария, потом самое срочное. */
export const compareByUrgency = (left: ServiceRequest, right: ServiceRequest, now: Date): number => {
  const byTurn = turn(left) - turn(right);

  if (byTurn !== 0) return byTurn;

  const leftOverdue = isOverdue(left, now);
  const rightOverdue = isOverdue(right, now);

  if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;

  const leftIncident = isConfirmedIncident(left);
  const rightIncident = isConfirmedIncident(right);

  if (leftIncident !== rightIncident) return leftIncident ? -1 : 1;

  return timeToDeadline(left, now) - timeToDeadline(right, now);
};

export interface CategoryStats {
  category: RequestCategory;
  /** Медиана времени от создания до «выполнено», миллисекунды. */
  medianResolutionMs: number;
  /** Сколько закрытых заявок легло в основу оценки. */
  sampleSize: number;
}

/** Сколько на самом деле занимает работа по категории. */
export const collectCategoryStats = (requests: readonly ServiceRequest[]): CategoryStats[] => {
  const durations = new Map<RequestCategory, number[]>();

  for (const request of requests) {
    // Последняя сдача, как и в settledAt: переделанная работа заняла всё время
    // до повторного «выполнено», а не до первого.
    const finished = statusChanges(request).findLast((event) => event.status === 'done');

    if (!finished) continue;

    const list = durations.get(request.category) ?? [];
    list.push(finished.at.getTime() - request.createdAt.getTime());
    durations.set(request.category, list);
  }

  return [...durations].map(([category, values]) => ({
    category,
    medianResolutionMs: median(values),
    sampleSize: values.length,
  }));
};

export type DeadlineRisk = 'none' | 'watch' | 'high';

export interface RiskAssessment {
  risk: DeadlineRisk;
  /** Почему так решили. */
  reason: string;
}

/** Минимум закрытых заявок, с которого медиана что-то значит. */
const MIN_SAMPLE = 3;

/** Успеет ли заявка закрыться в срок. */
export const assessDeadlineRisk = (
  request: ServiceRequest,
  stats: readonly CategoryStats[],
  now: Date,
): RiskAssessment => {
  if (isOverdue(request, now)) return { risk: 'high', reason: 'срок уже нарушен' };

  if (isSettled(request)) return { risk: 'none', reason: 'работа завершена' };

  if (request.status === 'needs_info') return { risk: 'none', reason: 'ждёт ответа жильца' };

  const left = request.resolutionDueAt.getTime() - now.getTime();
  const elapsed = now.getTime() - request.createdAt.getTime();
  const found = stats.find((item) => item.category === request.category);

  if (!found || found.sampleSize < MIN_SAMPLE) {
    return { risk: 'none', reason: 'мало данных по категории' };
  }

  const expectedLeft = found.medianResolutionMs - elapsed;

  if (expectedLeft > left) {
    const hours = Math.max(1, Math.round((expectedLeft - left) / HOUR_MS));
    return { risk: 'high', reason: `по опыту не хватает ещё ${hours} ч` };
  }

  if (expectedLeft > left * 0.7) {
    return { risk: 'watch', reason: 'запаса почти не осталось' };
  }

  return { risk: 'none', reason: 'идёт с запасом' };
};

/** Загрузка исполнителя: сколько незакрытых заявок на нём висит. */
export const assigneeLoad = (requests: readonly ServiceRequest[]): Map<string, number> => {
  const load = new Map<string, number>();

  for (const request of requests) {
    const open = request.status === 'accepted' || request.status === 'in_progress';

    if (!open || !request.assigneeId) continue;

    load.set(request.assigneeId, (load.get(request.assigneeId) ?? 0) + 1);
  }

  return load;
};
