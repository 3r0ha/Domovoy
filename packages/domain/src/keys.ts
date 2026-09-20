import type { MeterKind } from './meters.js';
import type { ConsumptionBasis } from './norms.js';
import type { NoticeKind, RequestCategory, RequestStatus } from './types.js';
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
