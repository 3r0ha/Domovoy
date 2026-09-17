import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  addHouseMeter,
  chargesForResident,
  createCollectingNotifier,
  houseMetersFor,
  listAudit,
  remindAboutHouseMeters,
  setTariff,
  submitHouseReading,
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

const nina: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Нина',
  role: 'manager',
  buildingId: BUILDING_ID,
};

const setup = (now = NOW) => {
  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
    apartments: [
      { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
      { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 1, area: 150 },
    ],
    residents: [maria, nina],
  });

  let counter = 0;
  const notifier = createCollectingNotifier();

  const deps: AppDeps = {
    repository,
    now: () => now,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier,
  };

  return { deps, repository, notifier };
};

/** Дом израсходовал 100 м³, квартиры отчитались за 80: 20 м³ ушло на общее. */
const withMeters = async (repository: InMemoryRepository) => {
  await repository.saveMeter({ id: 'm-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
  await repository.saveMeter({ id: 'm-2', apartmentId: 'apt-2', kind: 'cold_water', serial: 'ХВС-2' });
  await repository.saveHouseMeter({ id: 'h-1', buildingId: BUILDING_ID, kind: 'cold_water', serial: 'ОДПУ-1' });

  const JULY = new Date('2026-07-20T10:00:00Z');
  const AUGUST = new Date('2026-08-20T10:00:00Z');

  for (const [id, meterId, before, after] of [
    ['r-1', 'm-1', 200, 220],
    ['r-3', 'm-2', 500, 560],
  ] as const) {
    await repository.saveReading({ id: `${id}-a`, meterId, value: before, at: JULY, submittedBy: 'res-1' });
    await repository.saveReading({ id, meterId, value: after, at: AUGUST, submittedBy: 'res-1' });
  }

  await repository.saveHouseReading({ id: 'hr-0', meterId: 'h-1', value: 1000, at: JULY, submittedBy: 'mgr-1' });
  await repository.saveHouseReading({ id: 'hr-1', meterId: 'h-1', value: 1100, at: AUGUST, submittedBy: 'mgr-1' });
};

describe('общедомовой узел учёта', () => {
  it('доля квартиры в общедомовом расходе попадает в квитанцию', async () => {
    const { deps, repository } = setup();

    await withMeters(repository);
    await setTariff(deps, nina, { kind: 'cold_water', value: 50, since: new Date('2026-01-01T00:00:00Z') });

    const charges = await chargesForResident(deps, maria);
    const line = charges.lines.find((item) => item.title === 'Холодная вода, ОДН');

    assert.ok(line, 'общедомовой строки нет');
    assert.equal(line.amount, 250);
    assert.match(line.detail ?? '', /5 м³ × 50 ₽/);
  });

  it('норматив молчащей квартиры не уходит в общедомовое', async () => {
    const { deps, repository } = setup();

    await withMeters(repository);
    await setTariff(deps, nina, { kind: 'cold_water', value: 50, since: new Date('2026-01-01T00:00:00Z') });

    for (const id of ['r-3-a', 'r-3']) await repository.deleteReading(id);

    const line = (await chargesForResident(deps, maria)).lines.find(
      (item) => item.title === 'Холодная вода, ОДН',
    );

    assert.ok(line, 'общедомовой строки нет');
    assert.equal(line.detail?.startsWith('18,181 м³'), true, line.detail);
  });

  it('без общедомового прибора строки нет', async () => {
    const { deps, repository } = setup();

    await repository.saveMeter({ id: 'm-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    const charges = await chargesForResident(deps, maria);

    assert.equal(
      charges.lines.some((line) => line.title.includes('ОДН')),
      false,
    );
  });

  it('квартиры показали больше дома, общедомового не начисляем', async () => {
    const { deps, repository } = setup();

    await withMeters(repository);
    await repository.saveHouseReading({
      id: 'hr-1',
      meterId: 'h-1',
      value: 1010,
      at: new Date('2026-09-20T10:00:00Z'),
      submittedBy: 'mgr-1',
    });

    const charges = await chargesForResident(deps, maria);

    assert.equal(
      charges.lines.some((line) => line.title.includes('ОДН')),
      false,
    );
  });

  it('прибор заводит управляющая компания, и второй такой же не заводится', async () => {
    const { deps } = setup();

    const meter = await addHouseMeter(deps, nina, { kind: 'cold_water', serial: 'ОДПУ-1' });

    assert.equal(meter.buildingId, BUILDING_ID);

    await assert.rejects(addHouseMeter(deps, nina, { kind: 'cold_water', serial: 'ОДПУ-2' }), /уже заведён/);
  });

  it('жилец к узлу учёта не допускается', async () => {
    const { deps } = setup();

    await assert.rejects(addHouseMeter(deps, maria, { kind: 'cold_water', serial: 'ОДПУ-1' }), /управляющий/);
    await assert.rejects(houseMetersFor(deps, maria), /управляющая компания/);
  });

  it('прибор заводит управляющий, а показание снимает вся смена', async () => {
    const { deps } = setup();
    const master: Resident = {
      id: 'tech-1',
      maxUserId: 6006,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    await assert.rejects(addHouseMeter(deps, master, { kind: 'cold_water', serial: 'ОДПУ-1' }), /управляющий/);

    const meter = await addHouseMeter(deps, nina, { kind: 'cold_water', serial: 'ОДПУ-1' });

    await assert.doesNotReject(submitHouseReading(deps, master, { meterId: meter.id, value: 1000 }));
  });

  it('показание узла учёта записывается в журнал действий', async () => {
    const { deps } = setup();

    const meter = await addHouseMeter(deps, nina, { kind: 'cold_water', serial: 'ОДПУ-1' });

    await submitHouseReading(deps, nina, { meterId: meter.id, value: 1000 });

    const journal = await listAudit(deps, nina, { limit: 10 });

    assert.deepEqual(
      journal.filter((entry) => entry.subject === 'ОДПУ-1').map((entry) => entry.action),
      ['house_meter_added', 'house_reading_submitted'],
    );
  });

  it('показание меньше прошлого месяца узел учёта не принимает', async () => {
    const { deps, repository } = setup();

    const meter = await addHouseMeter(deps, nina, { kind: 'cold_water', serial: 'ОДПУ-1' });

    await repository.saveHouseReading({
      id: 'hr-0',
      meterId: meter.id,
      value: 1000,
      at: new Date('2026-08-20T10:00:00Z'),
      submittedBy: nina.id,
    });

    await assert.rejects(submitHouseReading(deps, nina, { meterId: meter.id, value: 900 }), /не может показать меньше/);
  });

  it('второе показание за тот же месяц исправляет первое', async () => {
    const { deps } = setup();

    const meter = await addHouseMeter(deps, nina, { kind: 'cold_water', serial: 'ОДПУ-1' });

    await submitHouseReading(deps, nina, { meterId: meter.id, value: 1100 });
    await submitHouseReading(deps, nina, { meterId: meter.id, value: 1010 });

    const [state] = await houseMetersFor(deps, nina);

    assert.equal(state?.last?.value, 1010);
  });

  it('расход узла учёта виден управляющей компании', async () => {
    const { deps, repository } = setup();

    await withMeters(repository);

    const [state] = await houseMetersFor(deps, nina);

    assert.equal(state?.meter.serial, 'ОДПУ-1');
    assert.equal(state?.lastConsumption, 100);
    assert.equal(state?.submittedThisMonth, false);
  });

  it('узел учёта забросили, начисляем по нему ноль, а не цифру из архива', async () => {
    const { deps, repository } = setup(new Date('2027-01-15T10:00:00Z'));

    await withMeters(repository);

    const charges = await chargesForResident(deps, maria);

    assert.equal(
      charges.lines.some((line) => line.title.includes('ОДН')),
      false,
      'месяц из архива в новую квитанцию не попадает',
    );
  });
});

describe('напоминание про узел учёта', () => {
  /** Окно подачи показаний: 20-е число внутри него, 5-е, нет. */
  const inWindow = new Date('2026-09-22T10:00:00Z');

  it('в окне подачи будит смену, а не жильцов', async () => {
    const { deps, repository, notifier } = setup(inWindow);

    await repository.saveHouseMeter({
      id: 'h-1',
      buildingId: BUILDING_ID,
      kind: 'cold_water',
      serial: 'ОДПУ-1',
    });

    const woken = await remindAboutHouseMeters(deps, BUILDING_ID);

    assert.deepEqual(
      woken.map((person) => person.id),
      [nina.id],
    );
    assert.match(notifier.sent[0]?.text ?? '', /Не снято показание узла учёта по дому Д15/);
    assert.match(notifier.sent[0]?.text ?? '', /общедомовые нужды в квитанции не начислятся/);
  });

  it('показание за этот месяц уже сняли, не беспокоим', async () => {
    const { deps, repository, notifier } = setup(inWindow);

    await repository.saveHouseMeter({
      id: 'h-1',
      buildingId: BUILDING_ID,
      kind: 'cold_water',
      serial: 'ОДПУ-1',
    });
    await repository.saveHouseReading({
      id: 'hr-1',
      meterId: 'h-1',
      value: 1000,
      at: new Date('2026-09-21T10:00:00Z'),
      submittedBy: nina.id,
    });

    assert.deepEqual(await remindAboutHouseMeters(deps, BUILDING_ID), []);
    assert.equal(notifier.sent.length, 0);
  });

  it('вне окна подачи молчит', async () => {
    const { deps, repository } = setup();

    await repository.saveHouseMeter({
      id: 'h-1',
      buildingId: BUILDING_ID,
      kind: 'cold_water',
      serial: 'ОДПУ-1',
    });

    assert.deepEqual(await remindAboutHouseMeters(deps, BUILDING_ID), []);
  });

  it('без узла учёта напоминать не о чем', async () => {
    const { deps } = setup(inWindow);

    assert.deepEqual(await remindAboutHouseMeters(deps, BUILDING_ID), []);
  });
});
