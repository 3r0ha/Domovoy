import type { FastifyReply } from 'fastify';

import type { RoutesDeps } from './context.js';
import { ServiceError } from './errors.js';
import {
  announcementAudience,
  lastMonth,
  zoneOf,
  type TariffView,
  type Announcement,
  type AppDeps,
  type HouseMeterState,
  type InitiativeView,
  type MeterState,
  type PollView,
  type Resident,
  type TicketCard,
} from '@domovoy/app';
import {
  BASIS,
  CATEGORY_RULES,
  PLAIN,
  basisFor,
  deadlineBasisFor,
  normLimitFor,
  HANDOFF_BASIS,
  HANDOFF_STATUS_TITLES,
  HANDOFF_TITLES,
  type HandoffTarget,
  INSPECTION_RULES,
  isHandoffOverdue,
  type Handoff,
  TICKET_STATUS_TITLES,
  checkedCount,
  isInspectionOverdue,
  type Inspection,
  INITIATIVE_SHARE,
  METER_RULES,
  POLL_RULES,
  AUTO_CONFIRM_AFTER_HOURS,
  describeAudience,
  describeTarget,
  emergencyHint,
  OPEN_STATUSES,
  isConfirmedIncident,
  isOverdue,
  isReactionOverdue,
  reportedDoneAt,
  reportersCount,
  spreadOf,
  verificationState,
  type MeterKind,
  type RequestCategory,
  type RequestStatus,
  type ServiceRequest,
} from '@domovoy/domain';

/** Сколько записей журнала отдаём за раз. */
export const JOURNAL_LIMIT = 50;

/** Осмотр общего имущества: чек-лист с отметками и найденными недостатками. */
export const inspectionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kind: { type: 'string' },
    title: { type: 'string' },
    entrance: { type: 'integer' },
    equipmentTitle: { type: 'string' },
    dueAt: { type: 'string' },
    overdue: { type: 'boolean' },
    finishedAt: { type: 'string' },
    onSite: { type: 'boolean' },
    checked: { type: 'integer' },
    requestIds: { type: 'array', items: { type: 'string' } },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          state: { type: 'string' },
          comment: { type: 'string' },
          at: { type: 'string' },
        },
      },
    },
  },
} as const;

export const serializeInspection = (inspection: Inspection, now = new Date(), equipment = new Map<string, string>()) => ({
  id: inspection.id,
  kind: inspection.kind,
  title: INSPECTION_RULES[inspection.kind].title,
  ...(inspection.entrance === undefined ? {} : { entrance: inspection.entrance }),
  ...(inspection.equipmentCode
    ? { equipmentTitle: equipment.get(inspection.equipmentCode) ?? inspection.equipmentCode }
    : {}),
  dueAt: inspection.dueAt.toISOString(),
  overdue: isInspectionOverdue(inspection, now),
  ...(inspection.finishedAt ? { finishedAt: inspection.finishedAt.toISOString() } : {}),
  ...(inspection.onSite ? { onSite: true } : {}),
  checked: checkedCount(inspection),
  requestIds: inspection.requestIds,
  items: inspection.items.map((item) => ({
    title: item.title,
    ...(item.state ? { state: item.state } : {}),
    ...(item.comment ? { comment: item.comment } : {}),
    ...(item.at ? { at: item.at.toISOString() } : {}),
  })),
});

/** Заявка на плане дома: одной строкой, без адреса, он и есть место на схеме. */
export const alertSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, title: { type: 'string' }, emergency: { type: 'boolean' } },
} as const;

/** Подпись объекта с заглавной буквы: она начинает строку в интерфейсе. */
export const asTitle = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Кто из жильцов написал сообщение: своё или соседа. Квартира соседа
 * не раскрывается.
 */
export const speakerOf = (
  event: ServiceRequest['history'][number],
  request: ServiceRequest,
  viewer?: Resident,
): 'you' | 'neighbour' | undefined => {
  if (event.kind !== 'message' || event.role !== 'resident') return undefined;
  if (viewer?.role !== 'resident' || reportersCount(request) < 2) return undefined;

  return event.actorId === viewer.id ? 'you' : 'neighbour';
};

/** Заявка в виде, пригодном для отправки клиенту. */
export const serializeRequest = (
  request: ServiceRequest,
  now: Date,
  names?: ReadonlyMap<string, string>,
  viewer?: Resident,
) => ({
  id: request.id,
  number: request.number,
  category: request.category,
  categoryTitle: CATEGORY_RULES[request.category].title,
  categoryShort: CATEGORY_RULES[request.category].short,
  priority: request.priority,
  status: request.status,
  title: request.title,
  description: request.description,
  target: asTitle(describeTarget(request.target)),
  createdAt: request.createdAt.toISOString(),
  reactionDueAt: request.reactionDueAt.toISOString(),
  resolutionDueAt: request.resolutionDueAt.toISOString(),
  dueAt: (request.status === 'new' ? request.reactionDueAt : request.resolutionDueAt).toISOString(),
  overdue: isOverdue(request, now),
  reactionOverdue: isReactionOverdue(request, now),
  // Откуда взялся срок, нужно смене: она отвечает за регламент. Жильцу хватает
  // самого срока, норма в его карточке только мешает читать.
  ...(viewer && viewer.role !== 'resident'
    ? { deadlineBasis: deadlineBasisFor(request.priority, normLimitFor(request.description, request.priority)) }
    : {}),
  ...(autoConfirmAt(request) ? { autoConfirmAt: autoConfirmAt(request)?.toISOString() } : {}),
  reporters: reportersCount(request),
  ...(request.knockedAt ? { knocked: true } : {}),
  spread: spreadOf(request),
  incident: isConfirmedIncident(request),
  // Совет по аварии нужен, пока её не устранили: в закрытой заявке он ни к чему.
  ...(OPEN_STATUSES.includes(request.status) && emergencyHint(request.category, request.priority)
    ? { hint: emergencyHint(request.category, request.priority) }
    : {}),
  // Памятка идёт исполнителю: это его обязанность, а не забота жильца.
  ...(viewer &&
  (viewer.role === 'technician' || viewer.role === 'contractor') &&
  request.target.kind === 'apartment' &&
  (request.status === 'accepted' || request.status === 'in_progress')
    ? { workerNote: BASIS.workerAtHome }
    : {}),
  reopenCount: request.reopenCount,
  ...(request.assigneeId ? { assigneeId: request.assigneeId } : {}),
  ...(request.assigneeId && names?.get(request.assigneeId)
    ? { assigneeName: names.get(request.assigneeId) }
    : {}),
  ...(request.rating === undefined ? {} : { rating: request.rating }),
  attachments: request.attachments.map((attachment) => ({
    kind: attachment.kind,
    token: attachment.token,
    ...(attachment.transcript ? { transcript: attachment.transcript } : {}),
  })),
  history: request.history.map((event) => ({
    at: event.at.toISOString(),
    status: event.status,
    role: event.role,
    ...(speakerOf(event, request, viewer) ? { speaker: speakerOf(event, request, viewer) } : {}),
    ...(event.kind ? { kind: event.kind } : {}),
    ...(event.comment ? { comment: event.comment } : {}),
    ...(event.attachments?.length
      ? {
          attachments: event.attachments.map((attachment) => ({
            kind: attachment.kind,
            token: attachment.token,
            ...(attachment.transcript ? { transcript: attachment.transcript } : {}),
          })),
        }
      : {}),
    ...(event.onSite ? { onSite: true } : {}),
  })),
});

/** Когда молчание жильца закроет заявку. */
export const autoConfirmAt = (request: ServiceRequest): Date | undefined => {
  const doneAt = reportedDoneAt(request);

  return doneAt ? new Date(doneAt.getTime() + AUTO_CONFIRM_AFTER_HOURS * 3600_000) : undefined;
};

/** Выбранный дом: сотрудник переключается между домами компании. */
export const buildingIdSchema = { type: 'string', maxLength: 128 } as const;

/** Обращение в поддержку для клиента: переписка с подписями сторон. */
export const serializeTicket = (card: TicketCard, viewerId: string, staff = false) => {
  const { ticket } = card;

  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    statusTitle: TICKET_STATUS_TITLES[ticket.status],
    buildingId: ticket.buildingId,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    mine: ticket.residentId === viewerId,
    ...(card.authorName ? { authorName: card.authorName } : {}),
    ...(card.apartment === undefined ? {} : { apartment: card.apartment }),
    ...(card.waitingSince ? { waitingSince: card.waitingSince.toISOString() } : {}),
    ...(card.answerDueAt
      ? {
          answerDueAt: card.answerDueAt.toISOString(),
          ...(basisFor('supportAnswer', staff) ? { basis: basisFor('supportAnswer', staff) } : {}),
        }
      : {}),
    ...(card.overdue ? { overdue: true } : {}),
    messages: ticket.messages.map((message) => ({
      at: message.at.toISOString(),
      from: message.from,
      own: message.authorId === viewerId,
      ...(message.authorName ? { authorName: message.authorName } : {}),
      text: message.text,
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((attachment) => ({
              kind: attachment.kind,
              token: attachment.token,
              ...(attachment.transcript ? { transcript: attachment.transcript } : {}),
            })),
          }
        : {}),
    })),
  };
};

export const ticketSchema = {
  type: 'object',
  required: ['id', 'subject', 'status', 'statusTitle', 'buildingId', 'createdAt', 'updatedAt', 'messages'],
  properties: {
    id: { type: 'string' },
    subject: { type: 'string' },
    status: { type: 'string', enum: ['open', 'answered', 'closed'] },
    statusTitle: { type: 'string' },
    buildingId: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    mine: { type: 'boolean' },
    authorName: { type: 'string' },
    apartment: { type: 'integer' },
    waitingSince: { type: 'string' },
    answerDueAt: { type: 'string' },
    basis: { type: 'string' },
    overdue: { type: 'boolean' },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['at', 'from', 'text'],
        properties: {
          at: { type: 'string' },
          from: { type: 'string', enum: ['resident', 'staff'] },
          own: { type: 'boolean' },
          authorName: { type: 'string' },
          text: { type: 'string' },
          attachments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string' },
                token: { type: 'string' },
                transcript: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** Запись на приём. */
export const visitSchema = {
  type: 'object',
  required: ['id', 'at', 'minutes', 'topic', 'status', 'day', 'clock'],
  properties: {
    id: { type: 'string' },
    at: { type: 'string' },
    minutes: { type: 'integer' },
    topic: { type: 'string' },
    status: { type: 'string', enum: ['booked', 'cancelled', 'done'] },
    day: { type: 'string' },
    clock: { type: 'string' },
    residentName: { type: 'string' },
    apartment: { type: 'integer' },
  },
} as const;

/** Свободные часы приёма и своя запись. */
export const receptionSchema = {
  type: 'object',
  required: ['buildingId', 'minutes', 'hours', 'slots'],
  properties: {
    buildingId: { type: 'string' },
    minutes: { type: 'integer' },
    hours: { type: 'string' },
    office: { type: 'string' },
    // Окна идут рядом со строкой часов: смена правит заданное, а не вводит заново.
    windows: {
      type: 'array',
      items: {
        type: 'object',
        required: ['weekday', 'from', 'to'],
        properties: {
          weekday: { type: 'integer' },
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
    },
    slots: {
      type: 'array',
      items: {
        type: 'object',
        required: ['at', 'day', 'clock'],
        properties: { at: { type: 'string' }, day: { type: 'string' }, clock: { type: 'string' } },
      },
    },
    mine: visitSchema,
  },
} as const;

/** Приёмные окна в карточке дома. */
export const receptionWindowsSchema = {
  type: 'array',
  maxItems: 21,
  items: {
    type: 'object',
    required: ['weekday', 'from', 'to'],
    properties: {
      weekday: { type: 'integer', minimum: 1, maximum: 7 },
      from: { type: 'string', maxLength: 5 },
      to: { type: 'string', maxLength: 5 },
    },
  },
} as const;

/** Ответственный по дому в карточке и в ответе. */
export const contactSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    role: { type: 'string', maxLength: 120 },
    phone: { type: 'string', maxLength: 32 },
    email: { type: 'string', maxLength: 200 },
  },
} as const;

/**
 * Сведения об обслуживании: их организация обязана держать доступными жильцу
 * в MAX (приказ Минстроя России № 856/пр).
 */
export const serviceSchema = {
  type: 'object',
  properties: {
    emergencyPhone: { type: 'string', maxLength: 32 },
    phone: { type: 'string', maxLength: 32 },
    email: { type: 'string', maxLength: 200 },
    hours: { type: 'string', maxLength: 120 },
    office: { type: 'string', maxLength: 200 },
    officeHours: { type: 'string', maxLength: 120 },
  },
} as const;

/** Что принимает карточка дома. */
/** Смежная организация дома в карточке и в ответе. */
export const partnerSchema = {
  type: 'object',
  required: ['kind', 'title'],
  properties: {
    kind: { type: 'string', enum: ['resource', 'contractor', 'municipal', 'inspection'] },
    title: { type: 'string', maxLength: 200 },
    categories: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 32 } },
    phone: { type: 'string', maxLength: 32 },
    email: { type: 'string', maxLength: 200 },
    channel: { type: 'string', maxLength: 32 },
  },
} as const;

export const partnersSchema = { type: 'array', maxItems: 32, items: partnerSchema } as const;

export const houseCardSchema = {
  type: 'object',
  properties: {
    code: { type: 'string', maxLength: 16 },
    address: { type: 'string', maxLength: 200 },
    managementCompany: { type: 'string', maxLength: 200 },
    timeZone: { type: 'string', maxLength: 64 },
    contact: { ...contactSchema, required: [] },
    service: serviceSchema,
    reception: receptionWindowsSchema,
    visitMinutes: { type: 'integer', minimum: 5, maximum: 240 },
    partners: partnersSchema,
  },
} as const;

/** Карточка дома в ответе. */
export const houseSchema = {
  type: 'object',
  required: ['id', 'code', 'address', 'chatBound'],
  properties: {
    id: { type: 'string' },
    code: { type: 'string' },
    address: { type: 'string' },
    managementCompany: { type: 'string' },
    timeZone: { type: 'string' },
    chatBound: { type: 'boolean' },
    contact: contactSchema,
    service: serviceSchema,
    reception: receptionWindowsSchema,
    visitMinutes: { type: 'integer' },
    partners: partnersSchema,
  },
} as const;

/** К кому обращаться по дому. */
export const contactsSchema = {
  type: 'object',
  required: ['buildingId', 'address'],
  properties: {
    buildingId: { type: 'string' },
    address: { type: 'string' },
    managementCompany: { type: 'string' },
    contact: contactSchema,
    service: serviceSchema,
    duty: {
      type: 'object',
      required: ['displayName'],
      properties: { displayName: { type: 'string' }, phone: { type: 'string' } },
    },
  },
} as const;

/** На что можно сделать наклейку и какие стили доступны. */
export const stickersSchema = {
  type: 'object',
  required: ['styles', 'objects'],
  properties: {
    styles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'title', 'paper', 'ink', 'accent'],
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          paper: { type: 'string' },
          ink: { type: 'string' },
          accent: { type: 'string' },
        },
      },
    },
    objects: {
      type: 'array',
      items: {
        type: 'object',
        required: ['payload', 'caption', 'link', 'kind', 'target'],
        properties: {
          payload: { type: 'string' },
          caption: { type: 'string' },
          link: { type: 'string' },
          kind: { type: 'string' },
          target: { type: 'string' },
        },
      },
    },
  },
} as const;

/** Отправленная наклейка: по идентификатору сообщения её пересылают дальше. */
export const sentStickerSchema = {
  type: 'object',
  required: ['caption', 'payload', 'link', 'as'],
  properties: {
    caption: { type: 'string' },
    payload: { type: 'string' },
    link: { type: 'string' },
    as: { type: 'string', enum: ['image', 'document'] },
    messageId: { type: 'string' },
  },
} as const;

/** Вложения в теле запроса: одинаковы и у обращения жильца, и у отчёта мастера. */
export const attachmentsBodySchema = {
  type: 'array',
  maxItems: 10,
  items: {
    type: 'object',
    required: ['kind', 'token'],
    properties: {
      kind: { type: 'string', enum: ['photo', 'voice', 'file'] },
      token: { type: 'string', maxLength: 512 },
      transcript: { type: 'string', maxLength: 2000 },
    },
  },
} as const;

/** Переданное обращение для клиента: срок и основание приходят рядом с состоянием. */
export const serializeHandoff = (handoff: Handoff, now: Date, staff = true) => ({
  id: handoff.id,
  requestId: handoff.requestId,
  to: handoff.to,
  organization: handoff.organization,
  channel: handoff.channel,
  status: handoff.status,
  statusTitle: HANDOFF_STATUS_TITLES[handoff.status],
  dueAt: handoff.dueAt.toISOString(),
  // Срок ответа принимающей стороны смене нужен с нормой, жильцу с датой.
  ...(staff ? { basis: HANDOFF_BASIS[handoff.to] } : {}),
  overdue: isHandoffOverdue(handoff, now),
  createdAt: handoff.createdAt.toISOString(),
  ...(handoff.externalId ? { externalId: handoff.externalId } : {}),
  ...(handoff.answer ? { answer: handoff.answer } : {}),
  ...(handoff.answeredAt ? { answeredAt: handoff.answeredAt.toISOString() } : {}),
});

export const handoffSchema = {
  type: 'object',
  required: ['id', 'requestId', 'to', 'organization', 'channel', 'status', 'statusTitle', 'dueAt', 'overdue', 'createdAt'],
  properties: {
    id: { type: 'string' },
    requestId: { type: 'string' },
    to: { type: 'string' },
    organization: { type: 'string' },
    channel: { type: 'string' },
    status: { type: 'string' },
    statusTitle: { type: 'string' },
    dueAt: { type: 'string' },
    basis: { type: 'string' },
    overdue: { type: 'boolean' },
    createdAt: { type: 'string' },
    externalId: { type: 'string' },
    answer: { type: 'string' },
    answeredAt: { type: 'string' },
  },
} as const;

/** Кому можно передать обращение: список берётся из правил домена. */
export const HANDOFF_TARGETS = Object.keys(HANDOFF_TITLES) as HandoffTarget[];

/** Кому обращение можно передать: одна строка списка адресатов. */
export const handoffTargetSchema = {
  type: 'object',
  required: ['to', 'organization', 'basis'],
  properties: {
    to: { type: 'string' },
    organization: { type: 'string' },
    basis: { type: 'string' },
  },
} as const;

/** Кто отвечает за заявку, кому её можно передать и что уже передано. */
export const responsibilitySchema = {
  type: 'object',
  required: ['kind', 'title', 'basis', 'targets', 'handoffs'],
  properties: {
    kind: { type: 'string' },
    title: { type: 'string' },
    basis: { type: 'string' },
    next: { type: 'string' },
    organization: { type: 'string' },
    targets: { type: 'array', items: handoffTargetSchema },
    handoffs: { type: 'array', items: handoffSchema },
  },
} as const;

export const requestSchema = {
  type: 'object',
  required: [
    'id',
    'number',
    'category',
    'priority',
    'status',
    'title',
    'description',
    'target',
    'createdAt',
    'reactionDueAt',
    'resolutionDueAt',
    'dueAt',
    'overdue',
    'reactionOverdue',
    'reporters',
    'incident',
    'reopenCount',
    'attachments',
    'history',
  ],
  properties: {
    id: { type: 'string' },
    number: { type: 'string' },
    category: { type: 'string' },
    categoryTitle: { type: 'string' },
    categoryShort: { type: 'string' },
    priority: { type: 'string' },
    status: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    target: { type: 'string' },
    createdAt: { type: 'string' },
    reactionDueAt: { type: 'string' },
    resolutionDueAt: { type: 'string' },
    dueAt: { type: 'string' },
    overdue: { type: 'boolean' },
    reactionOverdue: { type: 'boolean' },
    deadlineBasis: { type: 'string' },
    workerNote: { type: 'string' },
    autoConfirmAt: { type: 'string' },
    reporters: { type: 'integer' },
    incident: { type: 'boolean' },
    reopenCount: { type: 'integer' },
    rating: { type: 'integer' },
    attachments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          token: { type: 'string' },
          transcript: { type: 'string' },
        },
      },
    },
    assigneeId: { type: 'string' },
    assigneeName: { type: 'string' },
    hint: { type: 'string' },
    mine: { type: 'boolean' },
    canKnock: { type: 'boolean' },
    knocked: { type: 'boolean' },
    spread: {
      type: 'object',
      properties: {
        affected: { type: 'integer' },
        fine: { type: 'integer' },
        verdict: { type: 'string' },
      },
    },
    survey: {
      type: 'array',
      items: {
        type: 'object',
        properties: { number: { type: 'integer' }, state: { type: 'string' } },
      },
    },
    risk: { type: 'string' },
    riskReason: { type: 'string' },
    history: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          at: { type: 'string' },
          status: { type: 'string' },
          role: { type: 'string' },
          speaker: { type: 'string' },
          kind: { type: 'string' },
          comment: { type: 'string' },
          onSite: { type: 'boolean' },
          attachments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string' },
                token: { type: 'string' },
                transcript: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** Имена исполнителей, назначенных на эти заявки. */
export const staffNames = async (deps: AppDeps, requests: readonly ServiceRequest[]): Promise<Map<string, string>> => {
  const names = new Map<string, string>();
  const wanted = new Set(requests.map((request) => request.assigneeId).filter((id): id is string => Boolean(id)));

  if (wanted.size === 0) return names;

  for (const buildingId of new Set(requests.map((request) => request.buildingId))) {
    for (const person of await deps.repository.listResidents(buildingId)) {
      if (wanted.has(person.id)) names.set(person.id, person.displayName);
    }
  }

  return names;
};

/** Объявление для клиента: адресат приходит словами. */
export const serializeAnnouncement = (announcement: Announcement) => ({
  id: announcement.id,
  title: announcement.title,
  body: announcement.body,
  createdAt: announcement.createdAt.toISOString(),
  audience: describeAudience(announcementAudience(announcement)),
  recipients: announcement.recipientIds.length,
  ...(announcement.works
    ? {
        works: {
          category: announcement.works.category,
          from: announcement.works.from.toISOString(),
          until: announcement.works.until.toISOString(),
        },
      }
    : {}),
});

export const announcementSchema = {
  type: 'object',
  required: ['id', 'title', 'body', 'createdAt', 'audience', 'recipients'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    body: { type: 'string' },
    createdAt: { type: 'string' },
    audience: { type: 'string' },
    recipients: { type: 'integer' },
    works: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        from: { type: 'string' },
        until: { type: 'string' },
      },
    },
  },
} as const;

/** Плановые работы, из-за которых заявка не заводилась. */
export const plannedSchema = {
  type: 'object',
  required: ['title', 'category', 'until', 'message'],
  properties: {
    title: { type: 'string' },
    category: { type: 'string' },
    until: { type: 'string' },
    message: { type: 'string' },
  },
};

/** Итоги за промежуток. Один и тот же вид у текущего периода и у прошлого. */
export const periodSummarySchema = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    created: { type: 'integer' },
    closed: { type: 'integer' },
    confirmed: { type: 'integer' },
    rejected: { type: 'integer' },
    mergedReports: { type: 'integer' },
    inTimeRate: { type: 'number' },
    averageHours: { type: 'number' },
    missed: { type: 'integer' },
    rated: { type: 'integer' },
    averageRating: { type: 'number' },
  },
};

/** Схема сводки. */
export const reportSchema = {
  type: 'object',
  required: ['buildingId', 'summary', 'period', 'previous', 'categories', 'assignees', 'objects', 'incidents'],
  properties: {
    buildingId: { type: 'string' },
    summary: {
      type: 'object',
      properties: {
        total: { type: 'integer' },
        open: { type: 'integer' },
        overdue: { type: 'integer' },
        confirmed: { type: 'integer' },
        rejected: { type: 'integer' },
        mergedReports: { type: 'integer' },
      },
    },
    period: periodSummarySchema,
    previous: periodSummarySchema,
    categories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          title: { type: 'string' },
          total: { type: 'integer' },
          overdue: { type: 'integer' },
          overdueRate: { type: 'number' },
        },
      },
    },
    assignees: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          assigneeId: { type: 'string' },
          displayName: { type: 'string' },
          completed: { type: 'integer' },
          reopened: { type: 'integer' },
          reopenRate: { type: 'number' },
          rated: { type: 'integer' },
          averageRating: { type: 'number' },
        },
      },
    },
    objects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          requests: { type: 'integer' },
          reopened: { type: 'integer' },
        },
      },
    },
    incidents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          requestId: { type: 'string' },
          number: { type: 'string' },
          title: { type: 'string' },
          reporters: { type: 'integer' },
        },
      },
    },
    inspections: {
      type: 'object',
      properties: {
        finished: { type: 'integer' },
        overdue: { type: 'integer' },
        found: { type: 'integer' },
      },
    },
    daily: { type: 'array', items: { type: 'integer' } },
    handoffs: { type: 'array', items: handoffSchema },
  },
} as const;

/** Собрание для клиента: доли уже посчитаны, клиенту считать нечего. */
export const serializePoll = (view: PollView) => ({
  id: view.poll.id,
  kind: view.poll.kind,
  mode: view.poll.mode ?? 'meeting',
  ...(view.poll.noticeId ? { noticeId: view.poll.noticeId } : {}),
  ...(view.poll.protocolId ? { protocolId: view.poll.protocolId } : {}),
  kindTitle: POLL_RULES[view.poll.kind].title,
  title: view.poll.title,
  question: view.poll.question,
  opensAt: view.poll.opensAt.toISOString(),
  closesAt: view.poll.closesAt.toISOString(),
  open: view.open,
  turnout: view.result.turnout,
  quorum: view.result.quorum,
  passed: view.result.passed,
  totalArea: view.result.totalArea,
  votedArea: view.result.votedArea,
  areaToQuorum: view.areaToQuorum,
  quorumShare: POLL_RULES[view.poll.kind].quorum,
  shares: view.result.shares,
  support: view.result.support,
  // Собрание читают жильцы: им идёт правило словами, а не номер статьи.
  basis: view.poll.kind === 'qualified' ? PLAIN.qualified : PLAIN.quorum,
  ...(view.poll.closedAt ? { closedAt: view.poll.closedAt.toISOString() } : {}),
  ...(view.myChoice ? { myChoice: view.myChoice } : {}),
  // Голос подал сосед по квартире: человек должен знать, что заменит его.
  ...(view.votedBy ? { votedBy: view.votedBy } : {}),
});

export const serializeInitiative = (view: InitiativeView) => ({
  id: view.initiative.id,
  kind: view.initiative.kind,
  kindTitle: POLL_RULES[view.initiative.kind].title,
  title: view.initiative.title,
  question: view.initiative.question,
  createdAt: view.initiative.createdAt.toISOString(),
  signatures: view.signatures,
  share: view.standing.share,
  demandShare: INITIATIVE_SHARE,
  basis: PLAIN.initiative,
  areaToDemand: view.standing.areaToDemand,
  enough: view.standing.enough,
  mine: view.mine,
  author: view.author,
  ...(view.initiative.pollId ? { pollId: view.initiative.pollId } : {}),
});

export const initiativeSchema = {
  type: 'object',
  required: ['id', 'kind', 'kindTitle', 'title', 'question', 'createdAt', 'signatures', 'share', 'enough'],
  properties: {
    id: { type: 'string' },
    kind: { type: 'string' },
    kindTitle: { type: 'string' },
    title: { type: 'string' },
    question: { type: 'string' },
    createdAt: { type: 'string' },
    signatures: { type: 'integer' },
    share: { type: 'number' },
    demandShare: { type: 'number' },
    basis: { type: 'string' },
    areaToDemand: { type: 'number' },
    enough: { type: 'boolean' },
    mine: { type: 'boolean' },
    author: { type: 'boolean' },
    pollId: { type: 'string' },
  },
} as const;

export const pollSchema = {
  type: 'object',
  required: ['id', 'kind', 'kindTitle', 'title', 'question', 'opensAt', 'closesAt', 'open', 'turnout', 'quorum', 'passed', 'shares'],
  properties: {
    id: { type: 'string' },
    kind: { type: 'string' },
    kindTitle: { type: 'string' },
    title: { type: 'string' },
    question: { type: 'string' },
    opensAt: { type: 'string' },
    closesAt: { type: 'string' },
    closedAt: { type: 'string' },
    open: { type: 'boolean' },
    turnout: { type: 'number' },
    quorum: { type: 'boolean' },
    passed: { type: 'boolean' },
    totalArea: { type: 'number' },
    votedArea: { type: 'number' },
    areaToQuorum: { type: 'number' },
    quorumShare: { type: 'number' },
    support: { type: 'number' },
    basis: { type: 'string' },
    myChoice: { type: 'string' },
    votedBy: { type: 'string' },
    mode: { type: 'string' },
    noticeId: { type: 'string' },
    protocolId: { type: 'string' },
    shares: {
      type: 'object',
      properties: {
        for: { type: 'number' },
        against: { type: 'number' },
        abstain: { type: 'number' },
      },
    },
  },
} as const;

/** Пустые итоги: собрание только что объявлено, голосов ещё нет. */
export const emptyResult = {
  totalArea: 0,
  votedArea: 0,
  turnout: 0,
  quorum: false,
  shares: { for: 0, against: 0, abstain: 0 },
  support: 0,
  passed: false,
};

/** Счётчик для клиента: с подписью, единицей и прошлым показанием. */
export const serializeMeter = (state: MeterState, now: Date) => ({
  verification: verificationState(state.meter, now),
  id: state.meter.id,
  kind: state.meter.kind,
  title: METER_RULES[state.meter.kind].title,
  unit: METER_RULES[state.meter.kind].unit,
  decimals: METER_RULES[state.meter.kind].decimals,
  serial: state.meter.serial,
  submittedThisMonth: state.submittedThisMonth,
  lastConsumption: state.lastConsumption,
  ...(state.last ? { lastValue: state.last.value, lastAt: state.last.at.toISOString() } : {}),
  ...(state.meter.verifiedUntil ? { verifiedUntil: state.meter.verifiedUntil.toISOString() } : {}),
});

/** Что умеет считать прибор: список берётся из правил домена. */
export const METER_KINDS = Object.keys(METER_RULES) as MeterKind[];

/** Общедомовой прибор в том же виде, что и квартирный: экран у них один. */
export const serializeHouseMeter = (state: HouseMeterState, now: Date) => ({
  verification: verificationState(state.meter, now),
  id: state.meter.id,
  kind: state.meter.kind,
  title: METER_RULES[state.meter.kind].title,
  unit: METER_RULES[state.meter.kind].unit,
  decimals: METER_RULES[state.meter.kind].decimals,
  serial: state.meter.serial,
  submittedThisMonth: state.submittedThisMonth,
  lastConsumption: state.lastConsumption,
  ...(state.last ? { lastValue: state.last.value, lastAt: state.last.at.toISOString() } : {}),
  ...(state.meter.verifiedUntil ? { verifiedUntil: state.meter.verifiedUntil.toISOString() } : {}),
});

export const meterSchema = {
  type: 'object',
  required: [
    'id',
    'kind',
    'title',
    'unit',
    'decimals',
    'serial',
    'submittedThisMonth',
    'lastConsumption',
    'verification',
  ],
  properties: {
    id: { type: 'string' },
    kind: { type: 'string' },
    title: { type: 'string' },
    unit: { type: 'string' },
    decimals: { type: 'integer' },
    serial: { type: 'string' },
    submittedThisMonth: { type: 'boolean' },
    lastConsumption: { type: 'number' },
    lastValue: { type: 'number' },
    lastAt: { type: 'string' },
    verifiedUntil: { type: 'string' },
    verification: { type: 'string', enum: ['ok', 'soon', 'expired'] },
  },
} as const;

/** Категории заявок: список берётся из правил домена, а не выписывается заново. */
export const CATEGORIES = Object.keys(CATEGORY_RULES) as RequestCategory[];
export const STATUSES: RequestStatus[] = [
  'new',
  'accepted',
  'in_progress',
  'needs_info',
  'done',
  'confirmed',
  'rejected',
  'withdrawn',
];

export const noticeSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['kind', 'title', 'on'],
    properties: { kind: { type: 'string' }, title: { type: 'string' }, on: { type: 'boolean' } },
  },
} as const;

/** Насколько длинный период отдаётся за один запрос. */
export const RANGE_MAX_DAYS = 365;

const DAY_MS = 86_400_000;

/**
 * Границы периода из строки запроса. Схема проверяет каждую дату по
 * отдельности, а порядок и длину пары, кроме неё, проверить негде.
 * @throws {ServiceError}
 */
export const rangeOf = (query: { from?: string; to?: string }): { from: Date; to: Date } | undefined => {
  if (!query.from || !query.to) return undefined;

  const from = new Date(query.from);
  const to = new Date(query.to);

  if (to.getTime() <= from.getTime()) {
    throw new ServiceError('range_invalid', 'Конец периода должен быть позже начала');
  }

  if (to.getTime() - from.getTime() > RANGE_MAX_DAYS * DAY_MS) {
    throw new ServiceError('range_invalid', `За один запрос отдаётся не больше ${RANGE_MAX_DAYS} дней`);
  }

  return { from, to };
};

/** Календарный период запроса, а без него, прошедший месяц дома. */
export const periodFrom = async (
  deps: RoutesDeps,
  query: { from?: string; to?: string },
  buildingId: string,
): Promise<{ from: Date; to: Date }> =>
  rangeOf(query) ?? lastMonth(deps.now(), await zoneOf(deps, buildingId));

/**
 * Идентификатор в адресе: длину видно до похода в хранилище. Предел тот же,
 * что у самого Fastify (`maxParamLength`), иначе схема до него не доходит.
 */
const pathIdSchema = { type: 'string', minLength: 1, maxLength: 100 } as const;

export const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: pathIdSchema },
} as const;

/** Пункт осмотра адресуется парой: осмотр и его порядковый номер. */
export const idIndexParamsSchema = {
  type: 'object',
  required: ['id', 'index'],
  properties: { id: pathIdSchema, index: { type: 'integer', minimum: 0 } },
} as const;

/** Код объекта с наклейки в адресе. */
export const startParamParamsSchema = {
  type: 'object',
  required: ['startParam'],
  properties: { startParam: { type: 'string', minLength: 1, maxLength: 512 } },
} as const;

/** Гостевой код в адресе. */
export const codeParamsSchema = {
  type: 'object',
  required: ['code'],
  properties: { code: { type: 'string', minLength: 1, maxLength: 32 } },
} as const;

/** Строка запроса, в которой сотрудник выбирает дом. */
export const buildingQuerySchema = { type: 'object', properties: { buildingId: buildingIdSchema } } as const;

/** Квартира, к которой привязали жильца. */
export const boundApartmentSchema = {
  type: 'object',
  required: ['apartmentId', 'number', 'alreadyBound'],
  properties: {
    apartmentId: { type: 'string' },
    number: { type: 'integer' },
    alreadyBound: { type: 'boolean' },
  },
} as const;

/** Заявка после изменения: имена исполнителей подтягиваются к ней же. */
export const requestView = async (deps: RoutesDeps, request: ServiceRequest, viewer?: Resident) =>
  serializeRequest(request, deps.now(), await staffNames(deps, [request]), viewer);

/** Заголовки выгрузки: имя файла кириллицей понимают все клиенты. */
export const asAttachment = (reply: FastifyReply, name: string, contentType: string): FastifyReply =>
  reply
    .type(contentType)
    .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);

/** Тарифы дома. */
export const tariffSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['kind', 'title', 'unit', 'value', 'own'],
    properties: {
      kind: { type: 'string' },
      title: { type: 'string' },
      unit: { type: 'string' },
      value: { type: 'number' },
      own: { type: 'boolean' },
      since: { type: 'string' },
      basis: { type: 'string' },
    },
  },
} as const;

export const serializeTariff = (view: TariffView) => ({
  kind: view.kind,
  title: view.title,
  unit: view.unit,
  value: view.value,
  own: view.own,
  ...(view.since ? { since: view.since.toISOString() } : {}),
  // Откуда значение: заданное организацией от умолчания продукта не отличить иначе.
  // Ключевая ставка приходит от Банка России в любом случае: организация её вносит,
  // а не назначает, поэтому «тариф не задан» к ней не относится.
  basis: view.kind === 'key_rate' ? BASIS.keyRate : view.own ? undefined : BASIS.defaultTariff,
});

