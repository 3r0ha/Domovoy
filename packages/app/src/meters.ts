import {
  DomainError,
  READING_WINDOW,
  meterKindKey,
  meterUnitKey,
  acceptReading,
  consumption,
  daysLeftInWindow,
  isReadingWindow,
  compareToNeighbours,
  isCompanyStaff,
  formatMeterValue,
  isSameMonth,
  isSpike,
  NEIGHBOURS_FOR_COMPARISON,
  verificationState,
  type Meter,
  type MeterKind,
  type Reading,
} from '@domovoy/domain';

import type { Translate } from '@domovoy/i18n';

import { apartmentsOf } from './apartments.js';
import { houseHint, servedBy } from './buildings.js';
import { counted, speak } from './language.js';
import { recordAction } from './audit.js';
import { wanting } from './notices.js';
import { noopNotifier, notifyAbout } from './notifier.js';
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

/** Как называют прибор словами: по этим словам показание узнаётся прямо в переписке. */
const METER_WORDS: Readonly<Record<string, RegExp>> = {
  cold_water: /хвс|холодн(ая|ой|ую)?( вод\w+)?/iu,
  hot_water: /гвс|горяч(ая|ей|ую)?( вод\w+)?/iu,
  electricity: /электр\w*|свет(?!оф)\w*|счётчик света/iu,
  heating: /отоплен\w*|тепл(о|а)(?!ый)/iu,
  gas: /газ(?!он)\w*/iu,
};

/** О поломке, а не о показании: такие слова снимают разбор числом. */
const NOT_A_READING =
  /не работа|не крут|сломал|слома|теч[ёе]т|протека|подтека|отключ|напор|еле идёт|поверк|замен|сорв|прорв|(?<!\p{L})нет(?!\p{L})[^.!?]{0,24}(вод|свет|газ|тепл|отоплен)/iu;

/** Назван ли в сообщении прибор учёта: по этому отказ отличают от обращения. */
export const meterNamedIn = (text: string): boolean =>
  !NOT_A_READING.test(text) && Object.values(METER_WORDS).some((words) => words.test(text));

/** Какие приборы названы в сообщении. */
export const meterKindsIn = (text: string): MeterKind[] =>
  Object.entries(METER_WORDS)
    .filter(([, words]) => words.test(text))
    .map(([kind]) => kind as MeterKind);

/** Показание, названное словами: число из той же фразы и приборы, к которым оно подходит. */
export interface ReadingInWords {
  /** Приборы названного вида. Больше одного означает, что выбирает человек. */
  meters: MeterState[];
  value: number;
}

/** Разряды в показании разделяют пробелом: «12 350» это одно число, а не два. Пробел бывает и неразрывным. */
const joined = (text: string): string => text.replace(/(\d)\s(?=\d{3}(?!\d))/gu, '$1');

/** Число показания. Знак минус входит в разбор, чтобы отказать, а не взять модуль. */
const NUMBER = /(?<![\d,.])(-?\d{1,9}(?:[.,]\d{1,4})?)(?![\d,.])/gu;

/** Где в сообщении назван прибор: по этому месту число и достаётся тому, о ком речь. */
const namedMeters = (text: string): { kind: string; at: number }[] =>
  Object.keys(METER_WORDS)
    .map((kind) => ({ kind, at: METER_WORDS[kind]!.exec(text)?.index }))
    .filter((named): named is { kind: string; at: number } => named.at !== undefined)
    .sort((one, other) => one.at - other.at);

/**
 * Число, сказанное об этом приборе: то, что стоит после его названия и до
 * названия следующего. Число перед первым названием тоже его: «12350 хвс».
 */
const valueFor = (text: string, from: number, to: number, first: boolean): number | undefined => {
  let before: number | undefined;

  for (const found of text.matchAll(NUMBER)) {
    const at = found.index;
    const value = Number(found[1]!.replace(',', '.'));

    if (at >= to) break;
    if (at >= from) return value;
    if (first) before = value;
  }

  return before;
};

/**
 * Показание, поданное словами: «холодная вода 12345». Приборов в сообщении
 * может быть несколько: «гвс 9800 хвс 12350» это два показания. Пусто означает,
 * что прибор не назван, числа нет или речь о поломке. Сами показания не
 * подаются: их принимает обычный путь подачи со всеми проверками.
 */
export const readingInWords = async (
  deps: AppDeps,
  resident: Resident,
  text: string,
): Promise<ReadingInWords[]> => {
  if (!resident.apartmentId || NOT_A_READING.test(text)) return [];

  // Номер заявки состоит из тех же цифр: по нему показание подавать нечего.
  if (/[\p{L}\d]+-\d{4}-\d{4}/u.test(text)) return [];

  const said = joined(text);
  const named = namedMeters(said);

  if (named.length === 0) return [];

  const now = deps.now();
  const all = await metersFor(deps, resident).catch(() => []);
  const found: ReadingInWords[] = [];

  for (const [at, { kind, at: from }] of named.entries()) {
    const value = valueFor(said, from, named[at + 1]?.at ?? said.length, at === 0);

    // Число за пределами табло или с минусом остаётся показанием: его отвергнет
    // подача с объяснением, а не тишина. Иначе «хвс 99999999» становилось заявкой.
    if (value === undefined || !Number.isFinite(value)) continue;

    const meters = all.filter(
      (state) => state.meter.kind === kind && verificationState(state.meter, now) !== 'expired',
    );

    if (meters.length > 0) found.push({ meters, value });
  }

  return found;
};

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
  /**
   * Что сказать о расходе. Возвращается ответом, а не уведомлением: человек
   * ждёт этот текст после принятого показания, а уведомление опережает его.
   */
  advice?: string;
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
  const spent = consumption(previous, saved);
  // Расход прошлого периода этой же квартиры: он уже прочитан вместе с историей.
  const before = previous ? consumption(rest[1], previous) : 0;

  const t = speak(command.resident);

  const advice = spike
    ? spikeAdvice(t, meter, spent)
    : // Сравнение с соседями стоит трёх запросов по всему дому, поэтому его делаем,
      // только когда расход вырос: о неизменившемся жильцу уже говорили в прошлый раз.
      spent > before
      ? await neighbourAdvice(deps, t, meter, spent, flat?.buildingId)
      : undefined;

  return { reading: saved, consumption: spent, spike, ...(advice ? { advice } : {}) };
};

/** Расход заметно выше соседского. Дом берётся у квартиры прибора, а не у подавшего. */
const neighbourAdvice = async (
  deps: AppDeps,
  t: Translate,
  meter: Meter,
  spent: number,
  buildingId: string | undefined,
): Promise<string | undefined> => {
  if (spent <= 0 || !buildingId) return undefined;

  const apartments = await deps.repository.listApartments(buildingId);
  const meters = await deps.repository.listMetersByApartments(apartments.map((apartment) => apartment.id));
  const same = meters.filter((item) => item.kind === meter.kind && item.id !== meter.id);

  if (same.length < NEIGHBOURS_FOR_COMPARISON) return undefined;

  const readings = await deps.repository.listReadingsFor(same.map((item) => item.id));

  const neighbours = same.flatMap((item) => {
    const [last, previous] = readings.filter((reading) => reading.meterId === item.id);

    return last ? [consumption(previous, last)] : [];
  });

  const compared = compareToNeighbours(spent, neighbours);

  if (!compared.unusual) return undefined;

  return t('app.meters.aboveNeighbours', {
    номер: meter.serial,
    расход: formatMeterValue(spent),
    единица: t(meterUnitKey(meter.kind)),
    соседи: formatMeterValue(compared.median),
  });
};

/** Резкий скачок расхода: повод предупредить. */
const spikeAdvice = (t: Translate, meter: Meter, spent: number): string =>
  t('app.meters.spike', {
    прибор: t(meterKindKey(meter.kind)),
    расход: formatMeterValue(spent),
    единица: t(meterUnitKey(meter.kind)),
  });

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

  const name = (t: Translate, meter: Meter): string =>
    t('app.meters.name', { прибор: t(meterKindKey(meter.kind)), номер: meter.serial });

  for (const resident of wanting(residents, 'meters')) {
    const mine = new Set(apartmentsOf(resident).filter((id) => apartments.some((item) => item.id === id)));
    const own = meters.filter((meter) => mine.has(meter.apartmentId));
    const waiting = meterStates(own, readings, now, zone).filter((state) => !state.submittedThisMonth);
    const expired = waiting.filter((state) => verificationState(state.meter, now) === 'expired');
    const pending = waiting.filter((state) => verificationState(state.meter, now) !== 'expired');

    if (pending.length === 0 && expired.length === 0) continue;

    const left = daysLeftInWindow(now, READING_WINDOW, zone);
    const t = speak(resident);
    const ask =
      pending.length > 0
        ? t('app.meters.remind', {
            осталось: counted(t, 'days.left', left),
            приборы: pending.map((state) => `  ${name(t, state.meter)}`).join('\n'),
          })
        : '';
    const verify =
      expired.length > 0
        ? t('app.meters.expired', { приборы: expired.map((state) => name(t, state.meter)).join(', ') })
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
