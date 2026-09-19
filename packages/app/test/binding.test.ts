import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apartmentKeyParam } from '@domovoy/domain';

import {
  BIND_ATTEMPTS,
  InMemoryRepository,
  bindApartment,
  bindApartmentByStaff,
  createCollectingNotifier,
  listApartmentsFor,
  listAudit,
  listUnbound,
  metersFor,
  unbindApartment,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

/** Код квартиры хранится в ней самой: из номера и идентификатора он не выводится. */
const CODE = 'ACEFHK34';

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, code: CODE, number: 1, entrance: 1, riser: 1, area: 50 },
  { id: 'apt-2', buildingId: BUILDING_ID, code: 'LMNPRT47', number: 2, entrance: 1, riser: 2, area: 50 },
];

/** Только что написавший боту: продукт знает, кто он, но не знает откуда. */
const newcomer: Resident = {
  id: 'res-new',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  buildingId: BUILDING_ID,
};

const roommate: Resident = {
  id: 'res-roommate',
  maxUserId: 1002,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const manager: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Управляющий',
  role: 'manager',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> };

const setup = (residents: Resident[] = [newcomer]): Deps => ({
  repository: new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15' }],
    apartments: APARTMENTS,
    residents,
  }),
  now: () => new Date('2026-09-22T10:00:00Z'),
  createId: () => 'id-1',
  defaultBuildingId: BUILDING_ID,
  notifier: createCollectingNotifier(),
});

describe('привязка к квартире по коду', () => {
  it('код из квитанции делает жильца жильцом квартиры', async () => {
    const deps = setup();

    const bound = await bindApartment(deps, newcomer, CODE);

    assert.equal(bound.alreadyBound, false);
    assert.equal(bound.apartment.number, 1);
    assert.equal(bound.resident.apartmentId, 'apt-1');

    await assert.doesNotReject(metersFor(deps, bound.resident));
  });

  it('повторный переход по тому же коду ничего не меняет', async () => {
    const deps = setup([{ ...newcomer, apartmentId: 'apt-1' }]);

    const bound = await bindApartment(deps, { ...newcomer, apartmentId: 'apt-1' }, CODE);

    assert.equal(bound.alreadyBound, true);
    assert.deepEqual(deps.notifier.sent, [], 'соседей об этом не беспокоим');
  });

  it('соседи по квартире узнают о новом жильце', async () => {
    const deps = setup([newcomer, roommate]);

    await bindApartment(deps, newcomer, CODE);

    assert.equal(deps.notifier.sent.length, 1);
    assert.equal(deps.notifier.sent[0]?.maxUserId, roommate.maxUserId);
    assert.match(deps.notifier.sent[0]?.text ?? '', /привязался ещё один житель: Мария/);
  });

  it('код подъезда квартирой не считается', async () => {
    const deps = setup();

    await assert.rejects(bindApartment(deps, newcomer, 'ent_b1_1'), /не от квартиры/);
  });

  it('код несуществующей квартиры не принимается', async () => {
    const deps = setup();

    await assert.rejects(bindApartment(deps, newcomer, 'WXYWXY33'), /Код не подошёл/);
  });

  it('мусор вместо кода не принимается', async () => {
    const deps = setup();

    await assert.rejects(bindApartment(deps, newcomer, 'ерунда'), /не от квартиры/);
  });

  it('идентификатор квартиры кодом не работает: его можно подобрать', async () => {
    const deps = setup();

    await assert.rejects(bindApartment(deps, newcomer, 'apt_apt-1'), /не от квартиры/);
    await assert.rejects(bindApartment(deps, newcomer, 'apt-1'), /не от квартиры/);
  });

  it('код принимается как набран: регистр, пробелы и ссылка', async () => {
    const deps = setup();

    for (const written of ['acefhk34', ' ACEF HK34 ', 'ACEF-HK34', apartmentKeyParam(CODE)]) {
      const bound = await bindApartment(deps, newcomer, written);

      assert.equal(bound.apartment.id, 'apt-1', written);
    }
  });

  it('переезд меняет и квартиру, и дом', async () => {
    const deps = setup();

    await deps.repository.saveApartment({
      id: 'apt-99',
      buildingId: 'другой-дом',
      code: 'UVWXY349',
      number: 99,
      entrance: 1,
      riser: 1,
    });

    const bound = await bindApartment(deps, newcomer, 'UVWXY349');

    assert.equal(bound.resident.buildingId, 'другой-дом');
  });
});

describe('привязка сотрудником', () => {
  it('управляющая компания вносит жильца сама', async () => {
    const deps = setup([newcomer, manager]);

    const bound = await bindApartmentByStaff(deps, manager, {
      residentId: newcomer.id,
      apartmentId: 'apt-2',
    });

    assert.equal(bound.resident.apartmentId, 'apt-2');
    assert.match(deps.notifier.sent[0]?.text ?? '', /привязала вас к квартире 2/);
  });

  it('жилец чужую привязку не меняет', async () => {
    const deps = setup([newcomer, roommate]);

    await assert.rejects(
      bindApartmentByStaff(deps, newcomer, { residentId: roommate.id, apartmentId: 'apt-2' }),
      /может управляющая компания/,
    );
  });

  it('квартиру чужой организации сотруднику не привязать', async () => {
    const deps = setup([newcomer, manager]);

    await deps.repository.saveBuilding({ id: 'b2', code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' });

    const stranger: Resident = { ...manager, id: 'mgr-2', maxUserId: 7008, buildingId: 'b2' };

    await assert.rejects(
      bindApartmentByStaff(deps, stranger, { residentId: newcomer.id, apartmentId: 'apt-1' }),
      /Дом не найден/,
    );
  });

  it('сотрудник себя к квартире дома не привязывает', async () => {
    const deps = setup([manager]);

    await assert.rejects(
      bindApartmentByStaff(deps, manager, { residentId: manager.id, apartmentId: 'apt-1' }),
      /по коду из квитанции/,
    );

    assert.equal((await deps.repository.findResident(manager.id))?.apartmentId, undefined);
  });

  it('человека чужой организации к своей квартире не привязывают', async () => {
    const deps = setup([manager]);

    await deps.repository.saveBuilding({ id: 'b2', code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' });

    const alien: Resident = {
      id: 'res-alien',
      maxUserId: 2002,
      displayName: 'Чужой',
      role: 'resident',
      buildingId: 'b2',
    };

    await deps.repository.saveResident(alien);

    await assert.rejects(
      bindApartmentByStaff(deps, manager, { residentId: alien.id, apartmentId: 'apt-1' }),
      /другой управляющей организации/,
    );
  });

  it('привязка попадает в журнал действий', async () => {
    const deps = setup([newcomer, manager]);

    await bindApartmentByStaff(deps, manager, { residentId: newcomer.id, apartmentId: 'apt-2' });

    const [entry] = await listAudit(deps, manager);

    assert.equal(entry?.action, 'apartment_bound');
    assert.equal(entry?.details, 'квартира 2');
  });

  it('неизвестный житель или квартира не принимаются', async () => {
    const deps = setup([newcomer, manager]);

    await assert.rejects(
      bindApartmentByStaff(deps, manager, { residentId: 'нет', apartmentId: 'apt-1' }),
      /Житель не найден/,
    );
    await assert.rejects(
      bindApartmentByStaff(deps, manager, { residentId: newcomer.id, apartmentId: 'нет' }),
      /Квартира не найдена/,
    );
  });
});

describe('список жильцов без квартиры', () => {
  it('показывает только непривязанных жильцов', async () => {
    const deps = setup([newcomer, roommate, manager]);

    assert.deepEqual(await listUnbound(deps, manager), [{ id: newcomer.id, displayName: newcomer.displayName }]);
  });

  it('после привязки жилец из списка пропадает', async () => {
    const deps = setup([newcomer, manager]);

    await bindApartmentByStaff(deps, manager, { residentId: newcomer.id, apartmentId: 'apt-2' });

    assert.deepEqual(await listUnbound(deps, manager), []);
  });

  it('жильцу список закрыт', async () => {
    const deps = setup([newcomer, manager]);

    await assert.rejects(listUnbound(deps, newcomer), /доступен управляющей компании/);
    await assert.rejects(listApartmentsFor(deps, newcomer), /доступен управляющей компании/);
  });

  it('перебор кодов останавливается на шестой попытке', async () => {
    const deps = setup();

    for (let attempt = 0; attempt < BIND_ATTEMPTS; attempt += 1) {
      await assert.rejects(bindApartment(deps, newcomer, `WXYWXY3${'34789'[attempt]}`), /Код не подошёл/);
    }

    await assert.rejects(bindApartment(deps, newcomer, CODE), /Слишком много попыток/);
  });

  it('удачная привязка на предел не влияет', async () => {
    const deps = setup();

    await assert.rejects(bindApartment(deps, newcomer, 'UVWXY349'), /Код не подошёл/);

    const result = await bindApartment(deps, newcomer, CODE);

    assert.equal(result.apartment.id, 'apt-1');
  });

  it('квартиры для выбора идут по возрастанию номера', async () => {
    const deps = setup([manager]);

    assert.deepEqual(
      (await listApartmentsFor(deps, manager)).map((apartment) => apartment.number),
      [1, 2],
    );
  });
});

describe('жилец съехал', () => {
  it('управляющая компания освобождает квартиру, а история дома остаётся', async () => {
    const deps = setup([newcomer, roommate, manager]);
    const bound = await bindApartment(deps, newcomer, CODE);

    deps.notifier.sent.length = 0;

    const saved = await unbindApartment(deps, manager, bound.resident.id);

    assert.equal(saved.apartmentId, undefined);
    assert.equal((await deps.repository.findResident(newcomer.id))?.apartmentId, undefined);
    assert.match(deps.notifier.sent[0]?.text ?? '', /отвязала вас от квартиры 1/);
    assert.match(deps.notifier.sent[0]?.text ?? '', /привяжитесь заново по коду/);
  });

  it('жилец отвязывается сам: «это не моя квартира», его слово', async () => {
    const deps = setup([newcomer, roommate, manager]);
    const bound = await bindApartment(deps, newcomer, CODE);

    deps.notifier.sent.length = 0;

    const saved = await unbindApartment(deps, bound.resident, bound.resident.id);

    assert.equal(saved.apartmentId, undefined);
    assert.deepEqual(deps.notifier.sent, []);
  });

  it('чужую квартиру жилец не отвязывает', async () => {
    const deps = setup([newcomer, roommate, manager]);

    await bindApartment(deps, newcomer, CODE);

    await assert.rejects(unbindApartment(deps, roommate, newcomer.id), /он сам или управляющая компания/);
  });

  it('освободившаяся квартира достаётся новому жильцу без соседства', async () => {
    const deps = setup([newcomer, roommate, manager]);

    await bindApartment(deps, newcomer, CODE);
    await unbindApartment(deps, manager, newcomer.id);
    await bindApartment(deps, roommate, CODE);

    const living = await deps.repository.listResidentsByApartments(['apt-1']);

    assert.deepEqual(
      living.map((person) => person.id),
      [roommate.id],
      'прежний жилец больше не числится за квартирой',
    );
  });

  it('чужая управляющая организация квартиру не отвяжет', async () => {
    const deps = setup([newcomer, roommate, manager]);

    await deps.repository.saveBuilding({ id: 'b2', code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' });

    const stranger: Resident = { ...manager, id: 'mgr-2', maxUserId: 7008, buildingId: 'b2' };

    await bindApartment(deps, newcomer, CODE);

    await assert.rejects(unbindApartment(deps, stranger, newcomer.id, 'apt-1'), /Дом не найден/);
  });

  it('отвязка попадает в журнал действий', async () => {
    const deps = setup([newcomer, roommate, manager]);

    await bindApartment(deps, newcomer, CODE);
    await unbindApartment(deps, manager, newcomer.id);

    const [entry] = await listAudit(deps, manager);

    assert.equal(entry?.action, 'apartment_unbound');
    assert.equal(entry?.details, 'квартира 1');
  });
});
