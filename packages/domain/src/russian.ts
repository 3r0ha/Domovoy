import { numberIn, type Translate } from '@domovoy/i18n';

import { russian } from './moment.js';
import { roundMoney } from './numbers.js';

/**
 * Деньги: «5 240,00 ₽». Копейки округляются до печати, иначе бывает «-0,00 ₽».
 * Разделитель дробной части берётся у языка человека, валюта остаётся рублём.
 */
export const formatMoney = (amount: number, t: Translate = russian): string =>
  `${numberIn(t, roundMoney(amount), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

/** Показание прибора: «137,1». */
export const formatMeterValue = (value: number, t: Translate = russian): string =>
  numberIn(t, value, { maximumFractionDigits: 3 });

/** Площадь и доли: «40,5». */
export const formatArea = (value: number, t: Translate = russian): string =>
  numberIn(t, value, { maximumFractionDigits: 1 });

/** «1 заявка», «2 заявки», «5 заявок». */
export const plural = (count: number, one: string, few: string, many: string): string => {
  const tail = count % 100;
  const last = count % 10;

  if (tail >= 11 && tail <= 14) return `${count} ${many}`;
  if (last === 1) return `${count} ${one}`;
  if (last >= 2 && last <= 4) return `${count} ${few}`;

  return `${count} ${many}`;
};

/** «1 месяц», «2 месяца», «5 месяцев». */
export const months = (count: number): string => plural(count, 'месяц', 'месяца', 'месяцев');

/** «1 день», «2 дня», «5 дней». */
export const days = (count: number): string => plural(count, 'день', 'дня', 'дней');
