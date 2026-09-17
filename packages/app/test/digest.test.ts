import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  countForDigest,
  createServiceRequest,
  formatDigest,
  planInspections,
  sendMorningDigest,
  sendMorningDigests,
  transitionRequest,
  type Notification,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-20T08:00:00Z');
const HOUR = 60 * 60 * 1000;

const DISPATCHER: Resident = {
  id: 'staff-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const TECHNICIAN: Resident = {
  id: 'staff-2',
  maxUserId: 2002,
  displayName: 'Сергей',
  role: 'technician',
  buildingId: BUILDING_ID,
};

const IVAN: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const setup = async (staff: Resident[] = [DISPATCHER, TECHNICIAN]) => {
  const repository = new InMemoryRepository();
  const sent: Notification[] = [];
  let clock = NOW.getTime();
  let counter = 0;

  await repository.saveBuilding({ id: BUILDING_ID, code: 'Д1', address: 'ул. Ленина, 1', managementCompany: 'УК' });
  await repository.saveApartment({ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 40 });

  for (const person of [...staff, IVAN]) await repository.saveResident(person);

  const deps = {
    repository,
    now: () => new Date(clock),
    createId: () => `id-${(counter += 1)}`,
    defaultBuildingId: BUILDING_ID,
    notifier: {
      async send(notification: Notification) {
        sent.push(notification);
      },
    },
  };

  const complain = async (hoursAgo: number, description = 'Течёт кран') => {
    clock = NOW.getTime() - hoursAgo * HOUR;

    const request = await createServiceRequest(deps, { resident: IVAN, description });

    clock = NOW.getTime();

    return request;
  };

  return { deps, repository, sent, complain };
};

describe('утренняя сводка', () => {
  it('считает то, с чего начинается смена', async () => {
    const { deps, repository, complain } = await setup();

    await complain(3);
    await complain(2, 'Прорыв трубы, заливает');
    await complain(40);

    const counts = countForDigest(await repository.listRequests({ buildingId: BUILDING_ID }), deps.now());

    assert.equal(counts.created, 2);
    assert.equal(counts.emergency, 1);
    assert.equal(counts.open, 3);
    assert.ok(counts.overdue >= 1, 'старая заявка горит');
  });

  it('отдельно называет то, что ждёт людей', async () => {
    const { deps, repository, complain } = await setup();

    const done = await complain(3);

    for (const to of ['accepted', 'in_progress', 'done'] as const) {
      await transitionRequest(deps, { resident: DISPATCHER, requestId: done.id, to });
    }

    const asked = await complain(2);

    await transitionRequest(deps, { resident: DISPATCHER, requestId: asked.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: DISPATCHER,
      requestId: asked.id,
      to: 'needs_info',
      comment: 'У соседей вода есть?',
    });

    const counts = countForDigest(await repository.listRequests({ buildingId: BUILDING_ID }), deps.now());

    assert.equal(counts.waiting, 1);
    assert.equal(counts.needsInfo, 1);
  });

  it('уходит дежурной смене одной строкой', async () => {
    const { deps, sent, complain } = await setup();

    await complain(2);

    const staff = await sendMorningDigest(deps, BUILDING_ID);

    assert.deepEqual(
      staff.map((person) => person.id).sort(),
      ['staff-1', 'staff-2'],
    );
    assert.equal(sent.length, 2);
    assert.match(sent[0]?.text ?? '', /Доброе утро/);
    assert.match(sent[0]?.text ?? '', /За сутки: 1/);
    assert.equal(sent.some((item) => item.maxUserId === 1001), false);
  });

  it('в тихом доме молчит, а не шлёт нули', async () => {
    const { deps, sent } = await setup();

    assert.deepEqual(await sendMorningDigest(deps, BUILDING_ID), []);
    assert.equal(sent.length, 0);
    assert.equal(
      formatDigest({ created: 0, emergency: 0, open: 0, overdue: 0, waiting: 0, needsInfo: 0, inspections: 0 }),
      undefined,
    );
  });

  it('изношенное оборудование попадает в сводку, даже когда заявок по нему нет', () => {
    const text = formatDigest({
      created: 0,
      emergency: 0,
      open: 0,
      overdue: 0,
      waiting: 0,
      needsInfo: 0,
      inspections: 0,
      soon: ['Лифт, подъезд 1'],
    });

    assert.match(text ?? '', /Пора смотреть: Лифт, подъезд 1/);
  });

  it('строки без чисел не пишет', () => {
    const text = formatDigest({
      created: 2,
      emergency: 0,
      open: 3,
      overdue: 0,
      waiting: 0,
      needsInfo: 0,
      inspections: 0,
    });

    assert.match(text ?? '', /За сутки: 2\nОткрыто: 3/);
    assert.doesNotMatch(text ?? '', /аварийных|просрочено|Ждут/);
  });

  it('каждому дому, свои числа, и не больше одного сообщения человеку', async () => {
    const { deps, repository, sent, complain } = await setup();

    const second = 'b2';

    await repository.saveBuilding({ id: second, code: 'Д17', address: 'ул. Ленина, 17', managementCompany: 'УК' });
    await repository.saveApartment({ id: 'apt-2', buildingId: second, number: 9, entrance: 1, riser: 1, area: 40 });
    await repository.saveResident({ ...DISPATCHER, id: 'staff-9', maxUserId: 2009, buildingId: second });
    await complain(2);

    sent.length = 0;
    await sendMorningDigests(deps);

    assert.equal(sent.filter((item) => item.maxUserId === 2001).length, 1);
    assert.equal(sent.filter((item) => item.maxUserId === 2009).length, 0);
    assert.match(sent[0]?.text ?? '', /Д1\n/);
  });

  it('просроченный осмотр попадает в сводку даже в тихом доме', async () => {
    const { deps, sent } = await setup();

    const [round] = await planInspections(deps, BUILDING_ID);

    await deps.repository.saveInspection({ ...round!, dueAt: new Date(NOW.getTime() - 24 * HOUR) });

    sent.length = 0;
    await sendMorningDigest(deps, BUILDING_ID);

    assert.match(sent[0]?.text ?? '', /Просрочено осмотров: 1/);
  });
});
