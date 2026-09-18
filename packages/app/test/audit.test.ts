import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  assignRole,
  createMockHub,
  createServiceRequest,
  formatAudit,
  listAudit,
  openDevice,
  setDuty,
  startPoll,
  submitReading,
  transitionRequest,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-22T10:00:00Z');

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'staff-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const manager: Resident = {
  id: 'staff-2',
  maxUserId: 2002,
  displayName: 'Нина',
  role: 'manager',
  buildingId: BUILDING_ID,
};

const setup = async (): Promise<AppDeps> => {
  let counter = 0;

  const deps: AppDeps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 7, entrance: 1, riser: 1, area: 50 }],
      residents: [maria, dispatcher, manager],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    hub: createMockHub({
      now: () => NOW,
      devices: [{ id: 'door-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 1', entrance: 1 }],
    }),
  };

  await deps.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

  return deps;
};

describe('журнал действий', () => {
  it('помнит роли, дежурство и собрание', async () => {
    const deps = await setup();

    await assignRole(deps, manager, { residentId: maria.id, role: 'technician' });
    await setDuty(deps, manager, { residentId: dispatcher.id, onDuty: true });
    await startPoll(deps, {
      resident: manager,
      kind: 'simple',
      title: 'Шлагбаум',
      question: 'Установить шлагбаум',
      days: 7,
    });

    const entries = await listAudit(deps, manager);

    assert.deepEqual(
      entries.map((entry) => entry.action).sort(),
      ['duty_changed', 'poll_started', 'role_assigned'],
    );
    assert.equal(entries.every((entry) => entry.actorName === 'Нина'), true);
  });

  it('помнит открытую сотрудником дверь и показание за жильца', async () => {
    const deps = await setup();

    await openDevice(deps, dispatcher, 'door-1');
    await submitReading(deps, { resident: dispatcher, meterId: 'cold-1', value: 120 });

    const entries = await listAudit(deps, manager);

    assert.deepEqual(
      entries.map((entry) => `${entry.action}:${entry.subject ?? ''}`).sort(),
      ['door_opened:Домофон, подъезд 1', 'reading_submitted:ХВС-1'],
    );
  });

  it('помнит отказ по заявке вместе с причиной', async () => {
    const deps = await setup();

    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'rejected',
      comment: 'Это зона ответственности собственника',
    });

    const [entry] = await listAudit(deps, manager);

    assert.equal(entry?.action, 'request_rejected');
    assert.equal(entry?.subject, request.number);
    assert.equal(entry?.details, 'Это зона ответственности собственника');
  });

  it('помнит работу по заявке: смену состояния и назначение исполнителя', async () => {
    const deps = await setup();
    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'in_progress',
      assigneeId: manager.id,
    });

    const entries = await listAudit(deps, manager);

    assert.deepEqual(
      entries.map((entry) => `${entry.action}:${entry.subject ?? ''}`).sort(),
      [
        `request_assigned:${request.number}`,
        `request_status:${request.number}`,
        `request_status:${request.number}`,
      ].sort(),
    );

    assert.equal(
      entries.find((entry) => entry.action === 'request_assigned')?.details,
      'Нина',
      'в журнале видно, кому поручили',
    );

    assert.deepEqual(
      entries
        .filter((entry) => entry.action === 'request_status')
        .map((entry) => entry.details)
        .sort(),
      ['выполняется', 'принята в работу'].sort(),
    );
  });

  it('заявку сотрудника журнал помнит, а заявку жильца, нет', async () => {
    const deps = await setup();

    await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });

    const byStaff = await createServiceRequest(deps, {
      resident: dispatcher,
      description: 'Не горит лампа в подъезде',
      apartmentId: 'apt-1',
    });

    const entries = await listAudit(deps, manager);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.action, 'request_created');
    assert.equal(entries[0]?.subject, byStaff.number);
    assert.equal(entries[0]?.actorName, 'Ольга');
  });

  it('свои действия жильца в служебный журнал не идут', async () => {
    const deps = await setup();

    await openDevice(deps, maria, 'door-1');
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 120 });

    assert.deepEqual(await listAudit(deps, manager), []);
  });

  it('смотрит управляющий, а не смена', async () => {
    const deps = await setup();

    await assert.rejects(listAudit(deps, dispatcher), /смотрит управляющий/);
    await assert.rejects(listAudit(deps, maria), /смотрит управляющий/);
  });

  it('листается страницами, свежее впереди', async () => {
    const deps = await setup();
    let tick = NOW.getTime();

    const clocked: AppDeps = { ...deps, now: () => new Date((tick += 60_000)) };

    for (const onDuty of [true, false, true]) {
      await setDuty(clocked, manager, { residentId: dispatcher.id, onDuty });
    }

    const [first] = await listAudit(clocked, manager, { limit: 1 });
    const older = await listAudit(clocked, manager, { limit: 1, before: first!.at });

    assert.equal(first?.at.getTime(), NOW.getTime() + 3 * 60_000);
    assert.equal(older[0]?.at.getTime(), NOW.getTime() + 2 * 60_000);
  });

  it('строка читается человеком', async () => {
    const deps = await setup();

    await assignRole(deps, manager, { residentId: maria.id, role: 'technician' });

    const [entry] = await listAudit(deps, manager);

    assert.match(formatAudit(entry!, 'Europe/Moscow'), /22 сентября в 13:00 · Нина\nНазначена роль: Мария\nмастер/);
  });
});
