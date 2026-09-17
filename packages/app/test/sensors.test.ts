import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createMockHub,
  raiseSensorAlarm,
  submitProblem,
  type Device,
  type Notification,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-05T10:00:00Z');

const DEVICES: Device[] = [
  { id: 'intercom-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 1', entrance: 1 },
  { id: 'leak-1-2', buildingId: BUILDING_ID, kind: 'leak', title: 'Датчик протечки, стояк 2', entrance: 1, riser: 2 },
  { id: 'smoke-1', buildingId: BUILDING_ID, kind: 'smoke', title: 'Датчик дыма, подъезд 1', entrance: 1 },
];

const PEOPLE: Resident[] = [
  { id: 'staff-1', maxUserId: 2001, displayName: 'Ольга', role: 'dispatcher', buildingId: BUILDING_ID },
  { id: 'boss-1', maxUserId: 2002, displayName: 'Нина', role: 'manager', buildingId: BUILDING_ID },
  { id: 'res-1', maxUserId: 1001, displayName: 'Иван', role: 'resident', apartmentId: 'apt-1', buildingId: BUILDING_ID },
];

const setup = async () => {
  const repository = new InMemoryRepository();
  const hub = createMockHub({ devices: DEVICES, now: () => NOW });
  const sent: Notification[] = [];

  await repository.saveBuilding({ id: BUILDING_ID, code: 'Д1', address: 'ул. Ленина, 1', managementCompany: 'УК' });
  await repository.saveApartment({ id: 'apt-1', buildingId: BUILDING_ID, number: 5, entrance: 1, riser: 2, area: 40 });

  for (const person of PEOPLE) await repository.saveResident(person);

  let counter = 0;

  return {
    repository,
    hub,
    sent,
    deps: {
      repository,
      hub,
      now: () => NOW,
      createId: () => `id-${(counter += 1)}`,
      defaultBuildingId: BUILDING_ID,
      notifier: {
        async send(notification: Notification) {
          sent.push(notification);
        },
      },
    },
  };
};

describe('датчики', () => {
  it('протечка заводит аварийную заявку по своему стояку', async () => {
    const { deps } = await setup();

    const result = await raiseSensorAlarm(deps, BUILDING_ID, 'leak-1-2');

    assert.equal(result.kind, 'created');

    if (result.kind !== 'created') return;

    assert.equal(result.request.category, 'plumbing');
    assert.equal(result.request.priority, 'emergency');
    assert.deepEqual(result.request.target, { kind: 'riser', buildingId: BUILDING_ID, entrance: 1, riser: 2 });
    assert.match(result.request.title, /датчик протечки/i);
  });

  it('заявку подаёт управляющая компания, а не жилец', async () => {
    const { deps } = await setup();

    const result = await raiseSensorAlarm(deps, BUILDING_ID, 'leak-1-2');

    assert.equal(result.kind === 'created' && result.request.authorId, 'boss-1');
  });

  it('смена узнаёт о срабатывании сразу', async () => {
    const { deps, sent } = await setup();

    await raiseSensorAlarm(deps, BUILDING_ID, 'smoke-1');

    const staff = sent.filter((item) => item.maxUserId === 2001);

    assert.equal(staff.length, 1);
    assert.match(staff[0]?.text ?? '', /датчик дыма/i);
  });

  it('срабатывание после жалобы соседа не заводит вторую заявку', async () => {
    const { deps } = await setup();

    const first = await submitProblem(deps, {
      resident: PEOPLE[2]!,
      description: 'Нет горячей воды',
    });

    assert.equal(first.kind, 'created');

    const alarm = await raiseSensorAlarm(deps, BUILDING_ID, 'leak-1-2');

    assert.equal(alarm.kind, 'joined', 'датчик присоединяется к открытой заявке');
  });

  it('домофон датчиком не считается', async () => {
    const { deps } = await setup();

    await assert.rejects(raiseSensorAlarm(deps, BUILDING_ID, 'intercom-1'), /не найден/);
  });
});
