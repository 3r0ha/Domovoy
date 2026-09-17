import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  assignRole,
  createCollectingNotifier,
  listPeople,
  setDuty,
  setServedBuildings,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

const APARTMENTS = [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 }];

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
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

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const setup = (residents: Resident[] = [maria, manager, dispatcher]): AppDeps & {
  notifier: ReturnType<typeof createCollectingNotifier>;
} => {
  const notifier = createCollectingNotifier();
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: APARTMENTS,
      residents,
    }),
    now: () => new Date('2026-09-03T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier,
  };
};

describe('роли в управляющей компании', () => {
  it('управляющий назначает жильца мастером', async () => {
    const deps = setup();

    const changed = await assignRole(deps, manager, { residentId: maria.id, role: 'technician' });

    assert.equal(changed.role, 'technician');
    assert.equal((await deps.repository.findResident(maria.id))?.role, 'technician');
  });

  it('человек узнаёт о новой роли', async () => {
    const deps = setup();

    await assignRole(deps, manager, { residentId: maria.id, role: 'dispatcher' });

    const [message] = deps.notifier.sent;

    assert.equal(message?.maxUserId, maria.maxUserId);
    assert.match(message?.text ?? '', /роль: диспетчер/);
    assert.match(message?.text ?? '', /\/start/);
  });

  it('о снятии роли сообщают отдельными словами', async () => {
    const deps = setup();

    await assignRole(deps, manager, { residentId: dispatcher.id, role: 'resident' });

    assert.match(deps.notifier.sent[0]?.text ?? '', /сняла с вас служебную роль/);
  });

  it('диспетчер роли не раздаёт', async () => {
    const deps = setup();

    await assert.rejects(
      assignRole(deps, dispatcher, { residentId: dispatcher.id, role: 'manager' }),
      /Роли раздаёт управляющий/,
    );
  });

  it('свою роль изменить нельзя', async () => {
    const deps = setup();

    await assert.rejects(
      assignRole(deps, manager, { residentId: manager.id, role: 'resident' }),
      /Свою роль изменить нельзя/,
    );
  });

  it('человека чужой организации не трогают', async () => {
    const alien: Resident = {
      id: 'res-alien',
      maxUserId: 2002,
      displayName: 'Чужой',
      role: 'resident',
      buildingId: 'b2',
    };

    const deps = setup([maria, manager, alien]);

    await deps.repository.saveBuilding({ id: 'b2', code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' });

    await assert.rejects(
      assignRole(deps, manager, { residentId: alien.id, role: 'technician' }),
      /другой управляющей организации/,
    );
  });

  it('жильца соседнего дома компании берут в смену, а его дом остаётся его домом', async () => {
    const neighbour: Resident = {
      id: 'res-neighbour',
      maxUserId: 2003,
      displayName: 'Сосед',
      role: 'resident',
      apartmentId: 'apt-17',
      apartmentIds: ['apt-17'],
      buildingId: 'b2',
    };

    const deps = setup([maria, manager, neighbour]);

    await deps.repository.saveBuilding({ id: 'b2', code: 'Д17', address: 'ул. Ленина, 17' });
    await deps.repository.saveApartment({ id: 'apt-17', buildingId: 'b2', number: 17, entrance: 1, riser: 1 });

    const saved = await assignRole(deps, manager, { residentId: neighbour.id, role: 'technician' });

    assert.equal(saved.role, 'technician');

    const stored = await deps.repository.findResident(neighbour.id);

    assert.equal(stored?.buildingId, BUILDING_ID, 'работает он там, куда его взяли');
    assert.deepEqual(stored?.apartmentIds, ['apt-17'], 'квартира остаётся в своём доме');
  });

  it('повторное назначение той же роли ничего не меняет и никого не будит', async () => {
    const deps = setup();

    const same = await assignRole(deps, manager, { residentId: dispatcher.id, role: 'dispatcher' });

    assert.equal(same.role, 'dispatcher');
    assert.deepEqual(deps.notifier.sent, []);
  });

  it('список людей дома показывает роль и квартиру', async () => {
    const deps = setup();

    const people = await listPeople(deps, manager);

    assert.deepEqual(
      people.map((person) => `${person.displayName}: ${person.role}`).sort(),
      ['Мария: resident', 'Ольга: dispatcher', 'Управляющий: manager'],
    );
    assert.equal(people.find((person) => person.id === maria.id)?.apartmentNumber, 1);
  });

  it('дежурство ставит любой сотрудник, а не только управляющий', async () => {
    const deps = setup();

    const onDuty = await setDuty(deps, dispatcher, { residentId: dispatcher.id, onDuty: true });

    assert.equal(onDuty.onDuty, true);
    assert.equal((await deps.repository.findResident(dispatcher.id))?.onDuty, true);
  });

  it('о постановке на дежурство сообщают, а себе, нет', async () => {
    const deps = setup();

    await setDuty(deps, manager, { residentId: dispatcher.id, onDuty: true });

    assert.match(deps.notifier.sent[0]?.text ?? '', /Вы на дежурстве/);

    deps.notifier.sent.length = 0;

    await setDuty(deps, dispatcher, { residentId: dispatcher.id, onDuty: false });

    assert.deepEqual(deps.notifier.sent, []);
  });

  it('жилец не дежурит', async () => {
    const deps = setup();

    await assert.rejects(setDuty(deps, manager, { residentId: maria.id, onDuty: true }), /Дежурят сотрудники/);
  });

  it('жилец дежурство не назначает', async () => {
    const deps = setup();

    await assert.rejects(
      setDuty(deps, maria, { residentId: dispatcher.id, onDuty: true }),
      /назначает управляющая компания/,
    );
  });

  it('жильцу список людей дома закрыт', async () => {
    const deps = setup();

    await assert.rejects(listPeople(deps, maria), /доступен управляющей компании/);
  });
});

describe('дома сотрудника', () => {
  it('заявка из соседнего дома доходит до того, кто его обслуживает', async () => {
    const deps = setup([manager, dispatcher]);

    await deps.repository.saveBuilding({ id: 'b2', code: 'Д17', address: 'ул. Ленина, 17' });
    await deps.repository.saveApartment({ id: 'apt-b2', buildingId: 'b2', number: 7, entrance: 1, riser: 1 });

    assert.deepEqual(await deps.repository.listStaff('b2'), []);

    await setServedBuildings(deps, manager, { residentId: dispatcher.id, buildingIds: ['b2'] });

    assert.deepEqual(
      (await deps.repository.listStaff('b2')).map((person) => person.id),
      [dispatcher.id],
    );
    assert.ok((await deps.repository.listStaff(BUILDING_ID)).some((person) => person.id === dispatcher.id));
  });

  it('свой дом из списка не убирается и не задваивается', async () => {
    const deps = setup([manager, dispatcher]);

    const person = await setServedBuildings(deps, manager, {
      residentId: dispatcher.id,
      buildingIds: [BUILDING_ID, BUILDING_ID],
    });

    assert.deepEqual(person.buildingIds, [BUILDING_ID]);
  });

  it('несуществующий дом не назначается', async () => {
    const deps = setup([manager, dispatcher]);

    await assert.rejects(
      setServedBuildings(deps, manager, { residentId: dispatcher.id, buildingIds: ['нет-такого'] }),
      /Дом не найден/,
    );
  });

  it('дома раздаёт управляющий, а не диспетчер', async () => {
    const deps = setup([manager, dispatcher]);

    await assert.rejects(
      setServedBuildings(deps, dispatcher, { residentId: manager.id, buildingIds: [] }),
      /раздаёт управляющий/,
    );
  });

  it('жильцу дома не назначают: он в них живёт, а не обслуживает', async () => {
    const deps = setup([manager, maria]);

    await assert.rejects(
      setServedBuildings(deps, manager, { residentId: maria.id, buildingIds: [] }),
      /а не жильцы/,
    );
  });
});
