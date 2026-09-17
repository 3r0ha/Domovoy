import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  answerAlert,
  bindApartment,
  createCollectingNotifier,
  createServiceRequest,
  housePlan,
  listAnnouncementsFor,
  listOwnApartments,
  listPeople,
  metersFor,
  publishAnnouncement,
  transitionRequest,
  unbindApartment,
  useApartment,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const FIRST = 'b1';
const SECOND = 'b2';

/** Коды из квитанций: ими квартиры и привязываются. */
const NINTH = 'ACEFHK34';
const TWENTIETH = 'LMNPRT47';

const APARTMENTS = [
  { id: 'apt-1', buildingId: FIRST, code: 'UVWXY349', number: 1, entrance: 1, riser: 1, area: 50, residents: 2 },
  { id: 'apt-9', buildingId: FIRST, code: NINTH, number: 9, entrance: 1, riser: 2, area: 60, residents: 1 },
  { id: 'apt-20', buildingId: SECOND, code: TWENTIETH, number: 20, entrance: 1, riser: 1, area: 70, residents: 1 },
];

const owner: Resident = {
  id: 'res-owner',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  apartmentIds: ['apt-1'],
  buildingId: FIRST,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: FIRST,
};

const second: Resident = {
  id: 'disp-2',
  maxUserId: 5006,
  displayName: 'Пётр',
  role: 'dispatcher',
  buildingId: SECOND,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> };

const setup = (residents: Resident[] = [owner]): Deps => ({
  repository: new InMemoryRepository({
    buildings: [
      { id: FIRST, code: 'Д15', address: 'ул. Ленина, 15' },
      { id: SECOND, code: 'Д17', address: 'ул. Ленина, 17' },
    ],
    apartments: APARTMENTS,
    residents,
  }),
  now: () => new Date('2026-09-22T10:00:00Z'),
  createId: () => 'id-1',
  defaultBuildingId: FIRST,
  notifier: createCollectingNotifier(),
});

describe('несколько квартир у одного человека', () => {
  it('вторая квартира добавляется к первой, а не заменяет её', async () => {
    const deps = setup();

    const bound = await bindApartment(deps, owner, NINTH);

    assert.equal(bound.resident.apartmentId, 'apt-9', 'работаем с только что привязанной');
    assert.deepEqual(bound.resident.apartmentIds, ['apt-1', 'apt-9']);
  });

  it('квартира в другом доме переключает и дом', async () => {
    const deps = setup();

    const bound = await bindApartment(deps, owner, TWENTIETH);

    assert.equal(bound.resident.buildingId, SECOND);

    const back = await useApartment(deps, bound.resident, 'apt-1');

    assert.equal(back.buildingId, FIRST, 'возврат к первой квартире возвращает и дом');
  });

  it('список квартир показывает адреса и текущую', async () => {
    const deps = setup();
    const bound = await bindApartment(deps, owner, TWENTIETH);

    assert.deepEqual(
      (await listOwnApartments(deps, bound.resident)).map((item) => [item.address, item.number, item.current]),
      [
        ['ул. Ленина, 15', 1, false],
        ['ул. Ленина, 17', 20, true],
      ],
    );
  });

  it('счётчики и квитанция считаются по текущей квартире', async () => {
    const deps = setup();

    await deps.repository.saveMeter({
      id: 'm-1',
      apartmentId: 'apt-9',
      kind: 'cold_water',
      serial: 'ХВС-009',
    });

    const bound = await bindApartment(deps, owner, NINTH);
    const meters = await metersFor(deps, bound.resident);

    assert.deepEqual(
      meters.map((state) => state.meter.serial),
      ['ХВС-009'],
    );
  });

  it('объявление по стояку второй квартиры доходит, даже когда работаешь с первой', async () => {
    const deps = setup([owner, dispatcher]);

    const bound = await bindApartment(deps, owner, NINTH);
    const back = await useApartment(deps, bound.resident, 'apt-1');

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Стояк 2 без воды',
      body: 'До 14:00',
      entrance: 1,
      riser: 2,
    });

    const news = await listAnnouncementsFor(deps, back);

    assert.deepEqual(
      news.map((item) => item.title),
      ['Стояк 2 без воды'],
    );
  });

  it('чужую квартиру выбрать нельзя', async () => {
    const deps = setup();

    await assert.rejects(useApartment(deps, owner, 'apt-20'), /не привязана/);
  });

  it('отвязка одной квартиры оставляет вторую и делает её текущей', async () => {
    const deps = setup();
    const bound = await bindApartment(deps, owner, NINTH);

    const saved = await unbindApartment(deps, bound.resident, bound.resident.id, 'apt-9');

    assert.deepEqual(saved.apartmentIds, ['apt-1']);
    assert.equal(saved.apartmentId, 'apt-1');
  });

  it('вторую квартиру видит смена того дома, где она стоит', async () => {
    const deps = setup([owner, second]);
    const bound = await bindApartment(deps, owner, TWENTIETH);

    await useApartment(deps, bound.resident, 'apt-1');

    assert.deepEqual(
      (await listPeople(deps, second))
        .filter((person) => person.role === 'resident')
        .map((person) => [person.displayName, person.apartmentId, person.apartmentNumber]),
      [['Мария', 'apt-20', 20]],
    );
  });

  it('смена отвязывает квартиру своего дома, а не ту, с которой человек работает', async () => {
    const deps = setup([owner, second]);
    const bound = await bindApartment(deps, owner, TWENTIETH);
    const back = await useApartment(deps, bound.resident, 'apt-1');

    const saved = await unbindApartment(deps, second, back.id, 'apt-20');

    assert.deepEqual(saved.apartmentIds, ['apt-1']);
    assert.equal(saved.apartmentId, 'apt-1');
  });

  it('об аварии во второй квартире спрашивают, и ответ доходит до плана дома', async () => {
    const deps = setup([owner, second]);
    const bound = await bindApartment(deps, owner, TWENTIETH);

    await useApartment(deps, bound.resident, 'apt-1');

    const water = await createServiceRequest(deps, {
      resident: second,
      description: 'Нет холодной воды в стояке',
      startParam: `rsr_${SECOND}_1_1`,
    });

    await transitionRequest(deps, { resident: second, requestId: water.id, to: 'accepted' });

    const answer = await answerAlert(deps, {
      resident: await deps.repository.findResident(owner.id).then((person) => person!),
      requestId: water.id,
      affected: false,
    });

    assert.equal(answer.counted, true);

    const plan = await housePlan(deps, second);

    assert.deepEqual(
      plan.entrances.flatMap((entrance) => entrance.risers.flatMap((riser) => riser.flats)),
      [{ number: 20, state: 'fine', requestId: water.id }],
    );
  });

  it('человек без квартир числится непривязанным', async () => {
    const deps = setup();
    const saved = await unbindApartment(deps, owner, owner.id, 'apt-1');

    assert.deepEqual(saved.apartmentIds, []);
    assert.equal(saved.apartmentId, undefined);
    assert.deepEqual(
      (await deps.repository.listUnboundResidents()).map((person) => person.id),
      [owner.id],
    );
  });
});
