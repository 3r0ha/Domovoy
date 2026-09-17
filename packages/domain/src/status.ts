import {
  DomainError,
  FINAL_STATUSES,
  type Attachment,
  type RequestEvent,
  type RequestStatus,
  type Role,
  type ServiceRequest,
} from './types.js';

export interface Transition {
  from: RequestStatus;
  to: RequestStatus;
  /** Кто вправе выполнить переход. */
  roles: readonly Role[];
  /** Переход требует объяснения. */
  requiresComment?: boolean;
}

/** Жизненный цикл заявки. */
export const TRANSITIONS: readonly Transition[] = [
  { from: 'new', to: 'accepted', roles: ['dispatcher', 'manager'] },
  { from: 'new', to: 'rejected', roles: ['dispatcher', 'manager'], requiresComment: true },

  { from: 'accepted', to: 'in_progress', roles: ['dispatcher', 'manager', 'technician', 'contractor'] },
  {
    from: 'accepted',
    to: 'needs_info',
    roles: ['dispatcher', 'manager', 'technician', 'contractor'],
    requiresComment: true,
  },
  { from: 'accepted', to: 'rejected', roles: ['dispatcher', 'manager'], requiresComment: true },

  { from: 'in_progress', to: 'done', roles: ['technician', 'dispatcher', 'manager', 'contractor'] },
  {
    from: 'in_progress',
    to: 'needs_info',
    roles: ['technician', 'dispatcher', 'manager', 'contractor'],
    requiresComment: true,
  },

  { from: 'done', to: 'confirmed', roles: ['resident'] },
  { from: 'done', to: 'in_progress', roles: ['resident'], requiresComment: true },

  { from: 'needs_info', to: 'in_progress', roles: ['resident', 'dispatcher', 'manager', 'technician', 'contractor'] },
  { from: 'needs_info', to: 'rejected', roles: ['dispatcher', 'manager'], requiresComment: true },

  { from: 'new', to: 'withdrawn', roles: ['resident'] },
  { from: 'accepted', to: 'withdrawn', roles: ['resident'] },
  { from: 'in_progress', to: 'withdrawn', roles: ['resident'] },
  { from: 'needs_info', to: 'withdrawn', roles: ['resident'] },
];

/** Сколько ждём подтверждения жильца, прежде чем считать работу принятой. */
export const AUTO_CONFIRM_AFTER_HOURS = 72;

/** Только смены состояния, без переписки. */
export const statusChanges = (request: ServiceRequest): RequestEvent[] =>
  request.history.filter((event) => event.kind !== 'message');

/** Когда управляющая компания отчиталась о выполнении в последний раз. */
export const reportedDoneAt = (request: ServiceRequest): Date | undefined =>
  request.status === 'done' ? statusChanges(request).findLast((event) => event.status === 'done')?.at : undefined;

/** Пора ли закрыть заявку без ответа жильца. */
export const isAutoConfirmDue = (request: ServiceRequest, now: Date): boolean => {
  const doneAt = reportedDoneAt(request);

  if (!doneAt) return false;

  return now.getTime() - doneAt.getTime() >= AUTO_CONFIRM_AFTER_HOURS * 3600_000;
};

/** В какой момент напомнить жильцу о приёмке. */
export const ACCEPTANCE_REMINDER_SHARE = 0.5;

/** Прошёл ли момент напоминания в промежутке между двумя проверками. */
export const acceptanceReminderCrossedIn = (request: ServiceRequest, from: Date, to: Date): boolean => {
  const doneAt = reportedDoneAt(request);

  if (!doneAt) return false;

  const at = doneAt.getTime() + AUTO_CONFIRM_AFTER_HOURS * 3600_000 * ACCEPTANCE_REMINDER_SHARE;

  return at > from.getTime() && at <= to.getTime();
};

export const isFinal = (status: RequestStatus): boolean => FINAL_STATUSES.includes(status);

/** Состояния, в которых работа по заявке ещё не закончена. */
export const OPEN_STATUSES: readonly RequestStatus[] = [
  'new',
  'accepted',
  'in_progress',
  'needs_info',
  'done',
];

/** Как состояние называется человеку. */
export const STATUS_TITLES: Record<RequestStatus, string> = {
  new: 'принята',
  accepted: 'принята в работу',
  in_progress: 'выполняется',
  needs_info: 'ждёт ответа жильца',
  done: 'выполнена, ждёт приёмки',
  confirmed: 'закрыта, работа принята',
  rejected: 'отклонена',
  withdrawn: 'отозвана жильцом',
};

/**
 * Те же состояния словами смены: жильцу «принята» значит «дошла», а смене
 * важно, что заявку ещё никто не взял.
 */
export const STAFF_STATUS_TITLES: Partial<Record<RequestStatus, string>> = {
  new: 'новая',
  done: 'ждёт приёмки жильцом',
};

/** Состояние словами того, кто смотрит. */
export const statusTitle = (status: RequestStatus, forStaff = false): string =>
  (forStaff ? STAFF_STATUS_TITLES[status] : undefined) ?? STATUS_TITLES[status];

/** Состояния, в которых заявка закончена. */
export const CLOSED_STATUSES = FINAL_STATUSES;

/** Переходы, доступные роли из текущего состояния. */
export const allowedTransitions = (from: RequestStatus, role: Role): RequestStatus[] =>
  TRANSITIONS.filter((transition) => transition.from === from && transition.roles.includes(role)).map(
    (transition) => transition.to,
  );

export const findTransition = (from: RequestStatus, to: RequestStatus): Transition | undefined =>
  TRANSITIONS.find((transition) => transition.from === from && transition.to === to);

export interface ApplyTransitionInput {
  to: RequestStatus;
  role: Role;
  actorId: string;
  at: Date;
  comment?: string;
  /** Назначить исполнителя вместе с переходом в работу. */
  assigneeId?: string;
  /** Снимок результата. */
  attachments?: Attachment[];
  /** Оценка работы жильцом, 1…5. Только вместе с приёмкой. */
  rating?: number;
  /** Мастер отсканировал наклейку объекта: он был на месте. */
  onSite?: boolean;
}

/** Границы оценки. */
export const RATING_RANGE = { min: 1, max: 5 } as const;

/** Проверка оценки. @throws {DomainError} */
const checkRating = (rating: number, to: RequestStatus): void => {
  if (to !== 'confirmed') {
    throw new DomainError('rating_not_allowed', 'Оценка ставится вместе с приёмкой работы');
  }

  if (!Number.isInteger(rating) || rating < RATING_RANGE.min || rating > RATING_RANGE.max) {
    throw new DomainError(
      'rating_out_of_range',
      `Оценка это целое число от ${RATING_RANGE.min} до ${RATING_RANGE.max}`,
    );
  }
};

/** Выполняет переход и дописывает историю. @throws {DomainError} */
export const applyTransition = (request: ServiceRequest, input: ApplyTransitionInput): ServiceRequest => {
  if (isFinal(request.status)) {
    throw new DomainError(
      'request_closed',
      `Заявка ${request.number} уже закрыта: ${STATUS_TITLES[request.status]}`,
    );
  }

  const transition = findTransition(request.status, input.to);

  if (!transition) {
    throw new DomainError(
      'transition_not_allowed',
      `Из состояния «${STATUS_TITLES[request.status]}» нельзя перейти в «${STATUS_TITLES[input.to]}»`,
    );
  }

  if (!transition.roles.includes(input.role)) {
    throw new DomainError(
      'role_not_allowed',
      `Роль «${input.role}» не может перевести заявку в «${input.to}»`,
    );
  }

  if (transition.requiresComment && !input.comment?.trim()) {
    throw new DomainError('comment_required', `Переход в «${input.to}» требует объяснения`);
  }

  if (input.rating !== undefined) checkRating(input.rating, input.to);

  const event: RequestEvent = {
    at: input.at,
    status: input.to,
    role: input.role,
    actorId: input.actorId,
    ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}),
    ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.onSite ? { onSite: true } : {}),
  };

  const reopened = request.status === 'done' && input.to === 'in_progress';

  return {
    ...request,
    status: input.to,
    ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
    ...(input.rating === undefined ? {} : { rating: input.rating }),
    history: [...request.history, event],
    reopenCount: request.reopenCount + (reopened ? 1 : 0),
  };
};

export interface AddMessageInput {
  role: Role;
  actorId: string;
  at: Date;
  text: string;
  attachments?: Attachment[];
}

/** Сколько букв помещается в одно сообщение по заявке. */
export const MESSAGE_MAX_LENGTH = 2000;

/** Дописывает сообщение в переписку по заявке. @throws {DomainError} */
export const addMessage = (request: ServiceRequest, input: AddMessageInput): ServiceRequest => {
  if (isFinal(request.status)) {
    throw new DomainError(
      'request_closed',
      `Заявка ${request.number} уже закрыта: ${STATUS_TITLES[request.status]}`,
    );
  }

  const text = input.text.trim();

  // Снимок без подписи это тоже сообщение: пустым считается только то, в чём нет ничего.
  if (text.length === 0 && !input.attachments?.length) {
    throw new DomainError('message_empty', 'Сообщение пустое');
  }

  if (text.length > MESSAGE_MAX_LENGTH) {
    throw new DomainError('message_too_long', `Сообщение длиннее ${MESSAGE_MAX_LENGTH} знаков`);
  }

  const event: RequestEvent = {
    at: input.at,
    status: request.status,
    role: input.role,
    actorId: input.actorId,
    kind: 'message',
    comment: text,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  };

  return { ...request, history: [...request.history, event] };
};
