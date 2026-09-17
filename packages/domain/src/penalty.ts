/**
 * Пени за просрочку платы. Порядок задан статьёй 155 Жилищного кодекса:
 * первый месяц бесплатно, дальше доля ключевой ставки за каждый день.
 */

import { roundMoney } from './numbers.js';

/** Сколько дней просрочки не считаются. */
export const PENALTY_FREE_DAYS = 30;

/** До этого дня включительно ставка мягче. */
export const PENALTY_SOFT_UNTIL_DAY = 90;

const SOFT_SHARE = 1 / 300;
const HARD_SHARE = 1 / 130;

/** Пени на сумму долга за столько дней просрочки. Ставка долей: 0.16 это 16% годовых. */
export const penaltyFor = (amount: number, overdueDays: number, keyRate: number): number => {
  if (amount <= 0 || keyRate <= 0) return 0;

  const soft = Math.min(Math.max(0, overdueDays - PENALTY_FREE_DAYS), PENALTY_SOFT_UNTIL_DAY - PENALTY_FREE_DAYS);
  const hard = Math.max(0, overdueDays - PENALTY_SOFT_UNTIL_DAY);

  return roundMoney(amount * keyRate * (soft * SOFT_SHARE + hard * HARD_SHARE));
};

/** Сколько дней прошло с наступления срока оплаты. Отрицательного не бывает. */
export const overdueDays = (dueAt: Date, now: Date): number =>
  Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / (24 * 3600_000)));
