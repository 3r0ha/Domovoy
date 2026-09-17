import { DomainError, METER_RULES, type Apartment, type Meter, type MeterKind } from '@domovoy/domain';

import { issueApartmentCode } from './apartments.js';
import { recordAction } from './audit.js';
import { BOM } from './csv.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';

export interface ImportedApartment {
  number: number;
  entrance: number;
  riser: number;
  area?: number;
  /** Сколько человек проживает: по нему считается норматив. */
  residents?: number;
  /** Приборы учёта помещения: заводские номера по видам ресурса. */
  meters: { kind: MeterKind; serial: string }[];
}

export interface ImportProblem {
  /** Номер строки в файле, как его видит человек в редакторе. */
  line: number;
  message: string;
}

export interface ParsedImport {
  rows: ImportedApartment[];
  problems: ImportProblem[];
}

/** Названия колонок в выгрузке. */
const COLUMNS: Record<string, 'number' | 'entrance' | 'riser' | 'area' | 'residents'> = {
  помещение: 'number',
  квартира: 'number',
  номер: 'number',
  подъезд: 'entrance',
  стояк: 'riser',
  площадь: 'area',
  жильцов: 'residents',
  проживает: 'residents',
};

const METER_COLUMNS: Record<string, MeterKind> = {
  хвс: 'cold_water',
  'холодная вода': 'cold_water',
  гвс: 'hot_water',
  'горячая вода': 'hot_water',
  электричество: 'electricity',
  свет: 'electricity',
  отопление: 'heating',
  газ: 'gas',
};

const normalize = (value: string): string => value.trim().toLowerCase().replaceAll('ё', 'е');

/** Разделитель определяется по заголовку: выгружают и с точкой с запятой, и с запятой. */
const separatorOf = (header: string): string => (header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',');

const cells = (line: string, separator: string): string[] => line.split(separator).map((cell) => cell.trim());

const asNumber = (value: string): number | undefined => {
  const parsed = Number(value.replace(',', '.'));

  return value.length > 0 && Number.isFinite(parsed) ? parsed : undefined;
};

/** Разбор списка квартир. */
export const parseApartments = (csv: string): ParsedImport => {
  const lines = csv.replace(BOM, '').split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);

  if (headerIndex < 0) return { rows: [], problems: [{ line: 1, message: 'Файл пуст' }] };

  const separator = separatorOf(lines[headerIndex]!);
  const header = cells(lines[headerIndex]!, separator).map(normalize);
  const rows: ImportedApartment[] = [];
  const problems: ImportProblem[] = [];

  if (!header.some((title) => COLUMNS[title] === 'number')) {
    return { rows: [], problems: [{ line: headerIndex + 1, message: 'В заголовке нет колонки с номером помещения' }] };
  }

  const seen = new Set<number>();

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;

    if (line.trim().length === 0) continue;

    const values = cells(line, separator);
    const at = index + 1;
    const fields: Partial<Record<'number' | 'entrance' | 'riser' | 'area' | 'residents', number>> = {};
    const meters: ImportedApartment['meters'] = [];
    let broken = false;

    for (const [position, title] of header.entries()) {
      const raw = values[position] ?? '';
      const column = COLUMNS[title];
      const meter = METER_COLUMNS[title];

      if (column) {
        if (raw.length === 0) continue;

        const parsed = asNumber(raw);

        if (parsed === undefined || parsed < 0) {
          problems.push({ line: at, message: `«${title}»: ожидалось число, а не «${raw}»` });
          broken = true;
          continue;
        }

        fields[column] = parsed;
      } else if (meter && raw.length > 0) {
        meters.push({ kind: meter, serial: raw });
      }
    }

    if (broken) continue;

    if (fields.number === undefined) {
      problems.push({ line: at, message: 'Не указан номер помещения' });
      continue;
    }

    if (seen.has(fields.number)) {
      problems.push({ line: at, message: `Помещение ${fields.number} встречается второй раз` });
      continue;
    }

    seen.add(fields.number);
    rows.push({
      number: fields.number,
      entrance: fields.entrance ?? 1,
      riser: fields.riser ?? 1,
      ...(fields.area === undefined ? {} : { area: fields.area }),
      ...(fields.residents === undefined ? {} : { residents: fields.residents }),
      meters,
    });
  }

  return { rows, problems };
};

export interface ImportResult {
  added: number;
  updated: number;
  meters: number;
  problems: ImportProblem[];
}

/** Идентификатор помещения выводится из его номера: повторный импорт не плодит квартиры. */
const apartmentId = (buildingId: string, number: number): string => `${buildingId}-kv-${number}`;

/** Заводит дом списком квартир. @throws {DomainError} */
export const importApartments = async (deps: AppDeps, manager: Resident, csv: string): Promise<ImportResult> => {
  if (manager.role !== 'manager') {
    throw new DomainError('forbidden', 'Дом заводит управляющий');
  }

  const buildingId = manager.buildingId ?? deps.defaultBuildingId;
  const { rows, problems } = parseApartments(csv);
  const existing = await deps.repository.listApartments(buildingId);
  const byNumber = new Map(existing.map((apartment) => [apartment.number, apartment]));

  let added = 0;
  let updated = 0;
  let meters = 0;

  for (const row of rows) {
    const known = byNumber.get(row.number);
    const id = known?.id ?? apartmentId(buildingId, row.number);

    const apartment: Apartment = {
      id,
      buildingId,
      code: known?.code ?? (await issueApartmentCode(deps)),
      number: row.number,
      entrance: row.entrance,
      riser: row.riser,
      ...(row.area === undefined ? {} : { area: row.area }),
      ...(row.residents === undefined ? {} : { residents: row.residents }),
    };

    await deps.repository.saveApartment(apartment);
    if (known) updated += 1;
    else added += 1;

    const already = await deps.repository.listMeters(id);

    for (const item of row.meters) {
      const meter: Meter = {
        id: already.find((candidate) => candidate.kind === item.kind)?.id ?? `${id}-${item.kind}`,
        apartmentId: id,
        kind: item.kind,
        serial: item.serial,
      };

      await deps.repository.saveMeter(meter);
      meters += 1;
    }
  }

  if (added + updated > 0) {
    await recordAction(deps, {
      actor: manager,
      action: 'data_imported',
      subject: `${added + updated} помещений`,
      details: `заведено ${added}, обновлено ${updated}, приборов ${meters}`,
      buildingId,
    });
  }

  return { added, updated, meters, problems };
};

/** Пример файла: с него начинают, когда выгрузки под рукой нет. */
export const APARTMENTS_TEMPLATE = [
  ['Помещение', 'Подъезд', 'Стояк', 'Площадь', ...Object.values(METER_RULES).map((rule) => rule.title)].join(';'),
  '1;1;1;54,3;ХВС-001;ГВС-001;ЭЛ-001;;',
  '2;1;2;41,8;ХВС-002;ГВС-002;ЭЛ-002;;',
].join('\n');
