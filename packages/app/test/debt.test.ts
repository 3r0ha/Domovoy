import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  arrearsFor,
  createCollectingNotifier,
  createMockPayments,
  debtRange,
  formatDebt,
  payArrears,
  payCharges,
  remindAboutDebt,
  setTariff,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const manager: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Нина',
  role: 'manager',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier>; setNow: (at: Date) => void };

const setup = async (now = new Date('2026-09-15T10:00:00Z')): Promise<Deps> => {
  let clock = now;
  let counter = 0;

  const deps: Deps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
      residents: [maria, manager],
    }),
    now: () => clock,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
    payments: createMockPayments({ now: () => clock }),
    setNow: (at) => {
      clock = at;
    },
  };

  await setTariff(deps, manager, { kind: 'maintenance', value: 40, since: new Date('2026-01-01T00:00:00Z') });

  return deps;
};

describe('задолженность', () => {
  it('считает неоплаченные прошлые месяцы, а текущий не трогает', async () => {
    const deps = await setup();

    const debt = await arrearsFor(deps, maria, 2);

    assert.deepEqual(
      debt.periods.map((item) => item.period),
      ['2026-07', '2026-08'],
    );
    assert.equal(debt.total, 4000);
  });

  it('оплата закрывает свой месяц', async () => {
    const deps = await setup(new Date('2026-08-05T10:00:00Z'));

    await payCharges(deps, maria);
    deps.setNow(new Date('2026-09-15T10:00:00Z'));

    const debt = await arrearsFor(deps, maria, 2);

    assert.deepEqual(
      debt.periods.map((item) => item.period),
      ['2026-08'],
    );
  });

  it('словами называет месяцы, а не машинные ключи', async () => {
    const deps = await setup();

    assert.match(formatDebt(await arrearsFor(deps, maria, 1)) ?? '', /август 2026: 2\s000,00 ₽/);
  });

  it('до срока оплаты не напоминает', async () => {
    const deps = await setup(new Date('2026-09-05T10:00:00Z'));

    assert.deepEqual(await remindAboutDebt(deps, BUILDING_ID), []);
  });

  it('после срока напоминает должникам', async () => {
    const deps = await setup(new Date('2026-09-15T10:00:00Z'));

    const reminded = await remindAboutDebt(deps, BUILDING_ID);

    assert.deepEqual(
      reminded.map((person) => person.id),
      [maria.id],
    );
    assert.match(deps.notifier.sent[0]?.text ?? '', /Не оплачено/);
  });

  it('гасится целиком, и каждый месяц закрывается своим платежом', async () => {
    const deps = await setup();

    const receipts = await payArrears(deps, maria);

    assert.deepEqual(
      receipts.map((receipt) => receipt.period),
      ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
    );
    assert.equal((await arrearsFor(deps, maria)).total, 0);
  });

  it('без долга платить нечего', async () => {
    const deps = await setup();

    await payArrears(deps, maria);

    await assert.rejects(payArrears(deps, maria), /Долга за прошлые месяцы нет/);
  });

  it('тарифы дома читаются один раз на проход, а не на каждый месяц', async () => {
    const deps = await setup(new Date('2026-09-15T10:00:00Z'));
    let reads = 0;

    const counted: AppDeps = {
      ...deps,
      repository: Object.assign(Object.create(Object.getPrototypeOf(deps.repository)), deps.repository, {
        listTariffs: async (buildingId: string) => {
          reads += 1;
          return deps.repository.listTariffs(buildingId);
        },
      }),
    };

    await remindAboutDebt(counted, BUILDING_ID);

    assert.equal(reads, 1);
  });

  it('показания дома читаются одним запросом, а не по прибору на квартиру', async () => {
    const deps = await setup(new Date('2026-09-15T10:00:00Z'));
    const calls: string[] = [];

    const counted: AppDeps = {
      ...deps,
      repository: Object.assign(Object.create(Object.getPrototypeOf(deps.repository)), deps.repository, {
        listReadings: async (meterId: string) => {
          calls.push('по прибору');
          return deps.repository.listReadings(meterId);
        },
        listReadingsFor: async (meterIds: readonly string[]) => {
          calls.push('пачкой');
          return deps.repository.listReadingsFor(meterIds);
        },
        listMeters: async (apartmentId: string) => {
          calls.push('приборы квартиры');
          return deps.repository.listMeters(apartmentId);
        },
      }),
    };

    await remindAboutDebt(counted, BUILDING_ID);

    assert.deepEqual(calls, ['пачкой']);
  });

  it('без квартиры долга нет', async () => {
    const deps = await setup();

    await assert.rejects(arrearsFor(deps, { ...maria, apartmentId: undefined }), /привяжите квартиру/);
  });

  it('месяцы долга называются по-русски, а не диапазоном через тире', () => {
    const period = (value: string) => ({ period: value, charged: 100, paid: 0, left: 100, penalty: 0, overdueDays: 0 });

    assert.equal(debtRange({ total: 100, penalty: 0, periods: [period('2026-08')] }), 'август 2026');
    assert.equal(
      debtRange({ total: 200, penalty: 0, periods: [period('2026-03'), period('2026-08')] }),
      'с марта по август 2026',
    );
    assert.equal(
      debtRange({ total: 200, penalty: 0, periods: [period('2025-11'), period('2026-02')] }),
      'с ноября 2025 по февраль 2026',
    );
    assert.equal(debtRange({ total: 0, penalty: 0, periods: [] }), undefined);
  });
});

describe('пени на долг', () => {
  it('свежий долг пеней не даёт, а полугодовой даёт', async () => {
    const deps = await setup(new Date('2026-09-15T10:00:00Z'));
    const debt = await arrearsFor(deps, maria);

    const fresh = debt.periods.at(-1);
    const old = debt.periods[0];

    assert.equal(fresh?.overdueDays, 5);
    assert.equal(fresh?.penalty, 0);

    assert.ok((old?.overdueDays ?? 0) > 150);
    assert.ok((old?.penalty ?? 0) > 0);
    assert.equal(debt.penalty > 0, true);
  });

  it('ставку меняет управляющая компания, и пени идут по ней', async () => {
    const deps = await setup(new Date('2026-09-15T10:00:00Z'));
    const before = (await arrearsFor(deps, maria)).penalty;

    await setTariff(deps, manager, { kind: 'key_rate', value: 0.32, since: new Date('2020-01-01T00:00:00Z') });

    const after = (await arrearsFor(deps, maria)).penalty;

    assert.ok(after > before, 'ставка вдвое выше, пени тоже');
  });

  it('в сумму долга пени не входят: это разные деньги', async () => {
    const deps = await setup(new Date('2026-09-15T10:00:00Z'));
    const debt = await arrearsFor(deps, maria);

    assert.equal(
      debt.total,
      Math.round(debt.periods.reduce((sum, item) => sum + item.left, 0) * 100) / 100,
    );
    assert.notEqual(debt.penalty, 0);
  });

  it('в напоминании пени названы отдельной строкой словами жильца', async () => {
    const deps = await setup(new Date('2026-09-15T10:00:00Z'));
    const text = formatDebt(await arrearsFor(deps, maria)) ?? '';

    assert.match(text, /Штраф за просрочку: /);
    assert.match(text, /Итого заплатить: /);
  });

  it('оплата долга закрывает и пени', async () => {
    const deps = await setup(new Date('2026-09-15T10:00:00Z'));
    const debt = await arrearsFor(deps, maria);
    const receipts = await payArrears(deps, maria);

    const paid = Math.round(receipts.reduce((sum, receipt) => sum + receipt.amount, 0) * 100) / 100;

    assert.equal(paid, Math.round((debt.total + debt.penalty) * 100) / 100);
    assert.equal((await arrearsFor(deps, maria)).total, 0);
  });
});
