/** Часовой пояс дома. */
export const DEFAULT_TIME_ZONE = 'Europe/Moscow';

/** Роли участников. Определяют, кто какие переходы заявки может выполнять. */
export type Role = 'resident' | 'dispatcher' | 'technician' | 'manager' | 'contractor';

/** Что можно отключить. Аварии и свои заявки отключить нельзя. */
export type NoticeKind = 'meters' | 'works' | 'polls' | 'news';

export const NOTICE_KINDS: readonly NoticeKind[] = ['meters', 'works', 'polls', 'news'];

export const NOTICE_TITLES: Readonly<Record<NoticeKind, string>> = {
  meters: 'Показания счётчиков',
  works: 'Плановые работы',
  polls: 'Собрания собственников',
  news: 'Объявления дома',
};

/** Свои сотрудники управляющей компании: подрядчик в них не входит. */
export const COMPANY_ROLES: readonly Role[] = ['dispatcher', 'technician', 'manager'];

/** Подрядчик видит только порученные ему наряды. */
export const isCompanyStaff = (role: Role): boolean => COMPANY_ROLES.includes(role);

/** Состояния заявки. */
export type RequestStatus =
  | 'new'
  | 'accepted'
  | 'in_progress'
  | 'needs_info'
  | 'done'
  | 'confirmed'
  | 'rejected'
  | 'withdrawn';

/** Завершённые состояния: из них переходов нет. */
export const FINAL_STATUSES: readonly RequestStatus[] = ['confirmed', 'rejected', 'withdrawn'];

export type RequestCategory =
  | 'plumbing'
  | 'heating'
  | 'electricity'
  | 'elevator'
  | 'cleaning'
  | 'yard'
  | 'safety'
  | 'document'
  | 'other';

/** Срочность влияет на срок: аварии считаются в часах, плановые работы, в днях. */
export type Priority = 'emergency' | 'normal' | 'planned';

/** Объект, к которому относится заявка. */
export type RequestTarget =
  | {
      kind: 'apartment';
      apartmentId: string;
      /** Номер квартиры на момент подачи. */
      number?: number;
    }
  | { kind: 'entrance'; buildingId: string; entrance: number }
  | { kind: 'riser'; buildingId: string; entrance: number; riser: number }
  | {
      kind: 'equipment';
      buildingId: string;
      equipmentId: string;
      /** Как оборудование называют люди: «Лифт, подъезд 1». */
      title?: string;
    }
  | { kind: 'building'; buildingId: string };

/** Вложение к заявке. */
export interface Attachment {
  kind: 'photo' | 'voice' | 'file';
  /** Идентификатор файла: у платформы либо наш, с приставкой `file:`. */
  token: string;
  /** Расшифровка голосового: без неё заявка приходит без описания. */
  transcript?: string;
}

export interface RequestEvent {
  at: Date;
  status: RequestStatus;
  role: Role;
  actorId: string;
  /** Сообщение в переписке по заявке: состояние оно не меняет. */
  kind?: 'message';
  comment?: string;
  /** Исполнитель, назначенный этим переходом. */
  assigneeId?: string;
  /** Что мастер приложил к переходу. */
  attachments?: Attachment[];
  /** Мастер отсканировал наклейку объекта: он был на месте. */
  onSite?: boolean;
}

/** Обращение соседа, склеенное с уже открытой заявкой. */
export interface RequestJoin {
  residentId: string;
  at: Date;
}

export interface ServiceRequest {
  id: string;
  number: string;
  buildingId: string;
  authorId: string;
  category: RequestCategory;
  priority: Priority;
  target: RequestTarget;
  /** Короткая суть заявки, одна строка. */
  title: string;
  description: string;
  status: RequestStatus;
  createdAt: Date;
  /** Срок первой реакции: диспетчер обязан принять заявку до него. */
  reactionDueAt: Date;
  /** Срок выполнения работ. */
  resolutionDueAt: Date;
  assigneeId?: string;
  history: RequestEvent[];
  /** Соседи, сообщившие о той же проблеме. */
  joinedBy: RequestJoin[];
  /** Соседи, у которых всё работает. */
  notAffected: RequestJoin[];
  attachments: Attachment[];
  /** Когда спросили соседа сверху: постучать к нему можно один раз. */
  knockedAt?: Date;
  /** Сколько раз жилец не принял работу. */
  reopenCount: number;
  /** Оценка работы жильцом, 1…5. */
  rating?: number;
}

/** Кому адресовано объявление. Совпадает по смыслу с адресом заявки, но без квартиры. */
export type AnnouncementAudience =
  | { kind: 'building'; buildingId: string }
  | { kind: 'entrance'; buildingId: string; entrance: number }
  | { kind: 'riser'; buildingId: string; entrance: number; riser: number };

export interface Apartment {
  id: string;
  buildingId: string;
  /** Код из квитанции, которым жилец привязывает квартиру к себе. */
  code?: string;
  number: number;
  entrance: number;
  /** Стояк: часть подъезда, по которой отключают воду. */
  riser: number;
  /** Площадь, квадратные метры. */
  area?: number;
  /** Сколько человек проживает: по этому числу считается норматив. */
  residents?: number;
}

/** Отказы продукта: по коду адаптер выбирает ответ. */
export type ErrorCode =
  // не найдено
  | 'apartment_unknown'
  | 'building_not_found'
  | 'building_unknown'
  | 'candidate_unknown'
  | 'handoff_not_found'
  | 'partner_unknown'
  | 'code_not_found'
  | 'device_not_found'
  | 'file_not_found'
  | 'initiative_not_found'
  | 'inspection_not_found'
  | 'item_not_found'
  | 'meter_not_found'
  | 'notice_unknown'
  | 'poll_not_found'
  | 'request_not_found'
  | 'ticket_not_found'
  | 'visit_not_found'
  | 'resident_unknown'
  | 'staff_unknown'
  | 'upstairs_unknown'
  | 'user_unknown'
  // нет прав
  | 'buildings_for_staff_only'
  | 'duty_for_staff_only'
  | 'forbidden'
  | 'rating_not_allowed'
  | 'role_not_allowed'
  | 'role_self_change'
  // состояние не позволяет
  | 'already_knocked'
  | 'building_exists'
  | 'chat_taken'
  | 'initiative_closed'
  | 'initiative_exists'
  | 'inspection_finished'
  | 'nothing_to_pay'
  | 'nothing_to_remind'
  | 'nothing_to_send'
  | 'poll_closed'
  | 'poll_not_open'
  | 'poll_open'
  | 'reading_duplicate'
  | 'meter_not_verified'
  | 'house_meter_exists'
  | 'request_closed'
  | 'ticket_closed'
  | 'transition_not_allowed'
  | 'visit_closed'
  | 'visit_started'
  | 'visit_exists'
  | 'handoff_exists'
  | 'slot_taken'
  // слишком много или слишком велико
  | 'file_too_large'
  | 'message_too_long'
  | 'note_too_long'
  | 'payload_too_long'
  | 'too_many_requests'
  // служба не отвечает
  | 'code_not_issued'
  | 'devices_unavailable'
  | 'stickers_unavailable'
  | 'payments_unavailable'
  | 'vision_unavailable'
  // сессия
  | 'resident_not_found'
  // не приняли данные
  | 'bad_works'
  | 'candidate_elsewhere'
  | 'code_not_apartment'
  | 'code_not_valid'
  | 'comment_required'
  | 'contact_not_verified'
  | 'description_required'
  | 'device_not_openable'
  | 'device_not_sensor'
  | 'device_not_viewable'
  | 'email_invalid'
  | 'file_broken'
  | 'file_empty'
  | 'file_type_not_allowed'
  | 'initiative_empty'
  | 'initiative_too_long'
  | 'invalid_identifier'
  | 'message_empty'
  | 'no_upstairs'
  | 'phone_invalid'
  | 'poll_period_invalid'
  | 'reading_invalid'
  | 'reading_decreased'
  | 'reading_too_large'
  | 'description_too_long'
  | 'rating_out_of_range'
  | 'serial_required'
  | 'target_required'
  | 'tariff_invalid'
  | 'time_zone_invalid'
  | 'reception_invalid'
  | 'reception_empty'
  | 'topic_empty'
  | 'topic_too_long'
  | 'wrong_object'
  | 'apartment_exists'
  | 'apartment_not_bound'
  | 'areas_missing'
  | 'request_stale';

export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
