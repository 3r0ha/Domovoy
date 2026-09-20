import {
  DEFAULT_TIME_ZONE,
  DomainError,
  METER_RULES,
  chargesFor,
  excessOutageHours,
  leftToPay,
  type Charges,
  type MeterKind,
  type Outage,
} from '@domovoy/domain';

import { endOfPeriod, monthBefore, periodConsumption, startOfPeriod } from './consumption.js';
import { commonNeedsShare, knownForCommon } from './house-meters.js';
import { tariffsFor } from './tariffs.js';
import { zoneOf } from './zone.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Оплата. За портом банк или платёжный шлюз управляющей компании. */
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

/** Оплата начисленного. @throws {DomainError} если платить нечем или нечего. */
export const payCharges = async (deps: AppDeps, resident: Resident): Promise<Receipt> => {
  const charges = await chargesForResident(deps, resident);
  const amount = leftToPay(charges);
  const apartmentId = resident.apartmentId;

  if (!apartmentId) throw new DomainError('apartment_not_bound', 'Платежи принадлежат помещению');
  if (amount <= 0) throw new DomainError('nothing_to_pay', 'За этот месяц всё оплачено');

  return paying(deps, (gateway) => gateway.pay({ apartmentId, period: charges.period, amount }));
};
