import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createCollectingNotifier,
  daysLeftPhrase,
  meterHistory,
  metersFor,
  readingProgress,
  remindAboutReadings,
  submitReading,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const WINDOW_DAY = new Date('2026-09-22T10:00:00Z');

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
  { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2 },
];

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const ivan: Resident = {
  id: 'res-ivan',
  maxUserId: 1002,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier>; setNow: (at: Date) => void };

const setup = async (): Promise<Deps> => {
  let counter = 0;
  let now = WINDOW_DAY;
  const notifier = createCollectingNotifier();

  const deps: Deps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: APARTMENTS,
      residents: [maria, ivan],
    }),
    now: () => now,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier,
    setNow: (at) => {
      now = at;
    },
  };

  await deps.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
  await deps.repository.saveMeter({ id: 'hot-1', apartmentId: 'apt-1', kind: 'hot_water', serial: 'ГВС-1' });
  await deps.repository.saveMeter({ id: 'cold-2', apartmentId: 'apt-2', kind: 'cold_water', serial: 'ХВС-2' });

  return deps;
};

describe('счётчики квартиры', () => {
  it('показывают прошлое показание рядом с прибором', async () => {
    const deps = await setup();

    deps.setNow(new Date('2026-08-22T10:00:00Z'));
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 120 });

    deps.setNow(WINDOW_DAY);
    const state = await metersFor(deps, maria);
    const cold = state.find((item) => item.meter.id === 'cold-1');

    assert.equal(state.length, 2, 'только счётчики этой квартиры');
    assert.equal(cold?.last?.value, 120);
    assert.equal(cold?.submittedThisMonth, false, 'показание прошлого месяца текущее не закрывает');
  });

  it('без квартиры счётчиков нет', async () => {
    const deps = await setup();

    await assert.rejects(metersFor(deps, { ...maria, apartmentId: undefined }), /код(а|у)? из квитанции/);
  });

  it('подача считает расход', async () => {
    const deps = await setup();

    deps.setNow(new Date('2026-08-22T10:00:00Z'));
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 120 });

    deps.setNow(WINDOW_DAY);
    const result = await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 123.5 });

    assert.equal(result.consumption, 3.5);
    assert.equal(result.spike, false);
    assert.equal((await metersFor(deps, maria))[0]?.submittedThisMonth, true);
  });

  it('чужой счётчик жильцу недоступен', async () => {
    const deps = await setup();

    await assert.rejects(submitReading(deps, { resident: maria, meterId: 'cold-2', value: 10 }), /другой квартиры/);
  });

  it('сотрудник может подать показание за жильца', async () => {
    const deps = await setup();
    const staff: Resident = {
      id: 'disp-1',
      maxUserId: 5005,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const result = await submitReading(deps, { resident: staff, meterId: 'cold-1', value: 100 });

    assert.equal(result.reading.submittedBy, staff.id);
  });

  it('несуществующий счётчик не принимается', async () => {
    const deps = await setup();

    await assert.rejects(submitReading(deps, { resident: maria, meterId: 'нет', value: 1 }), /не найден/);
  });
});

describe('история показаний', () => {
  const submitOn = async (deps: Deps, month: string, value: number): Promise<void> => {
    deps.setNow(new Date(`2026-${month}-22T10:00:00Z`));
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value });
  };

  it('показывает расход за каждый период, от старых к новым', async () => {
    const deps = await setup();

    await submitOn(deps, '06', 100);
    await submitOn(deps, '07', 104);
    await submitOn(deps, '08', 109);

    const history = await meterHistory(deps, maria, 'cold-1');

    assert.deepEqual(
      history.map((period) => period.value),
      [100, 104, 109],
    );
    assert.deepEqual(
      history.map((period) => period.consumption),
      [0, 4, 5],
    );
  });

  it('длину истории ограничивают', async () => {
    const deps = await setup();

    await submitOn(deps, '06', 100);
    await submitOn(deps, '07', 104);
    await submitOn(deps, '08', 109);

    const history = await meterHistory(deps, maria, 'cold-1', 2);

    assert.deepEqual(
      history.map((period) => period.value),
      [104, 109],
    );
  });

  it('исправленное показание не остаётся в истории вторым', async () => {
    const deps = await setup();

    await submitOn(deps, '08', 100);
    await submitOn(deps, '09', 999);
    await submitOn(deps, '09', 105);

    const history = await meterHistory(deps, maria, 'cold-1');

    assert.deepEqual(
      history.map((period) => period.value),
      [100, 105],
    );
  });

  it('чужую историю жильцу не показывают', async () => {
    const deps = await setup();

    await assert.rejects(meterHistory(deps, maria, 'cold-2'), /другой квартиры/);
    await assert.rejects(meterHistory(deps, maria, 'нет'), /не найден/);
  });
});

describe('резкий расход', () => {
  it('жильца предупреждают, а заявку не заводят', async () => {
    const deps = await setup();

    for (const [month, value] of [
      ['2026-06-22', 100],
      ['2026-07-22', 103],
      ['2026-08-22', 106],
    ] as const) {
      deps.setNow(new Date(`${month}T10:00:00Z`));
      await submitReading(deps, { resident: maria, meterId: 'cold-1', value });
    }

    deps.notifier.sent.length = 0;
    deps.setNow(WINDOW_DAY);

    const result = await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 121 });

    assert.equal(result.spike, true);
    assert.match(deps.notifier.sent[0]?.text ?? '', /заметно больше обычного/);
    assert.match(deps.notifier.sent[0]?.text ?? '', /проверьте краны/);

    assert.equal((await deps.repository.listRequests({})).length, 0);
  });
});

describe('напоминание о показаниях', () => {
  it('уходит только тем, кто ещё не подал', async () => {
    const deps = await setup();

    await submitReading(deps, { resident: ivan, meterId: 'cold-2', value: 55 });
    deps.notifier.sent.length = 0;

    const reminded = await remindAboutReadings(deps, BUILDING_ID);

    assert.deepEqual(
      reminded.map((resident) => resident.id),
      [maria.id],
    );
    assert.match(deps.notifier.sent[0]?.text ?? '', /осталось 3 дня/);
    assert.match(deps.notifier.sent[0]?.text ?? '', /Холодная вода \(ХВС-1\)/);
  });

  it('дом читается пачкой: по прибору на квартиру, сотни запросов', async () => {
    const deps = await setup();
    const calls: string[] = [];

    const counted: AppDeps = {
      ...deps,
      repository: Object.assign(Object.create(Object.getPrototypeOf(deps.repository)), deps.repository, {
        listMeters: async (apartmentId: string) => {
          calls.push('приборы квартиры');
          return deps.repository.listMeters(apartmentId);
        },
        listReadings: async (meterId: string) => {
          calls.push('показания прибора');
          return deps.repository.listReadings(meterId);
        },
        listMetersByApartments: async (ids: readonly string[]) => {
          calls.push('приборы дома');
          return deps.repository.listMetersByApartments(ids);
        },
        listReadingsFor: async (ids: readonly string[]) => {
          calls.push('показания дома');
          return deps.repository.listReadingsFor(ids);
        },
      }),
    };

    await remindAboutReadings(counted, BUILDING_ID);

    assert.deepEqual(calls, ['приборы дома', 'показания дома']);
  });

  it('о просроченной поверке говорят вместо того, чтобы торопить с показаниями', async () => {
    const deps = await setup();

    await deps.repository.saveMeter({
      id: 'cold-1',
      apartmentId: 'apt-1',
      kind: 'cold_water',
      serial: 'ХВС-1',
      verifiedUntil: new Date('2026-06-01T00:00:00Z'),
    });

    await remindAboutReadings(deps, BUILDING_ID);

    const text = deps.notifier.sent.find((message) => /ХВС-1/.test(message.text))?.text ?? '';

    assert.match(text, /Истекла поверка: Холодная вода \(ХВС-1\)/);
    assert.match(text, /начисляют по нормативу/);
    const [ask] = text.split('Истекла поверка');

    assert.match(ask ?? '', /Горячая вода \(ГВС-1\)/, 'остальные счётчики всё так же ждут показаний');
    assert.doesNotMatch(ask ?? '', /ХВС-1/);
  });

  it('вне окна подачи никого не беспокоит', async () => {
    const deps = await setup();
    deps.setNow(new Date('2026-09-10T10:00:00Z'));

    assert.deepEqual(await remindAboutReadings(deps, BUILDING_ID), []);
    assert.deepEqual(deps.notifier.sent, []);
  });

  it('склоняет дни вместе с глаголом', async () => {
    const deps = await setup();

    for (const [day, phrase] of [
      ['2026-09-24', 'остался 1 день'],
      ['2026-09-23', 'осталось 2 дня'],
      ['2026-09-20', 'осталось 5 дней'],
    ] as const) {
      deps.setNow(new Date(`${day}T10:00:00Z`));
      deps.notifier.sent.length = 0;

      await remindAboutReadings(deps, BUILDING_ID);

      assert.match(deps.notifier.sent[0]?.text ?? '', new RegExp(phrase));
    }
  });

  it('одиннадцать дней, исключение из правила', () => {
    assert.equal(daysLeftPhrase(11), 'осталось 11 дней');
    assert.equal(daysLeftPhrase(21), 'остался 21 день');
    assert.equal(daysLeftPhrase(22), 'осталось 22 дня');
  });
});

describe('дом собирает показания вместе', () => {
  it('считает квартиры, а не приборы', async () => {
    const deps = await setup();

    assert.deepEqual(await readingProgress(deps, BUILDING_ID), { total: 2, submitted: 0 });

    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 100 });

    assert.deepEqual(await readingProgress(deps, BUILDING_ID), { total: 2, submitted: 0 });

    await submitReading(deps, { resident: maria, meterId: 'hot-1', value: 50 });

    assert.deepEqual(await readingProgress(deps, BUILDING_ID), { total: 2, submitted: 1 });
  });

  it('вне окна подачи полоса не показывается', async () => {
    const deps = await setup();

    deps.setNow(new Date('2026-09-10T09:00:00Z'));

    assert.equal(await readingProgress(deps, BUILDING_ID), undefined);
  });
});

describe('расход выше соседского', () => {
  /** Дом, где у соседей есть по два показания подряд: только так виден расход. */
  const withNeighbours = async (deps: Deps, spent: number[], buildingId = BUILDING_ID): Promise<void> => {
    for (const [index, value] of spent.entries()) {
      const apartmentId = `apt-n${buildingId}-${index}`;
      const meterId = `cold-n${buildingId}-${index}`;

      await deps.repository.saveApartment({
        id: apartmentId,
        buildingId,
        number: 100 + index,
        entrance: 1,
        riser: 1,
      });
      await deps.repository.saveMeter({ id: meterId, apartmentId, kind: 'cold_water', serial: `ХВС-${100 + index}` });

      await deps.repository.saveReading({
        id: `r-${meterId}-1`,
        meterId,
        value: 100,
        at: new Date('2026-08-22T10:00:00Z'),
        submittedBy: 'res-neighbour',
      });
      await deps.repository.saveReading({
        id: `r-${meterId}-2`,
        meterId,
        value: 100 + value,
        at: new Date('2026-09-22T10:00:00Z'),
        submittedBy: 'res-neighbour',
      });
    }
  };

  it('ровный высокий расход замечают по соседям, а не по своей истории', async () => {
    const deps = await setup();

    await withNeighbours(deps, [3, 4, 5, 4]);

    deps.setNow(new Date('2026-08-22T10:00:00Z'));
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 100 });

    deps.setNow(WINDOW_DAY);
    deps.notifier.sent.length = 0;

    const result = await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 112 });

    assert.equal(result.spike, false, 'по своей истории это не скачок');

    const warned = deps.notifier.sent.find((item) => /выше, чем у соседей/.test(item.text));

    assert.ok(warned, 'жильца не предупредили');
    assert.equal(warned?.maxUserId, maria.maxUserId);
    assert.match(warned?.text ?? '', /12 м³ против 4 м³/);
    assert.match(warned?.text ?? '', /подтекающий бачок/);
  });

  it('обычный расход поводом для письма не становится', async () => {
    const deps = await setup();

    await withNeighbours(deps, [3, 4, 5, 4]);

    deps.setNow(new Date('2026-08-22T10:00:00Z'));
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 100 });

    deps.setNow(WINDOW_DAY);
    deps.notifier.sent.length = 0;
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 105 });

    assert.deepEqual(deps.notifier.sent, []);
  });

  it('за жильца подаёт сотрудник, а соседи берутся из дома квартиры', async () => {
    const deps = await setup();
    const other = 'b9';

    await deps.repository.saveBuilding({ id: other, code: 'Д9', address: 'ул. Мира, 9' });
    await withNeighbours(deps, [3, 4, 5, 4]);
    // В доме, где сотрудник ведёт смену, расход совсем другой.
    await withNeighbours(deps, [30, 40, 50, 40], other);

    const dispatcher: Resident = {
      id: 'disp-1',
      maxUserId: 5005,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: other,
      servesBuildingIds: [BUILDING_ID],
    };

    deps.setNow(new Date('2026-08-22T10:00:00Z'));
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 100 });

    deps.setNow(WINDOW_DAY);
    deps.notifier.sent.length = 0;

    await submitReading(deps, { resident: dispatcher, meterId: 'cold-1', value: 112 });

    const warned = deps.notifier.sent.find((item) => /выше, чем у соседей/.test(item.text));

    assert.ok(warned, 'сравнили с соседями по дому квартиры');
    assert.match(warned?.text ?? '', /12 м³ против 4 м³/);
  });

  it('в доме без соседей с приборами продукт молчит', async () => {
    const deps = await setup();

    deps.setNow(new Date('2026-08-22T10:00:00Z'));
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 100 });

    deps.setNow(WINDOW_DAY);
    deps.notifier.sent.length = 0;
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 190 });

    assert.equal(deps.notifier.sent.some((item) => /выше, чем у соседей/.test(item.text)), false);
  });
});
