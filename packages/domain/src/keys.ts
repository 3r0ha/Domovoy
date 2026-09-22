import type { BasisKey } from './basis.js';
import type { BroadcastScope } from './broadcast.js';
import type { TicketStatus } from './helpdesk.js';
import type { InspectionKind } from './inspection.js';
import type { MeterKind } from './meters.js';
import type { ConsumptionBasis } from './norms.js';
import type { ResponsibleKind } from './responsibility.js';
import type {
  AnnouncementAudience,
  NoticeKind,
  RequestCategory,
  RequestStatus,
  RequestTarget,
} from './types.js';
import type { PollKind, VoteChoice } from './voting.js';

/**
 * Ключи перевода для названий домена. Сами названия домен по-прежнему отдаёт
 * по-русски: сотрудники, выгрузки и протоколы работают с ними напрямую. Ключ
 * нужен слою приложения, который показывает то же самое жильцу на его языке.
 */
const NAMESPACE = 'app';

/** Состояние заявки. */
export const statusKey = (status: RequestStatus): string => `${NAMESPACE}.status.${status}`;

/** Категория заявки. */
export const categoryKey = (category: RequestCategory): string => `${NAMESPACE}.category.${category}`;

/** Вид счётчика. */
export const meterKindKey = (kind: MeterKind): string => `${NAMESPACE}.meter.${kind}`;

/** Единица измерения прибора: у кириллицы «м³», у латиницы «m³». */
export const meterUnitKey = (kind: MeterKind): string => `${NAMESPACE}.meterUnit.${kind}`;

/** Чем посчитан расход: показанием, средним или нормативом. */
export const consumptionBasisKey = (basis: ConsumptionBasis): string => `${NAMESPACE}.basis.${basis}`;

/** Вид уведомлений, который человек может отключить. */
export const noticeKindKey = (kind: NoticeKind): string => `${NAMESPACE}.noticeKind.${kind}`;

/** Строка квитанции без счётчика: содержание, перерасчёт, общие нужды. */
export const chargeKey = (name: 'maintenance' | 'recalculation' | 'common'): string =>
  `${NAMESPACE}.charge.${name}`;

/** Короткое название категории: им подписаны кнопки отбора. */
export const categoryShortKey = (category: RequestCategory): string =>
  `${NAMESPACE}.categoryShort.${category}`;

/** Расшифровка строки квитанции: из чего сложилась сумма. */
export const chargeDetailKey = (name: 'rate' | 'area' | 'recalculation' | 'basis'): string =>
  `${NAMESPACE}.chargeDetail.${name}`;

/** Каким большинством решается вопрос собрания. */
export const pollRuleKey = (kind: PollKind): string => `${NAMESPACE}.pollRule.${kind}`;

/** Ответ на вопрос собрания: «за», «против», «воздержался». */
export const voteChoiceKey = (choice: VoteChoice): string => `${NAMESPACE}.poll.choice.${choice}`;

/** Адресат объявления: весь дом, подъезд, стояк. */
export const audienceKey = (kind: AnnouncementAudience['kind']): string => `${NAMESPACE}.audience.${kind}`;

/** Объект заявки. `apartmentAny` это квартира, номер которой неизвестен. */
export const targetKey = (kind: RequestTarget['kind'] | 'apartmentAny'): string =>
  `${NAMESPACE}.target.${kind}`;

/** Адресат рассылки. Адресные виды берут строку у объявления. */
export const scopeKey = (kind: Exclude<BroadcastScope['kind'], 'building' | 'entrance' | 'riser'> | 'pollAny'): string =>
  `${NAMESPACE}.scope.${kind}`;

/** Совет до приезда мастера по аварийной заявке. */
export const emergencyHintKey = (category: RequestCategory): string => `${NAMESPACE}.hint.${category}`;

/** Основание словами жильца: без номера закона и пункта. */
export const plainBasisKey = (key: BasisKey): string => `${NAMESPACE}.plain.${key}`;

/** Кто отвечает за проблему. */
export const responsibleKey = (kind: ResponsibleKind): string => `${NAMESPACE}.responsible.${kind}`;

/** Зона ответственности, из которой следует граница. */
export type ZoneName = 'elevator' | 'insideFlat' | 'flatBorder' | 'yard' | 'common';

/** Кто чинит, словами жильца. */
export const zoneKey = (name: ZoneName): string => `${NAMESPACE}.zone.${name}`;

/** Что делать дальше, если чинит не управляющая организация. */
export const zoneNextKey = (name: ZoneName): string => `${NAMESPACE}.zoneNext.${name}`;

/** Состояние обращения в поддержку. */
export const ticketStatusKey = (status: TicketStatus): string => `${NAMESPACE}.ticketStatus.${status}`;

/** Осмотр общего имущества: жилец видит его в ленте дома. */
export const inspectionKindKey = (kind: InspectionKind): string => `${NAMESPACE}.inspection.${kind}`;

/** Почему сказанное о заявке не стало делом. */
export const deedDeniedKey = (name: string): string => `${NAMESPACE}.deed.${name}`;
