import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, type Resident } from '../dist/index.js';

const BUILDING_ID = 'b1';

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const repository = (): InMemoryRepository =>
  new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
    apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 }],
    residents: [maria],
  });

/**
 * Стенд и показ работают на хранилище в памяти, а не на базе. Гарантии у них
 * должны совпадать: иначе дефект видно только там, где базы нет.
 */
describe('хранилище в памяти', () => {
  it('номер заявки не повторяется, даже когда заявки заводят разом', async () => {
    const kept = repository();
    const at = new Date('2026-09-22T10:00:00Z');

    const numbers = await Promise.all([
      kept.nextRequestSequence(BUILDING_ID, at),
      kept.nextRequestSequence(BUILDING_ID, at),
      kept.nextRequestSequence(BUILDING_ID, at),
    ]);

    assert.deepEqual(numbers, [1, 2, 3]);
  });

  it('счёт номеров идёт по дому и месяцу', async () => {
    const kept = repository();

    assert.equal(await kept.nextRequestSequence(BUILDING_ID, new Date('2026-09-22T10:00:00Z')), 1);
    assert.equal(await kept.nextRequestSequence('b2', new Date('2026-09-22T10:00:00Z')), 1);
    assert.equal(await kept.nextRequestSequence(BUILDING_ID, new Date('2026-10-01T10:00:00Z')), 1);
    assert.equal(await kept.nextRequestSequence(BUILDING_ID, new Date('2026-09-23T10:00:00Z')), 2);
  });

  it('показание за тот же момент заменяет прежнее, а не ложится рядом', async () => {
    const kept = repository();
    const at = new Date('2026-09-22T10:00:00Z');

    await kept.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await kept.saveReading({ id: 'r-1', meterId: 'cold-1', value: 100, at, submittedBy: maria.id });
    await kept.saveReading({ id: 'r-2', meterId: 'cold-1', value: 120, at, submittedBy: maria.id });

    const readings = await kept.listReadings('cold-1');

    assert.equal(readings.length, 1, 'за один момент осталось два показания');
    assert.equal(readings[0]?.value, 120);
  });

  it('прибор учёта на дом остаётся один на ресурс', async () => {
    const kept = repository();

    await kept.saveHouseMeter({ id: 'house-1', buildingId: BUILDING_ID, kind: 'cold_water', serial: 'ОДПУ-1' });
    await kept.saveHouseMeter({ id: 'house-2', buildingId: BUILDING_ID, kind: 'cold_water', serial: 'ОДПУ-2' });

    const meters = await kept.listHouseMeters(BUILDING_ID);

    assert.deepEqual(meters.map((meter) => meter.id), ['house-2']);
  });

  it('сохранение по устаревшей копии не стирает событие другой стороны', async () => {
    const kept = repository();

    const created = await kept.createRequest({
      id: 'req-1',
      buildingId: BUILDING_ID,
      buildingCode: 'Д15',
      sequence: 1,
      authorId: maria.id,
      description: 'Не горит свет',
      category: 'electricity',
      target: { kind: 'apartment', apartmentId: 'apt-1' },
      createdAt: new Date('2026-09-22T10:00:00Z'),
    });

    const event = {
      at: new Date('2026-09-22T11:00:00Z'),
      status: 'accepted' as const,
      role: 'dispatcher' as const,
      actorId: 'disp-1',
    };

    await kept.saveRequest({ ...created, status: 'accepted', history: [...created.history, event] });

    // Вторая сторона сохраняет заявку по копии, прочитанной до назначения.
    const saved = await kept.saveRequest({ ...created, status: 'new' });

    assert.equal(saved.status, 'accepted', 'состояние откатилось к прочитанному раньше');
    assert.equal(saved.history.length, created.history.length + 1, 'событие другой стороны пропало');
  });

  it('два разных сообщения в одну секунду остаются двумя, а повтор одного склеивается', async () => {
    const kept = repository();

    const created = await kept.createRequest({
      id: 'req-1',
      buildingId: BUILDING_ID,
      buildingCode: 'Д15',
      sequence: 1,
      authorId: maria.id,
      description: 'Не горит свет',
      category: 'electricity',
      target: { kind: 'apartment', apartmentId: 'apt-1' },
      createdAt: new Date('2026-09-22T10:00:00Z'),
    });

    const at = new Date('2026-09-22T11:00:00Z');
    const first = {
      at,
      status: 'new' as const,
      role: 'resident' as const,
      actorId: maria.id,
      kind: 'message' as const,
      comment: 'Свет мигает',
    };
    const second = { ...first, comment: 'Теперь совсем погас' };

    await kept.saveRequest({ ...created, history: [...created.history, first] });
    await kept.saveRequest({ ...created, history: [...created.history, first, second] });
    const saved = await kept.saveRequest({ ...created, history: [...created.history, second] });

    assert.deepEqual(
      saved.history.filter((event) => event.kind === 'message').map((event) => event.comment),
      ['Свет мигает', 'Теперь совсем погас'],
    );
  });
});
