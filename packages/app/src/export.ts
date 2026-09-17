import { DEFAULT_TIME_ZONE, METER_RULES, inPeriod } from '@domovoy/domain';

import { csvFrom } from './csv.js';
import { zoneOf } from './zone.js';
import type { AppDeps } from './use-cases.js';

export interface ExportPeriod {
  from: Date;
  to: Date;
}

/** Дробная часть через запятую: с точкой Excel читает число как текст. */
const decimal = (value: number): string =>
  value.toLocaleString('ru-RU', { maximumFractionDigits: 4, useGrouping: false });

/** Дата без времени: в выгрузку идёт день по местному времени дома. */
const day = (at: Date, timeZone: string): string =>
  at.toLocaleDateString('ru-RU', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' });

const within = (at: Date, period: ExportPeriod): boolean => inPeriod(at, period.from, period.to);

/** Показания приборов учёта за период: строки без разметки. */
export const readingsTable = async (
  deps: AppDeps,
  buildingId: string,
  period: ExportPeriod,
): Promise<{ name: string; columns: string[]; rows: (string | number)[][] }> => {
  const timeZone = await zoneOf(deps, buildingId);
  const building = await deps.repository.findBuilding(buildingId);
  const apartments = await deps.repository.listApartments(buildingId);
  const columns = ['Адрес', 'Помещение', 'Прибор учёта', 'Вид ресурса', 'Дата', 'Показание', 'Единица'];
  const rows: (string | number)[][] = [];

  // Дом целиком читается двумя запросами: приборы и показания сразу по всем квартирам.
  const meters = await deps.repository.listMetersByApartments(apartments.map((apartment) => apartment.id));
  const readings = await deps.repository.listReadingsFor(meters.map((meter) => meter.id));

  const metersOf = new Map<string, typeof meters>();
  const readingsOf = new Map<string, typeof readings>();

  for (const meter of meters) metersOf.set(meter.apartmentId, [...(metersOf.get(meter.apartmentId) ?? []), meter]);
  for (const reading of readings) {
    readingsOf.set(reading.meterId, [...(readingsOf.get(reading.meterId) ?? []), reading]);
  }

  for (const apartment of apartments) {
    for (const meter of metersOf.get(apartment.id) ?? []) {
      const rules = METER_RULES[meter.kind];

      for (const reading of readingsOf.get(meter.id) ?? []) {
        if (!within(reading.at, period)) continue;

        rows.push([
          building?.address ?? '',
          apartment.number,
          meter.serial,
          rules.title,
          day(reading.at, timeZone),
          decimal(reading.value),
          rules.unit,
        ]);
      }
    }
  }

  const stamp = (at: Date): string => at.toISOString().slice(0, 10);

  return {
    name: `показания-${building?.code ?? buildingId}-${stamp(period.from)}_${stamp(period.to)}`,
    columns,
    rows,
  };
};

/** Те же показания текстом с разделителями. */
export const readingsCsv = async (
  deps: AppDeps,
  buildingId: string,
  period: ExportPeriod,
): Promise<{ filename: string; csv: string }> => {
  const table = await readingsTable(deps, buildingId, period);

  return { filename: `${table.name}.csv`, csv: csvFrom(table) };
};

/** Период по умолчанию: прошедший месяц. */
export const lastMonth = (now: Date, timeZone = DEFAULT_TIME_ZONE): ExportPeriod => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(now);
  const [year, month] = parts.split('-').map(Number);
  const from = new Date(Date.UTC(year!, month! - 2, 1));
  const to = new Date(Date.UTC(year!, month! - 1, 1) - 1);

  return { from, to };
};
