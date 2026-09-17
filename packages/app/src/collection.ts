import { DomainError, formatMoney, isCompanyStaff, plural, roundMoney } from '@domovoy/domain';

import { apartmentsOf } from './apartments.js';
import { assertServes, homeBuildingOf } from './buildings.js';
import { recordAction } from './audit.js';
import { DEBT_MONTHS, arrearsFor, debtRange, formatDebt, knownForDebt } from './debt.js';
import { noopNotifier, notifyAbout } from './notifier.js';
import type { Resident } from './repository.js';
import type { AppDeps } from './use-cases.js';
import { zoneOf } from './zone.js';

export interface Debtor {
  residentId: string;
  displayName: string;
  apartmentId: string;
  /** Номер квартиры. */
  apartmentNumber?: number;
  /** Долг по начислениям, без пеней. */
  debt: number;
  penalty: number;
  /** За какие месяцы идёт долг, словами. */
  months?: string;
  /** Сколько дней просрочен самый старый неоплаченный месяц. */
  overdueDays: number;
}

export interface HouseDebt {
  /** Долг дома по начислениям. */
  total: number;
  penalty: number;
  /** Должники, самые крупные первыми. */
  debtors: Debtor[];
}

const onlyStaff = (actor: Resident): void => {
  if (!isCompanyStaff(actor.role)) {
    throw new DomainError('forbidden', 'Долги дома видит управляющая компания');
  }
};

/** Кто и сколько должен дому. @throws {DomainError} */
export const houseDebt = async (deps: AppDeps, actor: Resident, buildingId?: string): Promise<HouseDebt> => {
  onlyStaff(actor);

  const house = buildingId ?? actor.buildingId ?? deps.defaultBuildingId;
  const zone = await zoneOf(deps, house);
  const known = await knownForDebt(deps, house, zone);
  const apartments = known.apartments;
  const residents = await deps.repository.listResidentsByApartments(apartments.map((item) => item.id));

  const debtors: Debtor[] = [];

  for (const resident of residents) {
    const mine = apartmentsOf(resident).find((id) => apartments.some((item) => item.id === id));

    if (!mine) continue;

    const debt = await arrearsFor(deps, resident, DEBT_MONTHS, known);

    if (debt.total <= 0) continue;

    const apartment = apartments.find((item) => item.id === mine);
    const range = debtRange(debt);

    debtors.push({
      residentId: resident.id,
      displayName: resident.displayName,
      apartmentId: mine,
      ...(apartment?.number === undefined ? {} : { apartmentNumber: apartment.number }),
      debt: debt.total,
      penalty: debt.penalty,
      ...(range ? { months: range } : {}),
      overdueDays: Math.max(0, ...debt.periods.map((period) => period.overdueDays)),
    });
  }

  debtors.sort((left, right) => right.debt + right.penalty - (left.debt + left.penalty));

  const sum = (pick: (item: Debtor) => number): number =>
    roundMoney(debtors.reduce((total, item) => total + pick(item), 0));

  return { total: sum((item) => item.debt), penalty: sum((item) => item.penalty), debtors };
};


/** Сколько должников умещается в одно сообщение. */
export const DEBTORS_SHOWN = 10;

/** Какую часть списка показываем: длинный список читают страницами. */
export interface DebtorsPage {
  offset?: number;
  limit?: number;
}

/** Долги дома словами для чата. */
/**
 * Долг дома одной строкой: сколько должников и на сколько. Поимённый список
 * с пенями и напоминаниями работает на экране, а не в переписке.
 */
export const formatHouseDebtShort = (debt: HouseDebt): string => {
  if (debt.debtors.length === 0) return 'Долгов за прошлые месяцы нет.';

  const penalty = debt.penalty > 0 ? `, из них пени ${formatMoney(debt.penalty)}` : '';

  const who = plural(debt.debtors.length, 'должник', 'должника', 'должников');

  return `Долг дома ${formatMoney(debt.total + debt.penalty)}${penalty}. Это ${who}.`;
};

export const formatHouseDebt = (debt: HouseDebt, page: DebtorsPage = {}): string => {
  if (debt.debtors.length === 0) return 'Долгов за прошлые месяцы нет.';

  const offset = page.offset ?? 0;
  const shown = debt.debtors.slice(offset, offset + (page.limit ?? DEBTORS_SHOWN));
  const rest = debt.debtors.length - (offset + shown.length);

  const lines = shown.map((debtor) => {
    const where = debtor.apartmentNumber === undefined ? debtor.displayName : `кв. ${debtor.apartmentNumber}`;

    return (
      `  ${where}, ${debtor.displayName}: ${formatMoney(debtor.debt + debtor.penalty)}` +
      (debtor.months ? ` (${debtor.months})` : '')
    );
  });

  // Шапка с суммой нужна один раз: на следующих страницах идёт только список.
  const head =
    offset > 0
      ? ''
      : `Долг дома ${formatMoney(debt.total + debt.penalty)}` +
        (debt.penalty > 0 ? `, из них пени ${formatMoney(debt.penalty)}` : '') +
        ':\n';

  // Когда список листают кнопкой, остаток называет она, а не текст.
  const tail = page.offset === undefined && rest > 0 ? `\n  и ещё ${rest}` : '';

  return `${head}${lines.join('\n')}${tail}`;
};

/** Напоминание одному должнику, вручную. @throws {DomainError} */
export const remindDebtor = async (deps: AppDeps, actor: Resident, residentId: string): Promise<Resident> => {
  onlyStaff(actor);

  const resident = await deps.repository.findResident(residentId);

  if (!resident) throw new DomainError('resident_not_found', 'Жилец не найден');

  const home = await homeBuildingOf(deps, resident);

  await assertServes(deps, actor, home);

  const text = formatDebt(await arrearsFor(deps, resident));

  if (!text) throw new DomainError('nothing_to_remind', 'Долга нет, напоминать не о чем');

  await notifyAbout(deps.notifier ?? noopNotifier, resident, text, { section: 'meters' });

  await recordAction(deps, {
    actor,
    action: 'debt_reminded',
    buildingId: resident.buildingId ?? actor.buildingId ?? deps.defaultBuildingId,
    subject: resident.displayName,
  });

  return resident;
};
