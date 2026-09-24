import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createCollectingNotifier,
  createServiceRequest,
  submitProblem,
  type AppDeps,
  type Resident,
} from '@domovoy/app';

import { advanceDemoShift, SHIFT_PAUSES_MS } from '../dist/demo-shift.js';
import { demoData, seedDemo } from '../dist/demo.js';

/** Часы, которые тест двигает сам: смена меряет паузы по ним. */
const setup = async (withRequests = false) => {
  let at = new Date('2026-09-23T12:00:00Z').getTime();
  let counter = 0;
  const notifier = createCollectingNotifier();
  const deps: AppDeps = {
    repository: new InMemoryRepository(),
    now: () => new Date(at),
    createId: () => `id-${++counter}`,
    defaultBuildingId: demoData().buildingId,
    notifier,
  };

  await seedDemo(deps, { withRequests });

  return { deps, notifier, pass: (ms: number) => (at += ms) };
};

const reviewer: Resident = {
  id: 'res-reviewer',
  maxUserId: 777002,
  displayName: 'Проверяющий',
  role: 'resident',
  buildingId: demoData().buildingId,
  apartmentId: 'apt-5',
  apartmentIds: ['apt-5'],
  legalVersion: 'v1',
};

describe('виртуальная смена', () => {
  it('ведёт заявку проверяющего до сдачи работы с паузами, а принять её оставляет ему', async () => {
    const { deps, notifier, pass } = await setup();

    await deps.repository.saveResident(reviewer);

    const created = await createServiceRequest(deps, {
      resident: reviewer,
      description: 'Не закрывается окно в подъезде на третьем этаже',
      startParam: 'ent_dom15_1',
    });
    const status = async () => (await deps.repository.findRequest(created.id))?.status;
    const sentBefore = notifier.sent.length;

    // Раньше паузы смена не торопится.
    pass(SHIFT_PAUSES_MS.accept - 1000);
    assert.equal(await advanceDemoShift(deps), 0);
    assert.equal(await status(), 'new');

    pass(1000);
    await advanceDemoShift(deps);
    assert.equal(await status(), 'accepted');

    pass(SHIFT_PAUSES_MS.start);
    await advanceDemoShift(deps);
    assert.equal(await status(), 'in_progress');
    assert.match(
      notifier.sent.filter((sent) => sent.maxUserId === reviewer.maxUserId).at(-1)?.text ?? '',
      /Работу ведёт Сергей Малых/u,
      'жилец не знает, кого ждать',
    );

    pass(SHIFT_PAUSES_MS.finish);
    await advanceDemoShift(deps);
    assert.equal(await status(), 'done');

    // Дальше решает сам жилец.
    pass(SHIFT_PAUSES_MS.finish * 10);
    assert.equal(await advanceDemoShift(deps), 0);
    assert.equal(await status(), 'done');

    assert.ok(
      notifier.sent.slice(sentBefore).some((sent) => sent.maxUserId === reviewer.maxUserId),
      'жильцу не пришло ни одного уведомления о ходе заявки',
    );
  });

  it('ведёт и аварию, к которой проверяющий присоединился соседом', async () => {
    const { deps, pass } = await setup(true);
    const neighbour: Resident = { ...reviewer, id: 'res-neighbour', maxUserId: 777004, apartmentId: 'apt-10', apartmentIds: ['apt-10'] };

    await deps.repository.saveResident(neighbour);

    const result = await submitProblem(deps, { resident: neighbour, description: 'Нет горячей воды' });

    assert.equal(result.kind, 'joined', `проверяющий не попал в аварию по стояку: ${result.kind}`);
    if (result.kind !== 'joined') return;

    const status = async () => (await deps.repository.findRequest(result.request.id))?.status;

    pass(SHIFT_PAUSES_MS.start);
    await advanceDemoShift(deps);
    assert.equal(await status(), 'in_progress');

    pass(SHIFT_PAUSES_MS.finish);
    await advanceDemoShift(deps);
    assert.equal(await status(), 'done');
  });

  it('заявки набора не трогает', async () => {
    const { deps, pass } = await setup();
    const before = await deps.repository.listRequests({ statuses: ['new', 'accepted', 'in_progress'] });

    pass(60 * 60_000);
    assert.equal(await advanceDemoShift(deps), 0);

    const after = await deps.repository.listRequests({ statuses: ['new', 'accepted', 'in_progress'] });

    assert.deepEqual(
      after.map((request) => request.status),
      before.map((request) => request.status),
    );
  });
});
