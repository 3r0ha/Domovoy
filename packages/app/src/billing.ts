import {
  DEFAULT_TIME_ZONE,
  DomainError,
  METER_RULES,
  chargeDetailKey,
  chargesFor,
  consumptionBasisKey,
  excessOutageHours,
  leftToPay,
  meterKindKey,
  meterUnitKey,
  roundMoney,
  type ChargeLine,
  type Charges,
  type MeterKind,
  type Outage,
} from '@domovoy/domain';

import { numberIn, type Translate } from '@domovoy/i18n';

import { endOfPeriod, monthBefore, periodConsumption, startOfPeriod } from './consumption.js';
import { commonNeedsShare, knownForCommon } from './house-meters.js';
import { tariffsFor } from './tariffs.js';
import { zoneOf } from './zone.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Оплата. За портом банк или платёжный шлюз управляющей организации. */
export interface PaymentGateway {
  /** Подключение модельное: платёж никуда не уходит. */
  readonly model?: boolean;
  /** Возвращает ссылку на оплату либо подтверждение, если платёж прошёл сразу. */
  pay(input: { apartmentId: string; period: string; amount: number }): Promise<Receipt>;
  /** Сколько уже оплачено за период. */
  paid(apartmentId: string, period: string): Promise<number>;
  /** Что и когда платили по этому помещению, свежее первым. */
  history(apartmentId: string, limit?: number): Promise<Receipt[]>;
}

export interface Receipt {
  period: string;
  amount: number;
  at: Date;
  /** Куда отправить человека, если шлюз просит подтверждения. */
  url?: string;
  /** Номер кассового чека: его выдаёт шлюз по 54-ФЗ. */
  receiptNumber?: string;
  /** Где лежит сам чек. */
  receiptUrl?: string;
}

/** Обращение к платёжному шлюзу: его отказ превращается в «оплата недоступна». @throws {DomainError} */
export const paying = async <T>(deps: AppDeps, run: (gateway: PaymentGateway) => Promise<T>): Promise<T> => {
  if (!deps.payments) throw new DomainError('payments_unavailable', 'Оплата пока не подключена');

  try {
    return await run(deps.payments);
  } catch (error) {
    if (error instanceof DomainError) throw error;

    throw new DomainError('payments_unavailable', 'Платёжный шлюз сейчас не отвечает, попробуйте позже');
  }
};

/** Форматтеры по поясам: период считается на каждое показание, а поясов единицы. */
const periodFormats = new Map<string, Intl.DateTimeFormat>();

/** Месяц в виде `ГГГГ-ММ` по времени дома. */
export const periodOf = (at: Date, timeZone: string = DEFAULT_TIME_ZONE): string => {
  let format = periodFormats.get(timeZone);

  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
    periodFormats.set(timeZone, format);
  }

  return format.format(at);
};

/** Ресурс объявленных работ: у отключения он записан, у работ по электрике и теплу следует из категории. */
const resourceOf = (works: { category: string; resource?: MeterKind }): MeterKind | undefined => {
  if (works.resource) return works.resource;
  if (works.category === 'electricity' || works.category === 'heating') return works.category;

  return undefined;
};

/**
 * Перерывы по ресурсам, которые касались квартиры за расчётный период:
 * объявленные отключения дома, подъезда или стояка с этой квартирой в адресатах.
 */
const outagesFor = async (
  deps: AppDeps,
  house: string,
  apartmentId: string,
  period: { from: Date; to: Date },
): Promise<{ kind: MeterKind; excessHours: number }[]> => {
  const announced = await deps.repository.listWorksBetween(house, period.from, period.to);
  const outages: Outage[] = [];

  for (const announcement of announced) {
    const kind = announcement.works ? resourceOf(announcement.works) : undefined;
    const addressed = announcement.audience.kind === 'building' || announcement.recipientIds.includes(apartmentId);

    if (!kind || !addressed || !announcement.works) continue;

    outages.push({ kind, from: announcement.works.from, until: announcement.works.until });
  }

  return (Object.keys(METER_RULES) as MeterKind[])
    .map((kind) => ({ kind, excessHours: excessOutageHours(kind, outages, period) }))
    .filter((item) => item.excessHours > 0);
};

/** Начисление за месяц по показаниям жильца. @throws {DomainError} если квартира не привязана. */
export const chargesForResident = async (deps: AppDeps, resident: Resident): Promise<Charges> => {
  if (!resident.apartmentId) {
    throw new DomainError(
      'apartment_not_bound',
      'Начисления принадлежат помещению, сначала привяжите квартиру по коду из квитанции',
    );
  }

  const apartment = await deps.repository.findApartment(resident.apartmentId);
  const now = deps.now();
  const buildingId = apartment?.buildingId ?? resident.buildingId;
  const house = buildingId ?? deps.defaultBuildingId;
  const zone = await zoneOf(deps, buildingId);
  const period = monthBefore(periodOf(now, zone));
  const apartmentId = resident.apartmentId;
  const paid = deps.payments ? await paying(deps, (gateway) => gateway.paid(apartmentId, period)) : undefined;
  const common = commonNeedsShare(await knownForCommon(deps, house), resident.apartmentId, period);
  const meters = await deps.repository.listMeters(resident.apartmentId);
  const outages = await outagesFor(deps, house, apartmentId, {
    from: startOfPeriod(period, zone),
    to: endOfPeriod(period, zone),
  });

  return chargesFor({
    period,
    area: apartment?.area ?? 0,
    tariffs: await tariffsFor(deps, house, endOfPeriod(period, zone)),
    consumption: periodConsumption({
      meters,
      readings: await deps.repository.listReadingsFor(meters.map((meter) => meter.id)),
      period,
      zone,
      residents: apartment?.residents ?? 0,
      area: apartment?.area ?? 0,
    }),
    ...(common.length > 0 ? { common } : {}),
    ...(outages.length > 0 ? { outages } : {}),
    ...(paid === undefined ? {} : { paid }),
  });
};

/**
 * Название строки квитанции словами человека. Ключ и ресурс приходят из домена,
 * а строка без ключа остаётся такой, какой её посчитали.
 */
export const chargeLineTitle = (t: Translate, line: ChargeLine): string =>
  line.titleKey ? t(line.titleKey, line.kind ? { ресурс: t(meterKindKey(line.kind)) } : undefined) : line.title;

/** Чем посчитан расход строки: «по среднему», «по нормативу». */
export const chargeBasisTitle = (t: Translate, line: ChargeLine): string | undefined =>
  line.basis ? t(consumptionBasisKey(line.basis)) : undefined;

/**
 * Расшифровка строки квитанции словами человека: «12,4 м³ × 43,50 ₽».
 * Единица берётся по ресурсу строки, основание расчёта дописывается следом.
 */
export const chargeLineDetail = (t: Translate, line: ChargeLine): string | undefined => {
  if (!line.detailKey) return line.detail;

  const values: Record<string, string | number> = Object.fromEntries(
    Object.entries(line.detailValues ?? {}).map(([name, value]) => [
      name,
      typeof value === 'number' ? numberIn(t, value, { maximumFractionDigits: 3 }) : value,
    ]),
  );

  if (line.kind) values['единица'] = t(meterUnitKey(line.kind));

  const said = t(line.detailKey, values);
  const basis = chargeBasisTitle(t, line);

  return basis ? t(chargeDetailKey('basis'), { расчёт: said, основание: basis }) : said;
};

/** Сколько платежей показываем: за год. */
export const PAYMENTS_LIMIT = 12;

/** Что человек платил по своей квартире. @throws {DomainError} */
export const paymentHistory = async (
  deps: AppDeps,
  resident: Resident,
  limit = PAYMENTS_LIMIT,
): Promise<Receipt[]> => {
  if (!resident.apartmentId) {
    throw new DomainError('apartment_not_bound', 'Платежи принадлежат помещению, сначала привяжите квартиру');
  }

  if (!deps.payments) return [];

  return deps.payments.history(resident.apartmentId, limit);
};

/** Наименьшая сумма, которую есть смысл отправлять в шлюз. */
export const LEAST_PAYMENT = 1;

/**
 * Оплата начисленного. Сумма задаётся, когда человек платит часть: денег
 * бывает не на весь счёт, и частичный платёж лучше неоплаченного счёта.
 * @throws {DomainError} если платить нечем или нечего.
 */
export const payCharges = async (deps: AppDeps, resident: Resident, sum?: number): Promise<Receipt> => {
  const charges = await chargesForResident(deps, resident);
  const left = leftToPay(charges);
  const apartmentId = resident.apartmentId;

  if (!apartmentId) throw new DomainError('apartment_not_bound', 'Платежи принадлежат помещению');
  if (left <= 0) throw new DomainError('nothing_to_pay', 'За этот месяц всё оплачено');

  const amount = sum === undefined ? left : roundMoney(sum);

  if (sum !== undefined && (!Number.isFinite(amount) || amount < LEAST_PAYMENT)) {
    throw new DomainError('amount_invalid', `Сумма платежа начинается от ${LEAST_PAYMENT} ₽`);
  }

  if (amount > left) {
    throw new DomainError('amount_invalid', 'Сумма больше начисленного за месяц');
  }

  return paying(deps, (gateway) => gateway.pay({ apartmentId, period: charges.period, amount }));
};
