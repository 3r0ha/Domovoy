import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createCollectingNotifier,
  createMockPayments,
  formatHouseDebt,
  houseDebt,
  payCharges,
  remindDebtor,
  setTariff,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-15T10:00:00Z');

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const ivan: Resident = {
  id: 'res-2',
  maxUserId: 1002,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
};

const nina: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Нина',
  role: 'manager',
  buildingId: BUILDING_ID,
};

const petr: Resident = {
  id: 'res-3',
  maxUserId: 1003,
  displayName: 'Пётр',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const setup = async (extra: Resident[] = []) => {
  let counter = 0;
  const notifier = createCollectingNotifier();

  const deps: AppDeps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 1, area: 100 },
      ],
      residents: [maria, ivan, nina, ...extra],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier,
    payments: createMockPayments({ now: () => NOW }),
  };

  await setTariff(deps, nina, { kind: 'maintenance', value: 40, since: new Date('2026-01-01T00:00:00Z') });

  return { deps, notifier };
};

describe('долги дома', () => {
  it('крупные должники идут первыми, с пенями и месяцами', async () => {
    const { deps } = await setup();

    const debt = await houseDebt(deps, nina);

    assert.deepEqual(
      debt.debtors.map((item) => item.displayName),
      ['Иван', 'Мария'],
    );

    const [first] = debt.debtors;

    assert.equal(first?.apartmentNumber, 2);
    assert.match(first?.months ?? '', /с марта по август 2026/);
    assert.ok((first?.penalty ?? 0) > 0, 'по полугодовому долгу пени уже идут');
    assert.ok((first?.overdueDays ?? 0) > 150);
    assert.equal(debt.total, Math.round((debt.debtors[0]!.debt + debt.debtors[1]!.debt) * 100) / 100);
  });

  it('квартира на двоих даёт одну строку долга, а не две', async () => {
    const { deps, notifier } = await setup([petr]);

    const debt = await houseDebt(deps, nina);
    const flat = debt.debtors.find((item) => item.apartmentNumber === 1);

    assert.equal(debt.debtors.length, 2);
    assert.equal(flat?.displayName, 'Мария, Пётр');
    assert.equal(debt.total, Math.round((debt.debtors[0]!.debt + debt.debtors[1]!.debt) * 100) / 100);

    await remindDebtor(deps, nina, maria.id);

    assert.deepEqual(
      notifier.sent.map((item) => item.maxUserId),
      [maria.maxUserId, petr.maxUserId],
      'напоминание получают оба жильца квартиры',
    );
  });

  it('кто платит, в списке не значится', async () => {
    const { deps } = await setup();

    for (const period of ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
      await deps.payments!.pay({ apartmentId: 'apt-1', period, amount: 2000 });
    }

    const debt = await houseDebt(deps, nina);

    assert.deepEqual(
      debt.debtors.map((item) => item.displayName),
      ['Иван'],
    );
  });

  it('жильцу список должников не показывают', async () => {
    const { deps } = await setup();

    await assert.rejects(houseDebt(deps, maria), /управляющая организация/);
    await assert.rejects(remindDebtor(deps, maria, ivan.id), /управляющая организация/);
  });

  it('напоминание уходит одному должнику и попадает в журнал', async () => {
    const { deps, notifier } = await setup();

    const reminded = await remindDebtor(deps, nina, ivan.id);

    assert.equal(reminded.id, ivan.id);
    assert.equal(notifier.sent.length, 1);
    assert.match(notifier.sent[0]?.text ?? '', /Не оплачено/);
    assert.equal(notifier.sent[0]?.section, 'meters', 'под напоминанием кнопка перехода к оплате');

    const journal = await deps.repository.listAudit(BUILDING_ID, { limit: 10 });
    const entry = journal.find((item) => item.action === 'debt_reminded');

    assert.equal(entry?.subject, 'Иван');
    assert.equal(entry?.actorName, 'Нина');
  });

  it('человеку без долга не напоминают', async () => {
    const { deps } = await setup();

    await payCharges(deps, maria);

    for (const period of ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
      await deps.payments!.pay({ apartmentId: 'apt-1', period, amount: 2000 });
    }

    await assert.rejects(remindDebtor(deps, nina, maria.id), /Долга нет/);
  });

  it('в чат уходит список квартир с суммами, а не таблица', async () => {
    const { deps } = await setup();

    const text = formatHouseDebt(await houseDebt(deps, nina));

    assert.match(text, /^Долг дома /);
    assert.match(text, /из них пени /);
    assert.match(text, /кв\. 2, Иван: /);
    assert.match(text, /\(с марта по август 2026\)/);
  });

  it('без долгов чат получает одну фразу, а не пустой список', async () => {
    const { deps } = await setup();

    for (const period of ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
      for (const apartmentId of ['apt-1', 'apt-2']) {
        await deps.payments!.pay({ apartmentId, period, amount: 10_000 });
      }
    }

    assert.equal(formatHouseDebt(await houseDebt(deps, nina)), 'Долгов за прошлые месяцы нет.');
  });

  it('дом читается один раз, а не по разу на квартиру', async () => {
    const { deps } = await setup();
    let tariffReads = 0;

    const counted: AppDeps = {
      ...deps,
      repository: Object.assign(Object.create(Object.getPrototypeOf(deps.repository)), deps.repository, {
        listTariffs: async (buildingId: string) => {
          tariffReads += 1;
          return deps.repository.listTariffs(buildingId);
        },
      }),
    };

    await houseDebt(counted, nina);

    assert.equal(tariffReads, 1);
  });
});
