import { DomainError, type ErrorCode } from '@domovoy/domain';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';

/**
 * Ответ на отказ продукта. Таблица исчерпывающая: новый код домена не соберётся,
 * пока для него не выбран статус.
 */
export const STATUS_BY_CODE = {
  // не приняли данные
  assignee_required: 400,
  text_empty: 400,
  bad_works: 400,
  candidate_elsewhere: 400,
  code_not_apartment: 400,
  code_not_valid: 400,
  comment_required: 400,
  contact_not_verified: 400,
  description_required: 400,
  description_too_long: 400,
  device_not_openable: 400,
  device_not_sensor: 400,
  device_not_viewable: 400,
  email_invalid: 400,
  file_broken: 400,
  file_empty: 400,
  file_type_not_allowed: 400,
  initiative_empty: 400,
  initiative_too_long: 400,
  invalid_identifier: 400,
  message_empty: 400,
  no_upstairs: 400,
  phone_invalid: 400,
  poll_period_invalid: 400,
  rating_out_of_range: 400,
  reading_decreased: 400,
  reading_invalid: 400,
  reading_too_large: 400,
  serial_required: 400,
  target_required: 400,
  tariff_invalid: 400,
  time_zone_invalid: 400,
  reception_invalid: 400,
  reception_empty: 400,
  topic_empty: 400,
  topic_too_long: 400,
  wrong_object: 400,
  // Неизвестный вид уведомления это значение поля, а не пропавший объект.
  notice_unknown: 400,
  // сессия есть, а профиля за ней уже нет
  resident_not_found: 401,
  // нет прав
  buildings_for_staff_only: 403,
  duty_for_staff_only: 403,
  forbidden: 403,
  rating_not_allowed: 403,
  role_not_allowed: 403,
  role_self_change: 403,
  // не найдено
  apartment_unknown: 404,
  building_not_found: 404,
  building_unknown: 404,
  candidate_unknown: 404,
  handoff_not_found: 404,
  partner_unknown: 404,
  code_not_found: 404,
  device_not_found: 404,
  file_not_found: 404,
  initiative_not_found: 404,
  inspection_not_found: 404,
  item_not_found: 404,
  meter_not_found: 404,
  poll_not_found: 404,
  request_not_found: 404,
  ticket_not_found: 404,
  visit_not_found: 404,
  resident_unknown: 404,
  staff_unknown: 404,
  upstairs_unknown: 404,
  user_unknown: 404,
  // состояние не позволяет
  already_knocked: 409,
  apartment_exists: 409,
  apartment_not_bound: 409,
  areas_missing: 409,
  building_exists: 409,
  chat_taken: 409,
  house_meter_exists: 409,
  initiative_closed: 409,
  initiative_exists: 409,
  inspection_finished: 409,
  meter_not_verified: 409,
  nothing_to_pay: 409,
  nothing_to_remind: 409,
  nothing_to_send: 409,
  poll_closed: 409,
  poll_not_open: 409,
  poll_open: 409,
  reading_duplicate: 409,
  request_closed: 409,
  ticket_closed: 409,
  request_stale: 409,
  transition_not_allowed: 409,
  visit_closed: 409,
  visit_started: 409,
  visit_exists: 409,
  handoff_exists: 409,
  complaint_exists: 409,
  escalation_not_possible: 409,
  slot_taken: 409,
  // слишком велико
  file_too_large: 413,
  message_too_long: 413,
  note_too_long: 413,
  payload_too_long: 413,
  // слишком часто
  too_many_requests: 429,
  // внешняя служба не отвечает
  code_not_issued: 503,
  devices_unavailable: 503,
  stickers_unavailable: 503,
  payments_unavailable: 503,
  vision_unavailable: 503,
} satisfies Record<ErrorCode, number>;

const statusForDomainError = (code: ErrorCode): number => STATUS_BY_CODE[code];

/**
 * Отказы самого адаптера. Предметной области они неизвестны: так отвечает
 * сервер, когда до сценария дело не дошло или подключённая служба молчит.
 * Клиент читает их так же, как коды домена, поэтому они тоже перечислены.
 */
export const SERVICE_STATUS = {
  /** Запрос не сошёлся со схемой: не то поле, не тот тип, не та длина. */
  schema_mismatch: 400,
  /** Границы периода выгрузки не годятся: перевёрнуты или шире года. */
  range_invalid: 400,
  /** Тело запроса не разобралось: битый JSON, подстановка в прототип, не та длина. */
  body_not_json: 400,
  /** Речь в записи не разобрана: тишина, шум или чужой язык. */
  speech_not_recognized: 400,
  /** Нет общего секрета: домофония, вебхук платформы, метрики. */
  unauthorized: 401,
  /** Такого адреса в API нет. */
  not_found: 404,
  /** Хранилище не приняло запись: такой объект уже есть. */
  storage_conflict: 409,
  /** Содержимое прислано типом, который сервер не разбирает. */
  media_type_unsupported: 415,
  /** Региональная программа капитального ремонта не отвечает. */
  capital_unavailable: 503,
  /** Расшифровка речи не подключена или служба не ответила. */
  speech_unavailable: 503,
  /** Сбой сервера: подробности уходят в журнал, наружу только код. */
  internal: 500,
} as const;

export type ServiceCode = keyof typeof SERVICE_STATUS;

/** Отказ адаптера: предметная область такого случая не знает. */
export class ServiceError extends Error {
  constructor(
    readonly code: ServiceCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

/** Заявки нет или она не видна этому человеку: ответ один и тот же. */
export const requestNotFound = (): DomainError => new DomainError('request_not_found', 'Заявка не найдена');

type AnswerCode = ServiceCode | ErrorCode;

const statusFor = (code: AnswerCode): number =>
  code in SERVICE_STATUS ? SERVICE_STATUS[code as ServiceCode] : STATUS_BY_CODE[code as ErrorCode];

/**
 * Отказы транспорта: до сценария дело не дошло, запрос отвергла сама библиотека.
 * Наружу уходит код из таблиц, а не её внутреннее имя.
 */
const TRANSPORT_ANSWERS: Record<string, { code: AnswerCode; message: string }> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { code: 'media_type_unsupported', message: 'Такой тип содержимого не принимается' },
  FST_ERR_CTP_BODY_TOO_LARGE: { code: 'payload_too_long', message: 'Тело запроса больше разрешённого' },
  FST_ERR_CTP_INVALID_JSON_BODY: { code: 'body_not_json', message: 'Тело запроса не разобралось как JSON' },
  FST_ERR_CTP_EMPTY_JSON_BODY: { code: 'body_not_json', message: 'Тело запроса не разобралось как JSON' },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: { code: 'body_not_json', message: 'Длина тела не совпала с заявленной' },
  FST_ERR_BAD_URL: { code: 'schema_mismatch', message: 'Адрес запроса разобрать не удалось' },
};

/** Нарушение уникального индекса в хранилище: SQLSTATE 23505. */
const UNIQUE_VIOLATION = '23505';

/** Отказ без своего кода: он выбирается по статусу, иначе это сбой сервера. */
const CODE_BY_STATUS: Record<number, AnswerCode> = {
  400: 'schema_mismatch',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'payload_too_long',
  415: 'media_type_unsupported',
  429: 'too_many_requests',
};

/** Единый ответ на отказ: коды домена по смыслу, остальное как внутренняя ошибка. */
export const domainErrorHandler =
  (fastify: FastifyInstance) =>
  (error: FastifyError, _request: unknown, reply: FastifyReply): FastifyReply => {
    if (error instanceof DomainError) {
      return reply.code(statusForDomainError(error.code)).send({ error: error.code, message: error.message });
    }

    if (error instanceof ServiceError) {
      return reply.code(SERVICE_STATUS[error.code]).send({ error: error.code, message: error.message });
    }

    // Запрос не прошёл схему: наружу идёт код из таблицы, а не имя ошибки Fastify.
    if (error.validation) {
      return reply.code(400).send({ error: 'schema_mismatch', message: error.message });
    }

    const raw = typeof error.code === 'string' ? error.code : undefined;
    const transport = raw === undefined ? undefined : TRANSPORT_ANSWERS[raw];

    if (transport) {
      return reply.code(statusFor(transport.code)).send({ error: transport.code, message: transport.message });
    }

    if (raw === UNIQUE_VIOLATION) {
      return reply
        .code(statusFor('storage_conflict'))
        .send({ error: 'storage_conflict', message: 'Такая запись уже есть' });
    }

    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    const known = CODE_BY_STATUS[status];

    // Журнал нужен только для сбоя: отвергнутый запрос это обычная работа.
    if (!known) {
      fastify.log.error(error);

      return reply.code(status >= 400 && status < 500 ? status : 500).send({
        error: 'internal',
        message: 'Внутренняя ошибка',
      });
    }

    return reply.code(status).send({ error: known, message: error.message });
  };
