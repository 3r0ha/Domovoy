import { median as middleOf } from './numbers.js';
import { DEFAULT_TIME_ZONE, DomainError } from './types.js';

/** Что считает прибор учёта. */
export type MeterKind = 'cold_water' | 'hot_water' | 'electricity' | 'heating' | 'gas';

export interface MeterRule {
  title: string;
  unit: string;
  /** Сколько цифр до запятой: по ним видно переполнение счётчика. */
  digits: number;
  /** Сколько знаков после запятой принимаем. */
  decimals: number;
}

export const METER_RULES: Readonly<Record<MeterKind, MeterRule>> = {
  cold_water: { title: 'Холодная вода', unit: 'м³', digits: 5, decimals: 3 },
  hot_water: { title: 'Горячая вода', unit: 'м³', digits: 5, decimals: 3 },
  electricity: { title: 'Электричество', unit: 'кВт·ч', digits: 6, decimals: 1 },
  heating: { title: 'Отопление', unit: 'Гкал', digits: 5, decimals: 4 },
  gas: { title: 'Газ', unit: 'м³', digits: 5, decimals: 3 },
};

export interface Meter {
  id: string;
  apartmentId: string;
  kind: MeterKind;
  /** Заводской номер: по нему сверяют прибор при поверке. */
  serial: string;
  /** Дата следующей поверки. После неё показания считаются недостоверными. */
  verifiedUntil?: Date;
}

export interface Reading {
  id: string;
  meterId: string;
  value: number;
  at: Date;
  /** Кто подал: жилец сам или сотрудник по обходу. */
  submittedBy: string;
}

/** Окно подачи показаний. */
export const READING_WINDOW = { fromDay: 20, toDay: 25 } as const;

/** За сколько дней предупреждать о поверке. */
export const VERIFICATION_WARNING_DAYS = 60;

export type VerificationState = 'ok' | 'soon' | 'expired';

/** Что с поверкой прибора. После срока показания не принимают. */
export const verificationState = (meter: MeteringDevice, now: Date): VerificationState => {
  if (!meter.verifiedUntil) return 'ok';

  const left = meter.verifiedUntil.getTime() - now.getTime();

  if (left <= 0) return 'expired';

  return left <= VERIFICATION_WARNING_DAYS * 24 * 3600_000 ? 'soon' : 'ok';
};

/** Форматтер стоит дорого, а дату считают по каждому показанию. */
const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const known = formatters.get(timeZone);

  if (known) return known;

  const created = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  formatters.set(timeZone, created);

  return created;
};

/** Календарная дата в поясе дома. */
const dateIn = (at: Date, timeZone: string): { day: number; month: number; year: number } => {
  const [day, month, year] = formatterFor(timeZone).format(at).split('.').map(Number);

  return { day: day ?? 0, month: month ?? 0, year: year ?? 0 };
};

export const isReadingWindow = (at: Date, window = READING_WINDOW, timeZone = DEFAULT_TIME_ZONE): boolean => {
  const { day } = dateIn(at, timeZone);

  return day >= window.fromDay && day <= window.toDay;
};

/** Сколько дней осталось до конца окна. Отрицательное, окно закрылось. */
export const daysLeftInWindow = (at: Date, window = READING_WINDOW, timeZone = DEFAULT_TIME_ZONE): number =>
  window.toDay - dateIn(at, timeZone).day;

/** Что нужно от прибора, чтобы принять показание. Квартирный он или общедомовой, неважно. */
export type MeteringDevice = Pick<Meter, 'id' | 'kind' | 'serial' | 'verifiedUntil'>;

export interface SubmitReadingInput {
  id: string;
  meter: MeteringDevice;
  value: number;
  at: Date;
  submittedBy: string;
  /** Последнее принятое показание этого счётчика, если оно есть. */
  previous?: Reading;
  /** Часовой пояс дома: по нему считается месяц подачи. */
  timeZone?: string;
}

/** Принимает показание. @throws {DomainError} */
export const acceptReading = (input: SubmitReadingInput): Reading => {
  const rule = METER_RULES[input.meter.kind];

  if (!Number.isFinite(input.value) || input.value < 0) {
    throw new DomainError('reading_invalid', 'Показание должно быть числом не меньше нуля');
  }

  if (input.value >= 10 ** rule.digits) {
    throw new DomainError(
      'reading_too_large',
      `На табло ${rule.digits} цифр: значение ${input.value} туда не поместится`,
    );
  }

  if (input.meter.verifiedUntil && input.at.getTime() > input.meter.verifiedUntil.getTime()) {
    throw new DomainError(
      'meter_not_verified',
      `Срок поверки счётчика ${input.meter.serial} истёк, показания принимать нельзя, нужна поверка`,
    );
  }

  if (input.previous) {
    if (input.value < input.previous.value) {
      throw new DomainError(
        'reading_decreased',
        `Предыдущее показание ${input.previous.value} ${rule.unit}: счётчик не может показать меньше`,
      );
    }

    if (isSameMonth(input.previous.at, input.at, input.timeZone)) {
      throw new DomainError('reading_duplicate', 'Показание за этот месяц уже подано');
    }
  }

  return {
    id: input.id,
    meterId: input.meter.id,
    value: round(input.value, rule.decimals),
    at: input.at,
    submittedBy: input.submittedBy,
  };
};

/** Один расчётный месяц по календарю дома. */
export const isSameMonth = (left: Date, right: Date, timeZone = DEFAULT_TIME_ZONE): boolean => {
  const first = dateIn(left, timeZone);
  const second = dateIn(right, timeZone);

  return first.year === second.year && first.month === second.month;
};

const round = (value: number, decimals: number): number => Number(value.toFixed(decimals));

/** Расход между двумя показаниями. */
export const consumption = (previous: Reading | undefined, current: Reading): number =>
  previous ? round(current.value - previous.value, 4) : 0;

/** Резкий скачок расхода. */
export const SPIKE_FACTOR = 3;

export const isSpike = (history: readonly Reading[], current: Reading): boolean => {
  const values = [...history].sort((left, right) => left.at.getTime() - right.at.getTime());
  const deltas: number[] = [];

  for (let index = 1; index < values.length; index += 1) {
    deltas.push(values[index]!.value - values[index - 1]!.value);
  }

  if (deltas.length < 2) return false;

  const previous = values.at(-1);

  if (!previous) return false;

  const average = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;

  return average > 0 && current.value - previous.value > average * SPIKE_FACTOR;
};

/** Во сколько раз расход должен превысить соседский, чтобы об этом стоило сказать. */
export const NEIGHBOUR_FACTOR = 2;

/** Сколько соседей нужно для сравнения. */
export const NEIGHBOURS_FOR_COMPARISON = 3;

export interface ConsumptionComparison {
  /** Расход этой квартиры за период. */
  own: number;
  /** Медиана по соседям с тем же прибором. */
  median: number;
  /** Расход заметно выше соседского. */
  unusual: boolean;
}

/** Расход в сравнении с соседями. */
export const compareToNeighbours = (own: number, neighbours: readonly number[]): ConsumptionComparison => {
  const values = neighbours.filter((value) => value > 0).sort((left, right) => left - right);

  if (values.length < NEIGHBOURS_FOR_COMPARISON) return { own, median: 0, unusual: false };

  const median = middleOf(values);

  return { own, median, unusual: median > 0 && own > median * NEIGHBOUR_FACTOR };
};
