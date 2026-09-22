import {
  formatMoney,
  DomainError,
  PAYMENT_DUE_DAY,
  chargesFor,
  leftToPay,
  overdueDays,
  penaltyFor,
  roundMoney,
  type Apartment,
  type Meter,
  type Reading,
} from '@domovoy/domain';

import type { Translate } from '@domovoy/i18n';

import { chargesForResident, paying, periodOf, type Receipt } from './billing.js';
import { endOfPeriod, periodConsumption } from './consumption.js';
import { commonNeedsShare, knownForCommon, type KnownForCommon } from './house-meters.js';
import { counted, speak, speakDefault } from './language.js';
import { noopNotifier, notifyAbout, notifyResident } from './notifier.js';
import { tariffsAt } from './tariffs.js';
import { apartmentsOf } from './apartments.js';
import { houseHintFor } from './buildings.js';
import { zoneOf } from './zone.js';
import type { Resident, TariffRecord } from './repository.js';
import type { AppDeps } from './use-cases.js';

export interface DebtPeriod {
  /** Месяц в виде `ГГГГ-ММ`. */
  period: string;
  charged: number;
  paid: number;
  /** Сколько осталось заплатить за этот месяц. */
  left: number;
  /** Сколько дней прошло с наступления срока оплаты. */
  overdueDays: number;
  /** Пени на этот месяц. Первый месяц просрочки их не даёт. */
  penalty: number;
}

export interface Debt {
  /** Долг по начислениям, без пеней. */
  total: number;
  /** Пени на весь долг: их считают отдельно и платят отдельной строкой. */
  penalty: number;
  periods: DebtPeriod[];
}

/** За сколько прошлых месяцев считаем долг. */
export const DEBT_MONTHS = 6;

const shiftMonth = (period: string, back: number): string => {
  const [year, month] = period.split('-').map(Number);
  const at = new Date(Date.UTC(year!, month! - 1 - back, 1));

  return `${at.getUTCFullYear()}-${`${at.getUTCMonth() + 1}`.padStart(2, '0')}`;
};

/** Прочитанное один раз на весь дом. */
export interface KnownForDebt {
  zone: string;
  tariffs: readonly TariffRecord[];
  meters?: readonly Meter[];
  readings?: readonly Reading[];
  /** Квартиры дома, прочитанные один раз на весь обход. */
  apartments?: readonly Apartment[];
  /** Всё для общедомового расчёта: узел учёта и площади дома. */
  common?: KnownForCommon;
}

/** Всё о доме для расчёта долгов, прочитанное один раз. */
export const knownForDebt = async (
  deps: AppDeps,
  buildingId: string,
  zone: string,
): Promise<KnownForDebt & { apartments: readonly Apartment[] }> => {
  const apartments = await deps.repository.listApartments(buildingId);
  const meters = await deps.repository.listMetersByApartments(apartments.map((apartment) => apartment.id));
  const readings = await deps.repository.listReadingsFor(meters.map((meter) => meter.id));

  const [tariffs, common] = await Promise.all([
    deps.repository.listTariffs(buildingId),
    knownForCommon(deps, buildingId, { zone, apartments, meters, readings }),
  ]);

  return { zone, tariffs, apartments, meters, readings, common };
};

/** Долг по прошлым месяцам: срок по текущему ещё не наступил. @throws {DomainError} */
export const arrearsFor = async (
  deps: AppDeps,
  resident: Resident,
  months = DEBT_MONTHS,
  known?: KnownForDebt,
): Promise<Debt> => {
  const own = apartmentsOf(resident);
  const inHouse = known?.apartments
    ? own.find((id) => known.apartments?.some((item) => item.id === id))
    : resident.apartmentId;

  if (!inHouse) {
    throw new DomainError('apartment_not_bound', 'Начисления принадлежат помещению, сначала привяжите квартиру');
  }

  const apartment =
    known?.apartments?.find((item) => item.id === inHouse) ?? (await deps.repository.findApartment(inHouse));
  const buildingId = apartment?.buildingId ?? resident.buildingId ?? deps.defaultBuildingId;
  const now = deps.now();
  const zone = known?.zone ?? (await zoneOf(deps, buildingId));
  const tariffs = known?.tariffs ?? (await deps.repository.listTariffs(buildingId));
  const current = periodOf(now, zone);

  const meters =
    known?.meters?.filter((meter) => meter.apartmentId === inHouse) ?? (await deps.repository.listMeters(inHouse));
  const readings =
    known?.readings ?? (await deps.repository.listReadingsFor(meters.map((meter) => meter.id)));

  const periods: DebtPeriod[] = [];
  const common = known?.common ?? (await knownForCommon(deps, buildingId));

  const wanted: string[] = [];

  for (let back = months; back >= 1; back -= 1) wanted.push(shiftMonth(current, back));

  // Шлюз спрашивают сразу обо всех месяцах: ответы друг от друга не зависят.
  const payments = deps.payments
    ? await Promise.all(wanted.map((period) => paying(deps, (gateway) => gateway.paid(inHouse, period))))
    : wanted.map(() => 0);

  for (const [index, period] of wanted.entries()) {
    const consumption = periodConsumption({
      meters,
      readings,
      period,
      zone,
      residents: apartment?.residents ?? 0,
      area: apartment?.area ?? 0,
    });

    const share = commonNeedsShare(common, inHouse, period);

    const charges = chargesFor({
      period,
      area: apartment?.area ?? 0,
      consumption,
      ...(share.length > 0 ? { common: share } : {}),
      tariffs: tariffsAt(tariffs, endOfPeriod(period, zone)),
      paid: payments[index] ?? 0,
    });

    const left = roundMoney(charges.total - charges.paid);

    if (left <= 0) continue;

    const late = overdueDays(dueAt(period), now);

    periods.push({
      period,
      charged: charges.total,
      paid: charges.paid,
      left,
      overdueDays: late,
      penalty: penaltyFor(left, late, tariffsAt(tariffs, endOfPeriod(period, zone)).keyRate),
    });
  }

  const sum = (pick: (item: DebtPeriod) => number): number =>
    roundMoney(periods.reduce((total, item) => total + pick(item), 0));

  return { total: sum((item) => item.left), penalty: sum((item) => item.penalty), periods };
};

/** До какого момента платят за месяц: десятое число следующего. */
export const dueAt = (period: string): Date => {
  const [year, month] = period.split('-').map(Number);

  return new Date(Date.UTC(year!, month ?? 1, PAYMENT_DUE_DAY));
};

/** Месяц расчётного периода, 1…12. Непонятный период даёт ноль: его покажут как есть. */
const monthIn = (period: string): number => {
  const month = Number(period.split('-')[1]);

  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 0;
};

/** «июль 2026». Без перевода месяц называется по-русски. */
export const periodTitle = (period: string, t: Translate = speakDefault()): string => {
  const month = monthIn(period);

  return month === 0 ? period : t('app.debt.period', { месяц: t(`app.month.${month}`), год: period.slice(0, 4) });
};

/** Месяц в родительном падеже: «с июня по июль 2026». */
const monthOf = (period: string, withYear: boolean, t: Translate): string => {
  const month = monthIn(period);

  if (month === 0) return period;

  const name = t(`app.monthOf.${month}`);

  return withYear ? t('app.debt.period', { месяц: name, год: period.slice(0, 4) }) : name;
};

/** Месяцы одной строкой, с общим годом в конце. */
export const debtRange = (debt: Debt, t: Translate = speakDefault()): string | undefined => {
  const first = debt.periods[0];
  const last = debt.periods.at(-1);

  if (!first || !last) return undefined;

  if (first.period === last.period) return periodTitle(first.period, t);

  const sameYear = first.period.slice(0, 4) === last.period.slice(0, 4);

  return t('app.debt.range', {
    от: monthOf(first.period, !sameYear, t),
    до: periodTitle(last.period, t),
  });
};

/** Долг без одного месяца: он уже показан отдельной суммой к оплате. */
export const withoutPeriod = (debt: Debt, period: string): Debt => {
  const periods = debt.periods.filter((item) => item.period !== period);
  const sum = (pick: (item: DebtPeriod) => number): number =>
    roundMoney(periods.reduce((total, item) => total + pick(item), 0));

  return { total: sum((item) => item.left), penalty: sum((item) => item.penalty), periods };
};


export const formatDebt = (debt: Debt, t: Translate = speakDefault()): string | undefined => {
  if (debt.total <= 0) return undefined;

  const lines = debt.periods.map((item) =>
    t(item.penalty > 0 ? 'app.debt.linePenalty' : 'app.debt.line', {
      период: periodTitle(item.period, t),
      сумма: formatMoney(item.left, t),
      пени: formatMoney(item.penalty, t),
    }),
  );

  // «Пени» и «погашение» знают не все: в переписке это штраф и общая сумма.
  const tail =
    debt.penalty > 0
      ? t('app.debt.penalty', {
          пени: formatMoney(debt.penalty, t),
          итого: formatMoney(roundMoney(debt.total + debt.penalty), t),
        })
      : '';

  return t('app.debt.total', { сумма: formatMoney(debt.total, t), строки: lines.join('\n') }) + tail;
};

/** Долг одной строкой: столько же смысла, сколько в разборе по месяцам. */
export const formatDebtShort = (debt: Debt, t: Translate = speakDefault()): string | undefined => {
  if (debt.total <= 0) return undefined;

  // «Пени» знают не все: для человека это штраф за просрочку.
  return t(debt.penalty > 0 ? 'app.debt.shortPenalty' : 'app.debt.short', {
    месяцы: counted(t, 'months', debt.periods.length),
    сумма: formatMoney(debt.total, t),
    пени: formatMoney(debt.penalty, t),
  });
};

/** Оплата долга: каждый месяц закрывается своим платежом. @throws {DomainError} */
export const payArrears = async (deps: AppDeps, resident: Resident): Promise<Receipt[]> => {
  const debt = await arrearsFor(deps, resident);

  if (debt.total <= 0) throw new DomainError('nothing_to_pay', 'Долга за прошлые месяцы нет');

  const receipts: Receipt[] = [];

  for (const period of debt.periods) {
    receipts.push(
      await paying(deps, (gateway) =>
        gateway.pay({
          apartmentId: resident.apartmentId!,
          period: period.period,
          amount: roundMoney(period.left + period.penalty),
        }),
      ),
    );
  }

  return receipts;
};

/** За сколько дней до срока оплаты напоминать о начислениях этого месяца. */
export const PAYMENT_NOTICE_DAYS = 3;

/**
 * Напоминание о сроке оплаты. Напоминание после срока уже поздно: человек
 * узнаёт о нём, когда пени пошли. Поэтому за несколько дней до десятого числа
 * продукт называет сумму этого месяца тем, у кого она не закрыта.
 */
export const remindBeforeDue = async (deps: AppDeps, buildingId: string): Promise<Resident[]> => {
  const now = deps.now();
  const zone = await zoneOf(deps, buildingId);
  const day = Number(new Intl.DateTimeFormat('en-CA', { timeZone: zone, day: 'numeric' }).format(now));

  if (day !== PAYMENT_DUE_DAY - PAYMENT_NOTICE_DAYS) return [];

  const apartments = await deps.repository.listApartments(buildingId);
  const residents = await deps.repository.listResidentsByApartments(apartments.map((flat) => flat.id));
  const notifier = deps.notifier ?? noopNotifier;
  const reminded: Resident[] = [];

  for (const resident of residents) {
    const charges = await chargesForResident(deps, resident).catch(() => undefined);
    const left = charges ? leftToPay(charges) : 0;

    if (!charges || left <= 0) continue;

    const t = speak(resident);

    await notifyAbout(notifier, resident, t('app.notice.due', { сумма: formatMoney(left, t), день: PAYMENT_DUE_DAY }), {
      section: 'bill',
      mutable: 'debt',
    });

    reminded.push(resident);
  }

  return reminded;
};

/** Напоминание о долге: после срока оплаты и только должникам. */
export const remindAboutDebt = async (deps: AppDeps, buildingId: string): Promise<Resident[]> => {
  const now = deps.now();
  const zone = await zoneOf(deps, buildingId);

  if (Number(new Intl.DateTimeFormat('en-CA', { timeZone: zone, day: 'numeric' }).format(now)) <= PAYMENT_DUE_DAY) {
    return [];
  }

  const known = await knownForDebt(deps, buildingId, zone);
  const residents = await deps.repository.listResidentsByApartments(known.apartments.map((flat) => flat.id));
  const notifier = deps.notifier ?? noopNotifier;
  const reminded: Resident[] = [];
  // Дом и его квартиры для подсказки с адресом читаются один раз на всю рассылку.
  const hintOf = houseHintFor(deps, buildingId, known.apartments);

  for (const resident of residents) {
    const t = speak(resident);
    const text = formatDebt(await arrearsFor(deps, resident, DEBT_MONTHS, known), t);

    if (!text) continue;

    const house = await hintOf(resident);

    await notifyResident(
      notifier,
      resident,
      `${house ? `${house}\n` : ''}${t('app.notice.debt', { долг: text })}`,
      [],
      { section: 'bill' },
    );
    reminded.push(resident);
  }

  return reminded;
};
