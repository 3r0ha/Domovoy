import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TARIFFS, DomainError, leftToPay } from '@domovoy/domain';

import {
  InMemoryRepository,
  chargesForResident,
  createMockPayments,
  listAudit,
  listTariffs,
  payCharges,
  paymentHistory,
  periodOf,
  PAYMENTS_LIMIT,
  setTariff,
  submitReading,
  tariffsFor,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-05T10:00:00Z');

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const setup = () => {
  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
    apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
    residents: [maria],
  });

  let clock = NOW;
  const payments = createMockPayments({ now: () => clock });
  let counter = 0;

  const deps: AppDeps = {
    repository,
    now: () => clock,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    payments,
  };

  return {
    deps,
    repository,
    payments,
    setNow: (at: Date) => {
      clock = at;
    },
  };
};

describe('квитанция', () => {
  it('считается из показаний, которые подал сам жилец', async () => {
    const { deps, repository, setNow } = setup();

    await repository.saveMeter({ id: 'm-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await repository.saveReading({
      id: 'r-0',
      meterId: 'm-1',
      submittedBy: 'res-1',
      value: 100,
      at: new Date('2026-07-20T10:00:00Z'),
    });

    setNow(new Date('2026-08-22T10:00:00Z'));
    await submitReading(deps, { resident: maria, meterId: 'm-1', value: 110 });
    setNow(NOW);

    const charges = await chargesForResident(deps, maria);
    const water = charges.lines.find((line) => line.title === 'Холодная вода');

    assert.equal(charges.period, '2026-08');

    assert.equal(water?.amount, 435);
    assert.match(water?.detail ?? '', /10 м³ × 43.5 ₽/);

    const upkeep = charges.lines.find((line) => line.title.startsWith('Содержание'));

    assert.equal(upkeep?.amount, 1620);
    assert.equal(charges.total, 2055);
  });

  it('без показаний остаётся только содержание жилья', async () => {
    const { deps } = setup();

    const charges = await chargesForResident(deps, maria);

    assert.deepEqual(
      charges.lines.map((line) => line.title),
      ['Содержание и текущий ремонт'],
    );
  });

  it('оплата уменьшает долг, а вторая, не проходит', async () => {
    const { deps } = setup();

    const receipt = await payCharges(deps, maria);

    assert.equal(receipt.amount, 1620);
    assert.equal(leftToPay(await chargesForResident(deps, maria)), 0);

    await assert.rejects(payCharges(deps, maria), /всё оплачено/);
  });

  it('без привязанной квартиры начислений нет', async () => {
    const { deps } = setup();

    await assert.rejects(
      chargesForResident(deps, { ...maria, apartmentId: undefined }),
      DomainError,
    );
  });

  it('без шлюза квитанция видна, а оплатить нельзя', async () => {
    const { deps } = setup();
    const { payments, ...withoutGateway } = deps;

    void payments;

    await assert.doesNotReject(chargesForResident(withoutGateway, maria));
    await assert.rejects(payCharges(withoutGateway, maria), /не подключена/);
  });
});

describe('история платежей', () => {
  it('показывает оплаченное этой квартирой, свежее первым', async () => {
    const { deps, payments } = setup();

    await payments.pay({ apartmentId: 'apt-1', period: '2026-06', amount: 1500 });
    await payCharges(deps, maria);

    const history = await paymentHistory(deps, maria);

    assert.deepEqual(
      history.map((receipt) => receipt.period),
      ['2026-08', '2026-06'],
    );
    assert.equal(history[0]?.amount, 1620);
  });

  it('чужие платежи в свою историю не попадают', async () => {
    const { deps, payments } = setup();

    await payments.pay({ apartmentId: 'apt-2', period: '2026-07', amount: 9999 });
    await payCharges(deps, maria);

    const history = await paymentHistory(deps, maria);

    assert.equal(history.length, 1);
    assert.equal(history[0]?.amount, 1620);
  });

  it('длина истории ограничена: за годы платежей набирается много', async () => {
    const { deps, payments } = setup();

    for (let month = 1; month <= 15; month += 1) {
      await payments.pay({
        apartmentId: 'apt-1',
        period: `2025-${`${month}`.padStart(2, '0')}`,
        amount: 100,
      });
    }

    assert.equal((await paymentHistory(deps, maria)).length, PAYMENTS_LIMIT);
    assert.equal((await paymentHistory(deps, maria, 3)).length, 3);
  });

  it('без квартиры платежей нет', async () => {
    const { deps } = setup();

    await assert.rejects(paymentHistory(deps, { ...maria, apartmentId: undefined }), /привяжите квартиру/);
  });

  it('без шлюза история пустая, а не сломанная', async () => {
    const { deps } = setup();
    const { payments, ...withoutGateway } = deps;

    void payments;

    assert.deepEqual(await paymentHistory(withoutGateway, maria), []);
  });
});

describe('тарифы дома', () => {
  const manager: Resident = {
    id: 'mgr-1',
    maxUserId: 7007,
    displayName: 'Нина',
    role: 'manager',
    buildingId: BUILDING_ID,
  };

  it('считают квитанцию по своим цифрам, а не по зашитым', async () => {
    const { deps, repository } = setup();

    await repository.saveResident(manager);
    await setTariff(deps, manager, { kind: 'maintenance', value: 50, since: new Date('2026-01-01T00:00:00Z') });

    const charges = await chargesForResident(deps, maria);

    assert.equal(charges.lines[0]?.amount, 2500, '50 м² × 50 ₽');
  });

  it('квитанция прошлого месяца считается по прошлым тарифам', async () => {
    const { deps, repository } = setup();

    await repository.saveResident(manager);
    await setTariff(deps, manager, { kind: 'maintenance', value: 30, since: new Date('2026-01-01T00:00:00Z') });
    await setTariff(deps, manager, { kind: 'maintenance', value: 40, since: new Date('2026-07-01T00:00:00Z') });

    const june = await tariffsFor(deps, BUILDING_ID, new Date('2026-06-15T10:00:00Z'));
    const august = await tariffsFor(deps, BUILDING_ID, new Date('2026-08-15T10:00:00Z'));

    assert.equal(june.maintenance, 30);
    assert.equal(august.maintenance, 40);
  });

  it('незаданный тариф берётся из умолчаний и так и помечен', async () => {
    const { deps, repository } = setup();

    await repository.saveResident(manager);
    await setTariff(deps, manager, { kind: 'cold_water', value: 60 });

    const view = await listTariffs(deps, manager);
    const cold = view.find((item) => item.kind === 'cold_water');
    const hot = view.find((item) => item.kind === 'hot_water');

    assert.deepEqual([cold?.value, cold?.own], [60, true]);
    assert.deepEqual([hot?.value, hot?.own], [DEFAULT_TARIFFS.meters.hot_water, false]);
  });

  it('тариф задаёт управляющий, и отрицательного не бывает', async () => {
    const { deps, repository } = setup();

    await repository.saveResident(manager);

    await assert.rejects(setTariff(deps, maria, { kind: 'maintenance', value: 10 }), /задаёт управляющий/);
    await assert.rejects(setTariff(deps, manager, { kind: 'maintenance', value: -1 }), /неотрицательным числом/);
  });

  it('изменение тарифа попадает в журнал действий', async () => {
    const { deps, repository } = setup();

    await repository.saveResident(manager);
    await setTariff(deps, manager, { kind: 'cold_water', value: 44.9 });

    const [entry] = await listAudit(deps, manager);

    assert.equal(entry?.action, 'tariff_changed');
    assert.equal(entry?.subject, 'Холодная вода');
  });
});

describe('период начисления', () => {
  it('считается по времени дома, а не сервера', () => {
    const at = new Date('2026-08-31T14:00:00Z');

    assert.equal(periodOf(at, 'Asia/Kamchatka'), '2026-09');
    assert.equal(periodOf(at, 'Europe/Moscow'), '2026-08');
  });
});
