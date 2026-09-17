import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SUPPORT_NOTICE_AT } from '@domovoy/domain';

import {
  InMemoryRepository,
  createCollectingNotifier,
  createServiceRequest,
  supportRequest,
  supportableFor,
  transitionRequest,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-07T10:00:00Z');

const person = (id: string, apartmentId: string, maxUserId: number): Resident => ({
  id,
  maxUserId,
  displayName: `Житель ${id}`,
  role: 'resident',
  apartmentId,
  buildingId: BUILDING_ID,
});

const maria = person('res-1', 'apt-1', 1001);
const ivan = person('res-2', 'apt-2', 1002);
const other = person('res-3', 'apt-20', 1020);

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const setup = () => {
  let counter = 0;
  const notifier = createCollectingNotifier();

  const deps: AppDeps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2 },
        { id: 'apt-20', buildingId: BUILDING_ID, number: 20, entrance: 2, riser: 1 },
      ],
      residents: [maria, ivan, other, dispatcher],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier,
  };

  return { deps, notifier };
};

/** Заявка по подъезду: не авария, но и не личное дело одной квартиры. */
const aboutEntrance = (deps: AppDeps) =>
  createServiceRequest(deps, {
    resident: maria,
    description: 'Не убрана площадка второго этажа',
    startParam: 'ent_b1_1',
  });

describe('поддержать заявку соседа', () => {
  it('заявка по подъезду видна соседям из этого подъезда', async () => {
    const { deps } = setup();

    await aboutEntrance(deps);

    assert.equal((await supportableFor(deps, ivan)).length, 1, 'сосед по подъезду');
    assert.equal((await supportableFor(deps, other)).length, 0, 'другой подъезд это не касается');
    assert.equal((await supportableFor(deps, maria)).length, 0, 'своя заявка поддержки не требует');
  });

  it('заявка по квартире соседям не показывается', async () => {
    const { deps } = setup();

    await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    assert.deepEqual(await supportableFor(deps, ivan), []);
  });

  it('поддержавший становится участником заявки и видит её счёт', async () => {
    const { deps } = setup();

    const request = await aboutEntrance(deps);
    const result = await supportRequest(deps, ivan, request.id);

    assert.equal(result.reporters, 2);
    assert.equal((await supportRequest(deps, ivan, request.id)).reporters, 2);
    assert.deepEqual(await supportableFor(deps, ivan), [], 'поддержанное больше не предлагают');
  });

  it('о пятой подписи управляющая компания узнаёт отдельно', async () => {
    const { deps, notifier } = setup();

    const request = await aboutEntrance(deps);

    for (let index = 2; index <= SUPPORT_NOTICE_AT; index += 1) {
      const neighbour = person(`res-n${index}`, `apt-n${index}`, 2000 + index);

      await deps.repository.saveApartment({
        id: `apt-n${index}`,
        buildingId: BUILDING_ID,
        number: 100 + index,
        entrance: 1,
        riser: 1,
      });
      await deps.repository.saveResident(neighbour);

      notifier.sent.length = 0;
      await supportRequest(deps, neighbour, request.id);
    }

    const told = notifier.sent.filter((item) => /поддержали/.test(item.text));

    assert.equal(told.length, 1, 'сообщаем один раз, а не на каждую подпись');
    assert.equal(told[0]?.maxUserId, dispatcher.maxUserId);
    assert.match(told[0]?.text ?? '', new RegExp(`поддержали ${SUPPORT_NOTICE_AT} жильцов`));
  });

  it('закрытую заявку поддерживать поздно', async () => {
    const { deps } = setup();

    const request = await aboutEntrance(deps);

    for (const to of ['accepted', 'in_progress', 'done'] as const) {
      await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to });
    }

    await transitionRequest(deps, { resident: maria, requestId: request.id, to: 'confirmed' });

    await assert.rejects(supportRequest(deps, ivan, request.id), /уже закрыта/);
  });

  it('чужую квартиру поддержать нельзя', async () => {
    const { deps } = setup();

    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    await assert.rejects(supportRequest(deps, ivan, request.id), /по чужой квартире/);
  });
});
