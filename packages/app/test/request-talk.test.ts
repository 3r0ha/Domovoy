import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  commentRequest,
  createCollectingNotifier,
  submitProblem,
  transitionRequest,
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

const olga: Resident = {
  id: 'disp-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const sergey: Resident = {
  id: 'tech-1',
  maxUserId: 2002,
  displayName: 'Сергей',
  role: 'technician',
  buildingId: BUILDING_ID,
};

const setup = (): { deps: AppDeps; notifier: ReturnType<typeof createCollectingNotifier> } => {
  const notifier = createCollectingNotifier();
  let counter = 0;

  const deps: AppDeps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
      residents: [maria, olga, sergey],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier,
  };

  return { deps, notifier };
};

describe('переписка по заявке', () => {
  it('ответ жильца получает и мастер, и тот из смены, кто спрашивал', async () => {
    const { deps, notifier } = setup();

    const created = await submitProblem(deps, { resident: maria, description: 'Не идёт горячая вода' });

    if (created.kind !== 'created') throw new Error('заявка не завелась');

    const { id } = created.request;

    await transitionRequest(deps, { resident: olga, requestId: id, to: 'accepted' });
    await transitionRequest(deps, { resident: olga, requestId: id, to: 'in_progress', assigneeId: sergey.id });

    await commentRequest(deps, { resident: olga, requestId: id, text: 'Мастер подъедет после обеда, будете дома?' });

    notifier.sent.length = 0;

    await commentRequest(deps, { resident: maria, requestId: id, text: 'Да, после 15:00' });

    const told = notifier.sent.filter((message) => message.text.includes('Да, после 15:00'));

    assert.deepEqual(
      told.map((message) => message.maxUserId).sort((left, right) => left - right),
      [olga.maxUserId, sergey.maxUserId],
    );
  });

  it('возврат работы доходит до мастера, которого не меняли', async () => {
    const { deps, notifier } = setup();

    const created = await submitProblem(deps, { resident: maria, description: 'Не горит лампа в подъезде' });

    if (created.kind !== 'created') throw new Error('заявка не завелась');

    const { id } = created.request;

    await transitionRequest(deps, { resident: olga, requestId: id, to: 'accepted' });
    await transitionRequest(deps, { resident: olga, requestId: id, to: 'in_progress', assigneeId: sergey.id });
    await transitionRequest(deps, { resident: sergey, requestId: id, to: 'done', comment: 'Поменял лампу' });

    notifier.sent.length = 0;

    await transitionRequest(deps, { resident: maria, requestId: id, to: 'in_progress', comment: 'Так и не горит' });

    assert.ok(
      notifier.sent.some((message) => message.maxUserId === sergey.maxUserId),
      'мастер узнаёт, что работу вернули',
    );
  });

  it('пока смена не писала, ответ жильца видит один исполнитель', async () => {
    const { deps, notifier } = setup();

    const created = await submitProblem(deps, { resident: maria, description: 'Не горит лампа в подъезде' });

    if (created.kind !== 'created') throw new Error('заявка не завелась');

    const { id } = created.request;

    await transitionRequest(deps, { resident: olga, requestId: id, to: 'accepted' });
    await transitionRequest(deps, { resident: olga, requestId: id, to: 'in_progress', assigneeId: sergey.id });

    notifier.sent.length = 0;

    await commentRequest(deps, { resident: maria, requestId: id, text: 'Всё ещё темно' });

    const told = notifier.sent.filter((message) => message.text.includes('Всё ещё темно'));

    assert.deepEqual(
      told.map((message) => message.maxUserId),
      [sergey.maxUserId],
    );
  });
});
