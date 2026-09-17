import {
  DomainError,
  METER_RULES,
  READING_WINDOW,
  acceptReading,
  consumption,
  daysLeftInWindow,
  isReadingWindow,
  compareToNeighbours,
  isCompanyStaff,
  formatMeterValue,
  isSameMonth,
  isSpike,
  verificationState,
  type Meter,
  type Reading,
} from '@domovoy/domain';

import { apartmentsOf } from './apartments.js';
import { houseHint, servedBy } from './buildings.js';
import { recordAction } from './audit.js';
import { wanting } from './notices.js';
import { noopNotifier, notifyAbout, notifyResident } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';
import { zoneOf } from './zone.js';

export interface MeterState {
  meter: Meter;
  /** Последнее принятое показание, если оно есть. */
  last?: Reading;
  /** Расход за прошлый период. */
  lastConsumption: number;
  /** Показание за текущий месяц уже подано. */
  submittedThisMonth: boolean;
}

/** Счётчики квартиры вместе с тем, что о них уже известно. */
export const metersFor = async (deps: AppDeps, resident: Resident): Promise<MeterState[]> => {
  if (!resident.apartmentId) {
    throw new DomainError(
      'apartment_not_bound',
      'Счётчики принадлежат помещению, сначала привяжите квартиру по коду из квитанции',
    );
  }

  const meters = await deps.repository.listMeters(resident.apartmentId);

  return meterStates(meters, await deps.repository.listReadingsFor(meters.map((meter) => meter.id)), deps.now(), await zoneOf(deps, resident.buildingId));
};

/** Приборы с их последними показаниями. */
const meterStates = (
  meters: readonly Meter[],
  readings: readonly Reading[],
  now: Date,
  zone: string,
): MeterState[] =>
  meters.map((meter) => {
    const own = readings.filter((reading) => reading.meterId === meter.id);
    const [last, previous] = own;

    return {
      meter,
      ...(last ? { last } : {}),
      lastConsumption: last ? consumption(previous, last) : 0,
      submittedThisMonth: last ? isSameMonth(last.at, now, zone) : false,
    };
  });

export interface ReadingPeriod {
  at: Date;
  value: number;
  /** Расход с прошлого показания. У первого показания расхода нет. */
  consumption: number;
}

/** Сколько показаний показываем: за год. */
export const HISTORY_LIMIT = 12;

/** Чей это счётчик: своей квартиры или дома, который человек обслуживает. */
export const ownMeter = async (deps: AppDeps, resident: Resident, meter: Meter): Promise<boolean> => {
  if (apartmentsOf(resident).includes(meter.apartmentId)) return true;

  if (!isCompanyStaff(resident.role)) return false;

  const apartment = await deps.repository.findApartment(meter.apartmentId);

  return apartment ? servedBy(resident, deps).includes(apartment.buildingId) : false;
};

/** История показаний прибора, от старых к новым. */
export const meterHistory = async (
  deps: AppDeps,
  resident: Resident,
  meterId: string,
  limit = HISTORY_LIMIT,
): Promise<ReadingPeriod[]> => {
  const meter = await deps.repository.findMeter(meterId);

  if (!meter) throw new DomainError('meter_not_found', 'Счётчик не найден');

  if (!(await ownMeter(deps, resident, meter))) {
    throw new DomainError('forbidden', 'Это счётчик другой квартиры');
  }

  const readings = [...(await deps.repository.listReadings(meterId))].sort(
    (left, right) => left.at.getTime() - right.at.getTime(),
  );

  return readings
    .map((reading, index) => ({
      at: reading.at,
      value: reading.value,
      consumption: consumption(readings[index - 1], reading),
    }))
    .slice(-limit);
};

export interface SubmitReadingCommand {
  resident: Resident;
  meterId: string;
  value: number;
}

export interface ReadingResult {
  reading: Reading;
  consumption: number;
  /** Расход резко выше обычного. */
  spike: boolean;
}

/** Подача показания. */
export const submitReading = async (deps: AppDeps, command: SubmitReadingCommand): Promise<ReadingResult> => {
  const meter = await deps.repository.findMeter(command.meterId);

  if (!meter) throw new DomainError('meter_not_found', 'Счётчик не найден');

  if (!(await ownMeter(deps, command.resident, meter))) {
    throw new DomainError('forbidden', 'Это счётчик другой квартиры');
  }

  const history = await deps.repository.listReadings(meter.id);
  const now = deps.now();
  const flat = await deps.repository.findApartment(meter.apartmentId);
  const zone = await zoneOf(deps, flat?.buildingId ?? command.resident.buildingId);
  const corrected = history[0] && isSameMonth(history[0].at, now, zone) ? history[0] : undefined;
  const rest = corrected ? history.slice(1) : history;
  const previous = rest[0];

  const reading = acceptReading({
    id: deps.createId(),
    meter,
    value: command.value,
    at: now,
    submittedBy: command.resident.id,
    timeZone: zone,
    ...(previous ? { previous } : {}),
  });

  const saved = await deps.repository.saveReading(reading);

  if (corrected) await deps.repository.deleteReading(corrected.id);

  await recordAction(deps, {
    actor: command.resident,
    action: corrected ? 'reading_deleted' : 'reading_submitted',
    subject: meter.serial,
    details: corrected ? `Было ${corrected.value}, стало ${saved.value}` : String(saved.value),
  });

  const spike = isSpike(rest, saved);

  if (spike) await warnAboutSpike(deps, meter, saved, previous);
  else await warnAboutNeighbours(deps, meter, consumption(previous, saved), command.resident);

  return { reading: saved, consumption: consumption(previous, saved), spike };
};

/** Расход заметно выше соседского. */
const warnAboutNeighbours = async (
  deps: AppDeps,
  meter: Meter,
  spent: number,
  resident: Resident,
): Promise<void> => {
  if (spent <= 0 || !resident.buildingId) return;

  const rule = METER_RULES[meter.kind];
  const apartments = await deps.repository.listApartments(resident.buildingId);
  const meters = await deps.repository.listMetersByApartments(apartments.map((apartment) => apartment.id));
  const same = meters.filter((item) => item.kind === meter.kind && item.id !== meter.id);
  const readings = await deps.repository.listReadingsFor(same.map((item) => item.id));

  const neighbours = same.flatMap((item) => {
    const [last, previous] = readings.filter((reading) => reading.meterId === item.id);

    return last ? [consumption(previous, last)] : [];
  });

  const compared = compareToNeighbours(spent, neighbours);

  if (!compared.unusual) return;

  await notifyResident(
    deps.notifier ?? noopNotifier,
    resident,
    `Расход по счётчику ${meter.serial} выше, чем у соседей: ` +
      `${formatMeterValue(spent)} ${rule.unit} против ${formatMeterValue(compared.median)} ${rule.unit} ` +
      'у похожих квартир.\n' +
      'Стоит проверить: чаще всего это подтекающий бачок или смеситель.',
  );
};



/** Резкий скачок расхода: повод предупредить. */
const warnAboutSpike = async (
  deps: AppDeps,
  meter: Meter,
  reading: Reading,
  previous: Reading | undefined,
): Promise<void> => {
  const rule = METER_RULES[meter.kind];
  const spent = consumption(previous, reading);

  await notifyResident(
    deps.notifier ?? noopNotifier,
    await deps.repository.findResident(reading.submittedBy),
    `Расход по счётчику «${rule.title}» за период: ${formatMeterValue(spent)} ${rule.unit}, ` +
      'это заметно больше обычного.\n' +
      'Если вы не расходовали больше обычного, проверьте краны и бачок: течь видно по счётчику ' +
      'раньше, чем по потолку соседей.',
  );
};

/** Кому напомнить о показаниях. */
export interface ReadingProgress {
  /** Квартир со счётчиками, которые ждут показаний. */
  total: number;
  /** Из них передали всё за этот месяц. */
  submitted: number;
}

/**
 * Сколько квартир дома уже передали показания. Имён в ответе нет.
 */
export const readingProgress = async (deps: AppDeps, buildingId: string): Promise<ReadingProgress | undefined> => {
  const now = deps.now();
  const zone = await zoneOf(deps, buildingId);

  if (!isReadingWindow(now, READING_WINDOW, zone)) return undefined;

  const apartments = await deps.repository.listApartments(buildingId);
  const ids = apartments.map((apartment) => apartment.id);
  const meters = await deps.repository.listMetersByApartments(ids);
  const readings = await deps.repository.listReadingsFor(meters.map((meter) => meter.id));

  let total = 0;
  let submitted = 0;

  for (const id of ids) {
    const own = meters.filter(
      (meter) => meter.apartmentId === id && verificationState(meter, now) !== 'expired',
    );

    if (own.length === 0) continue;

    total += 1;
    if (meterStates(own, readings, now, zone).every((state) => state.submittedThisMonth)) submitted += 1;
  }

  return { total, submitted };
};

/** Кто не подал показания за этот месяц. Окно подачи здесь не проверяется. */
export const pendingReadings = async (deps: AppDeps, buildingId: string): Promise<Resident[]> => {
  const now = deps.now();
  const zone = await zoneOf(deps, buildingId);
  const apartments = await deps.repository.listApartments(buildingId);
  const ids = apartments.map((apartment) => apartment.id);
  const inHouse = new Set(ids);
  const residents = await deps.repository.listResidentsByApartments(ids);
  const meters = await deps.repository.listMetersByApartments(ids);
  const readings = await deps.repository.listReadingsFor(meters.map((meter) => meter.id));

  return residents.filter((resident) => {
    const mine = new Set(apartmentsOf(resident).filter((id) => inHouse.has(id)));
    const own = meters.filter(
      (meter) => mine.has(meter.apartmentId) && verificationState(meter, now) !== 'expired',
    );

    return own.length > 0 && meterStates(own, readings, now, zone).some((state) => !state.submittedThisMonth);
  });
};

export const remindAboutReadings = async (deps: AppDeps, buildingId: string): Promise<Resident[]> => {
  const now = deps.now();
  const zone = await zoneOf(deps, buildingId);

  if (!isReadingWindow(now, READING_WINDOW, zone)) return [];

  const apartments = await deps.repository.listApartments(buildingId);
  const residents = await deps.repository.listResidentsByApartments(apartments.map((apartment) => apartment.id));
  const notifier = deps.notifier ?? noopNotifier;
  const reminded: Resident[] = [];

  const meters = await deps.repository.listMetersByApartments(apartments.map((apartment) => apartment.id));
  const readings = await deps.repository.listReadingsFor(meters.map((meter) => meter.id));

  const name = (meter: Meter): string => `${METER_RULES[meter.kind].title} (${meter.serial})`;

  for (const resident of wanting(residents, 'meters')) {
    const mine = new Set(apartmentsOf(resident).filter((id) => apartments.some((item) => item.id === id)));
    const own = meters.filter((meter) => mine.has(meter.apartmentId));
    const waiting = meterStates(own, readings, now, zone).filter((state) => !state.submittedThisMonth);
    const expired = waiting.filter((state) => verificationState(state.meter, now) === 'expired');
    const pending = waiting.filter((state) => verificationState(state.meter, now) !== 'expired');

    if (pending.length === 0 && expired.length === 0) continue;

    const left = daysLeftInWindow(now, READING_WINDOW, zone);
    const ask =
      pending.length > 0
        ? `Пора подать показания счётчиков, ${daysLeftPhrase(left)}:\n` +
          `${pending.map((state) => `  ${name(state.meter)}`).join('\n')}\n` +
          'Отправьте их командой /meters.'
        : '';
    const verify =
      expired.length > 0
        ? `Истекла поверка: ${expired.map((state) => name(state.meter)).join(', ')}.\n` +
          'До новой поверки начисляют по нормативу.'
        : '';

    const house = await houseHint(deps, resident, buildingId);

    await notifyAbout(notifier, resident, [house, ask, verify].filter(Boolean).join('\n\n'), {
      section: 'meters',
      mutable: 'meters',
    });

    reminded.push(resident);
  }

  return reminded;
};

/** «остался 1 день», «осталось 2 дня», «осталось 5 дней». */
export const daysLeftPhrase = (days: number): string => {
  const last = days % 10;
  const teen = days % 100 >= 11 && days % 100 <= 14;

  if (!teen && last === 1) return `остался ${days} день`;
  if (!teen && last >= 2 && last <= 4) return `осталось ${days} дня`;

  return `осталось ${days} дней`;
};
