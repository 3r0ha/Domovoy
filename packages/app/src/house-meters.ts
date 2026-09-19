import {
  DomainError,
  METER_RULES,
  READING_WINDOW,
  acceptReading,
  commonNeedsFor,
  consumption,
  daysLeftInWindow,
  isCompanyStaff,
  isReadingWindow,
  isSameMonth,
  verificationState,
  type Apartment,
  type HouseMeter,
  type Meter,
  type MeterKind,
  type Reading,
} from '@domovoy/domain';

import { recordAction } from './audit.js';
import { actingHouse, assertServes } from './buildings.js';
import { periodOf } from './billing.js';
import { monthBefore, periodConsumption } from './consumption.js';
import { readingStates, type ReadingState } from './meter-state.js';
import { daysLeftPhrase } from './meters.js';
import { noopNotifier, notifyResident } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';
import { zoneOf } from './zone.js';

export type HouseMeterState = ReadingState<HouseMeter>;

const onlyStaff = (actor: Resident): void => {
  if (!isCompanyStaff(actor.role)) {
    throw new DomainError('forbidden', 'Узел учёта ведёт управляющая компания');
  }
};

/** Общедомовые приборы дома с их последними показаниями. @throws {DomainError} */
export const houseMetersFor = async (
  deps: AppDeps,
  actor: Resident,
  buildingId?: string,
): Promise<HouseMeterState[]> => {
  onlyStaff(actor);

  const house = actingHouse(deps, actor, buildingId);

  await assertServes(deps, actor, house);

  const meters = await deps.repository.listHouseMeters(house);
  const readings = await deps.repository.listHouseReadingsFor(meters.map((meter) => meter.id));

  return readingStates(meters, readings, deps.now(), await zoneOf(deps, house));
};

export interface AddHouseMeterCommand {
  kind: MeterKind;
  serial: string;
  verifiedUntil?: Date;
  buildingId?: string;
}

/** Заводит общедомовой прибор. @throws {DomainError} */
export const addHouseMeter = async (
  deps: AppDeps,
  actor: Resident,
  command: AddHouseMeterCommand,
): Promise<HouseMeter> => {
  if (actor.role !== 'manager') {
    throw new DomainError('forbidden', 'Общедомовой прибор заводит управляющий');
  }

  const serial = command.serial.trim();

  if (serial.length === 0) throw new DomainError('serial_required', 'Нужен заводской номер прибора');

  const buildingId = actingHouse(deps, actor, command.buildingId);

  // Узел учёта чужого дома искажает общедомовые нужды всем его квартирам.
  await assertServes(deps, actor, buildingId);

  const known = await deps.repository.listHouseMeters(buildingId);

  if (known.some((meter) => meter.kind === command.kind)) {
    throw new DomainError(
      'house_meter_exists',
      `Общедомовой прибор «${METER_RULES[command.kind].title}» уже заведён`,
    );
  }

  const saved = await deps.repository.saveHouseMeter({
    id: deps.createId(),
    buildingId,
    kind: command.kind,
    serial,
    ...(command.verifiedUntil ? { verifiedUntil: command.verifiedUntil } : {}),
  });

  await recordAction(deps, {
    actor,
    action: 'house_meter_added',
    buildingId,
    subject: saved.serial,
    details: METER_RULES[saved.kind].title,
  });

  return saved;
};

export interface SubmitHouseReadingCommand {
  meterId: string;
  value: number;
}

export interface HouseReadingResult {
  reading: Reading;
  consumption: number;
}

/** Показание узла учёта: его снимает сотрудник. @throws {DomainError} */
export const submitHouseReading = async (
  deps: AppDeps,
  actor: Resident,
  command: SubmitHouseReadingCommand,
): Promise<HouseReadingResult> => {
  onlyStaff(actor);

  const meter = await deps.repository.findHouseMeter(command.meterId);

  if (!meter) throw new DomainError('meter_not_found', 'Общедомовой прибор не найден');

  await assertServes(deps, actor, meter.buildingId);

  const history = await deps.repository.listHouseReadingsFor([meter.id]);
  const now = deps.now();
  const zone = await zoneOf(deps, meter.buildingId);
  const corrected = history[0] && isSameMonth(history[0].at, now, zone) ? history[0] : undefined;
  const previous = (corrected ? history.slice(1) : history)[0];

  const reading = acceptReading({
    id: deps.createId(),
    meter,
    value: command.value,
    at: now,
    submittedBy: actor.id,
    timeZone: zone,
    ...(previous ? { previous } : {}),
  });

  const saved = await deps.repository.saveHouseReading(reading);

  if (corrected) await deps.repository.deleteHouseReading(corrected.id);

  await recordAction(deps, {
    actor,
    action: 'house_reading_submitted',
    buildingId: meter.buildingId,
    subject: meter.serial,
    details: corrected ? `Было ${corrected.value}, стало ${saved.value}` : String(saved.value),
  });

  return { reading: saved, consumption: consumption(previous, saved) };
};

/** Что нужно знать про дом для общедомового расчёта. */
export interface KnownForCommon {
  zone: string;
  apartments: readonly Apartment[];
  meters: readonly Meter[];
  readings: readonly Reading[];
  houseMeters: readonly HouseMeter[];
  houseReadings: readonly Reading[];
}

/** Читает всё, что нужно для общедомового расчёта, одним заходом. */
export const knownForCommon = async (
  deps: AppDeps,
  buildingId: string,
  reuse?: Partial<Pick<KnownForCommon, 'zone' | 'apartments' | 'meters' | 'readings'>>,
): Promise<KnownForCommon> => {
  const apartments = reuse?.apartments ?? (await deps.repository.listApartments(buildingId));
  const meters =
    reuse?.meters ?? (await deps.repository.listMetersByApartments(apartments.map((item) => item.id)));
  const houseMeters = await deps.repository.listHouseMeters(buildingId);

  return {
    zone: reuse?.zone ?? (await zoneOf(deps, buildingId)),
    apartments,
    meters,
    readings: reuse?.readings ?? (await deps.repository.listReadingsFor(meters.map((meter) => meter.id))),
    houseMeters,
    houseReadings: await deps.repository.listHouseReadingsFor(houseMeters.map((meter) => meter.id)),
  };
};

/** Расход прибора за месяц: разница с показанием предыдущего периода. */
const spentIn = (readings: readonly Reading[], meterId: string, period: string, zone: string): number => {
  const own = readings
    .filter((reading) => reading.meterId === meterId)
    .map((reading) => ({ period: periodOf(reading.at, zone), value: reading.value }))
    .sort((left, right) => left.period.localeCompare(right.period))
    .filter((item) => item.period <= period);

  const last = own.at(-1);

  if (!last || last.period !== period) return 0;

  const before = own.at(-2);

  return before ? Math.max(0, Math.round((last.value - before.value) * 1000) / 1000) : 0;
};

/**
 * Доля помещения в общедомовом расходе за месяц по каждому ресурсу,
 * на который в доме стоит общедомовой прибор.
 */
export const commonNeedsShare = (
  known: KnownForCommon,
  apartmentId: string,
  period: string,
): { kind: MeterKind; amount: number }[] => {
  const apartment = known.apartments.find((item) => item.id === apartmentId);

  if (!apartment || known.houseMeters.length === 0) return [];

  const totalArea = known.apartments.reduce((sum, item) => sum + (item.area ?? 0), 0);

  return known.houseMeters
    .map((houseMeter) => ({
      kind: houseMeter.kind,
      amount: commonNeedsFor({
        house: spentIn(known.houseReadings, houseMeter.id, period, known.zone),
        apartments: billedToApartments(known, houseMeter.kind, period),
        area: apartment.area ?? 0,
        totalArea,
      }),
    }))
    .filter((item) => item.amount > 0);
};

/** Сколько начислено квартирам: без показаний берётся среднее или норматив. */
const billedToApartments = (known: KnownForCommon, kind: MeterKind, period: string): number => {
  let total = 0;

  for (const apartment of known.apartments) {
    const meters = known.meters.filter((meter) => meter.apartmentId === apartment.id && meter.kind === kind);

    if (meters.length === 0) continue;

    const [line] = periodConsumption({
      meters,
      readings: known.readings,
      period,
      zone: known.zone,
      residents: apartment.residents ?? 0,
      area: apartment.area ?? 0,
    });

    total += line?.amount ?? 0;
  }

  return Math.round(total * 1000) / 1000;
};

/**
 * Общедомовое за последний закрытый месяц узла учёта: по нему считается
 * текущая квитанция. Старше прошлого месяца не берём.
 */
export const latestCommonNeeds = (
  known: KnownForCommon,
  apartmentId: string,
  now: Date,
): { kind: MeterKind; amount: number }[] => {
  const current = periodOf(now, known.zone);
  const fresh = [current, monthBefore(current)];
  const period = known.houseReadings
    .map((reading) => periodOf(reading.at, known.zone))
    .filter((item) => fresh.includes(item))
    .sort()
    .at(-1);

  return period ? commonNeedsShare(known, apartmentId, period) : [];
};

/** Напоминание смене снять показание узла учёта: без него общедомовое не начислится. */
export const remindAboutHouseMeters = async (deps: AppDeps, buildingId: string): Promise<Resident[]> => {
  const now = deps.now();
  const zone = await zoneOf(deps, buildingId);

  if (!isReadingWindow(now, READING_WINDOW, zone)) return [];

  const meters = await deps.repository.listHouseMeters(buildingId);

  if (meters.length === 0) return [];

  const readings = await deps.repository.listHouseReadingsFor(meters.map((meter) => meter.id));
  const period = periodOf(now, zone);
  const waiting = meters.filter(
    (meter) =>
      !readings.some((reading) => reading.meterId === meter.id && periodOf(reading.at, zone) === period),
  );

  if (waiting.length === 0) return [];

  const notifier = deps.notifier ?? noopNotifier;
  const building = await deps.repository.findBuilding(buildingId);
  const staff = await deps.repository.listStaff(buildingId);
  const name = (meter: HouseMeter): string => `${METER_RULES[meter.kind].title} (${meter.serial})`;
  const expired = meters.filter((meter) => verificationState(meter, now) === 'expired');
  const soon = meters.filter((meter) => verificationState(meter, now) === 'soon');

  const text =
    `Не снято показание узла учёта${building ? ` по дому ${building.code}` : ''}: ` +
    `${daysLeftPhrase(daysLeftInWindow(now, READING_WINDOW, zone))}:\n` +
    `${waiting.map(name).join('\n  ')}\n\n` +
    'Без него общедомовые нужды в квитанции не начислятся.' +
    (expired.length > 0 ? `\n\nИстекла поверка: ${expired.map(name).join(', ')}.` : '') +
    (soon.length > 0 ? `\n\nСкоро поверка: ${soon.map(name).join(', ')}.` : '');

  for (const person of staff) await notifyResident(notifier, person, text);

  return staff;
};
