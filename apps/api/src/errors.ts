import { DomainError, type ErrorCode } from '@domovoy/domain';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';

/**
 * Ответ на отказ продукта. Таблица исчерпывающая: новый код домена не соберётся,
 * пока для него не выбран статус.
 */
export const STATUS_BY_CODE = {
  // не приняли данные
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
  notice_unknown: 404,
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


/** Единый ответ на отказ: коды домена по смыслу, остальное как внутренняя ошибка. */
export const domainErrorHandler =
  (fastify: FastifyInstance) =>
  (error: FastifyError, _request: unknown, reply: FastifyReply): FastifyReply => {
    if (error instanceof DomainError) {
      return reply.code(statusForDomainError(error.code)).send({ error: error.code, message: error.message });
    }

    fastify.log.error(error);

    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    const message = status < 500 ? error.message : 'Внутренняя ошибка';

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return reply.code(status).send({ error: error.code ?? 'internal', message });
  };
