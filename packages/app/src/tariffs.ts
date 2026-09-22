import { DEFAULT_TARIFFS, DomainError, METER_RULES, type MeterKind, type Tariffs } from '@domovoy/domain';

import { recordAction } from './audit.js';
import type { Resident, TariffKind, TariffRecord } from './repository.js';
import type { AppDeps } from './use-cases.js';

/** Тарифы, которые продукт знает: другой вид дом не заведёт. */
export const TARIFF_KINDS: TariffKind[] = [...(Object.keys(METER_RULES) as MeterKind[]), 'maintenance', 'key_rate'];

const SPECIAL: Partial<Record<TariffKind, { title: string; unit: string }>> = {
  maintenance: { title: 'Содержание и текущий ремонт', unit: '₽ за м² в месяц' },
  key_rate: { title: 'Ключевая ставка ЦБ', unit: 'годовых, от неё считаются пени' },
};

export const tariffTitle = (kind: TariffKind): string => SPECIAL[kind]?.title ?? METER_RULES[kind as MeterKind].title;

export const tariffUnit = (kind: TariffKind): string =>
  SPECIAL[kind]?.unit ?? `₽ за ${METER_RULES[kind as MeterKind].unit}`;

/** Тарифы дома на указанный момент. */
export const tariffsFor = async (deps: AppDeps, buildingId: string, at: Date): Promise<Tariffs> =>
  tariffsAt(await deps.repository.listTariffs(buildingId), at);

/** То же по уже прочитанной истории: долг считает шесть месяцев на каждое помещение. */
export const tariffsAt = (records: readonly TariffRecord[], at: Date): Tariffs => {
  const current = new Map<TariffKind, TariffRecord>();

  for (const record of records) {
    if (record.since.getTime() > at.getTime()) continue;

    const known = current.get(record.kind);

    if (!known || record.since.getTime() > known.since.getTime()) current.set(record.kind, record);
  }

  const meters = { ...DEFAULT_TARIFFS.meters };

  for (const kind of Object.keys(meters) as MeterKind[]) {
    const record = current.get(kind);

    if (record) meters[kind] = record.value;
  }

  return {
    meters,
    maintenance: current.get('maintenance')?.value ?? DEFAULT_TARIFFS.maintenance,
    keyRate: current.get('key_rate')?.value ?? DEFAULT_TARIFFS.keyRate,
  };
};

const valueOf = (tariffs: Tariffs, kind: TariffKind): number => {
  if (kind === 'maintenance') return tariffs.maintenance;
  if (kind === 'key_rate') return tariffs.keyRate;

  return tariffs.meters[kind];
};

export interface TariffView {
  kind: TariffKind;
  title: string;
  unit: string;
  value: number;
  /** Тариф задан управляющей организацией. */
  own: boolean;
  since?: Date;
}

/** Действующие тарифы дома для экрана: и заданные, и умолчания. */
export const listTariffs = async (deps: AppDeps, resident: Resident): Promise<TariffView[]> => {
  const buildingId = resident.buildingId ?? deps.defaultBuildingId;
  const at = deps.now();
  const records = await deps.repository.listTariffs(buildingId);
  const tariffs = await tariffsFor(deps, buildingId, at);

  return TARIFF_KINDS.map((kind) => {
    const own = records
      .filter((record) => record.kind === kind && record.since.getTime() <= at.getTime())
      .sort((left, right) => right.since.getTime() - left.since.getTime())[0];

    return {
      kind,
      title: tariffTitle(kind),
      unit: tariffUnit(kind),
      value: valueOf(tariffs, kind),
      own: own !== undefined,
      ...(own ? { since: own.since } : {}),
    };
  });
};

export interface SetTariffCommand {
  kind: TariffKind;
  value: number;
  /** С какого дня действует. По умолчанию с сегодняшнего. */
  since?: Date;
}

/** Меняет тариф дома. @throws {DomainError} */
export const setTariff = async (
  deps: AppDeps,
  manager: Resident,
  command: SetTariffCommand,
): Promise<TariffView[]> => {
  if (manager.role !== 'manager') {
    throw new DomainError('forbidden', 'Тарифы задаёт управляющий');
  }

  if (!TARIFF_KINDS.includes(command.kind)) {
    throw new DomainError('tariff_invalid', 'Такого тарифа нет');
  }

  if (!Number.isFinite(command.value) || command.value < 0) {
    throw new DomainError('tariff_invalid', 'Тариф должен быть неотрицательным числом');
  }

  const buildingId = manager.buildingId ?? deps.defaultBuildingId;

  await deps.repository.saveTariff({
    buildingId,
    kind: command.kind,
    value: command.value,
    since: command.since ?? deps.now(),
  });

  await recordAction(deps, {
    actor: manager,
    action: 'tariff_changed',
    subject: tariffTitle(command.kind),
    details: `${command.value} ${tariffUnit(command.kind)}`,
    buildingId,
  });

  return listTariffs(deps, manager);
};
