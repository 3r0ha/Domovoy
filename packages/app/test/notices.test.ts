import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createCollectingNotifier,
  createServiceRequest,
  listNotices,
  publishAnnouncement,
  remindAboutReadings,
  setNotice,
  startPoll,
  transitionRequest,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const WINDOW_DAY = new Date('2026-09-22T10:00:00Z');

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
  owned: [{ apartmentId: 'apt-1', share: 1, basis: 'company' }],
};

const dispatcher: Resident = {
  id: 'staff-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> };

const setup = async (): Promise<Deps> => {
  let counter = 0;

  const deps: Deps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
      residents: [maria, dispatcher],
    }),
    now: () => WINDOW_DAY,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
  };

  await deps.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

  return deps;
};

const mute = async (deps: Deps, kind: 'meters' | 'works' | 'polls' | 'news'): Promise<void> => {
  await setNotice(deps, maria, kind, false);
};

const forMaria = (deps: Deps) => deps.notifier.sent.filter((item) => item.maxUserId === maria.maxUserId);

describe('настройки уведомлений', () => {
  it('по умолчанию включено всё', () => {
    assert.deepEqual(
      listNotices(maria).map((notice) => notice.on),
      [true, true, true, true, true],
    );
  });

  it('отключённое напоминание о показаниях не приходит', async () => {
    const deps = await setup();

    await mute(deps, 'meters');
    deps.notifier.sent.length = 0;
    await remindAboutReadings(deps, BUILDING_ID);

    assert.deepEqual(forMaria(deps), []);
  });

  it('отключённые объявления и работы не приходят, а охват их не считает', async () => {
    const deps = await setup();

    await mute(deps, 'news');
    deps.notifier.sent.length = 0;

    const published = await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Субботник',
      body: 'В субботу убираем двор',
    });

    assert.deepEqual(forMaria(deps), []);
    assert.equal(published.notified, 0);
  });

  it('собрание можно отключить, а аварию по своей заявке, нет', async () => {
    const deps = await setup();

    await mute(deps, 'polls');
    deps.notifier.sent.length = 0;

    await startPoll(deps, {
      resident: dispatcher,
      kind: 'simple',
      title: 'Шлагбаум',
      question: 'Установить шлагбаум',
      days: 7,
    });

    assert.deepEqual(forMaria(deps), []);

    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    deps.notifier.sent.length = 0;
    await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to: 'accepted' });

    assert.equal(forMaria(deps).length, 1, 'о своей заявке жилец узнаёт всегда');
  });

  it('включается обратно', async () => {
    const deps = await setup();

    await mute(deps, 'news');

    const back = await setNotice(deps, (await deps.repository.findResident(maria.id))!, 'news', true);

    assert.equal(back.find((notice) => notice.kind === 'news')?.on, true);
  });
});
