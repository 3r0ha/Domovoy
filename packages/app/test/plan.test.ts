import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '@domovoy/domain';

import {
  InMemoryRepository,
  answerAlert,
  createServiceRequest,
  housePlan,
  submitProblem,
  transitionRequest,
  type HousePlan,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-05T10:00:00Z');

const PEOPLE: Record<string, Resident> = {
  staff: { id: 'staff-1', maxUserId: 2001, displayName: 'Ольга', role: 'dispatcher', buildingId: BUILDING_ID },
  maria: { id: 'res-1', maxUserId: 1001, displayName: 'Мария', role: 'resident', apartmentId: 'apt-1', buildingId: BUILDING_ID },
  ivan: { id: 'res-2', maxUserId: 1002, displayName: 'Иван', role: 'resident', apartmentId: 'apt-2', buildingId: BUILDING_ID },
  anna: { id: 'res-3', maxUserId: 1003, displayName: 'Анна', role: 'resident', apartmentId: 'apt-3', buildingId: BUILDING_ID },
  petr: { id: 'res-4', maxUserId: 1004, displayName: 'Пётр', role: 'resident', apartmentId: 'apt-4', buildingId: BUILDING_ID },
};

const setup = async () => {
  const repository = new InMemoryRepository();
  let counter = 0;

  await repository.saveBuilding({ id: BUILDING_ID, code: 'Д1', address: 'ул. Ленина, 1', managementCompany: 'УК' });
  await repository.saveApartment({ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 40 });
  await repository.saveApartment({ id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2, area: 40 });
  await repository.saveApartment({ id: 'apt-3', buildingId: BUILDING_ID, number: 3, entrance: 1, riser: 2, area: 40 });
  await repository.saveApartment({ id: 'apt-4', buildingId: BUILDING_ID, number: 4, entrance: 1, riser: 2, area: 40 });
  await repository.saveApartment({ id: 'apt-9', buildingId: BUILDING_ID, number: 9, entrance: 2, riser: 1, area: 40 });

  for (const person of Object.values(PEOPLE)) await repository.saveResident(person);

  return {
    repository,
    deps: {
      repository,
      now: () => NOW,
      createId: () => `id-${(counter += 1)}`,
      defaultBuildingId: BUILDING_ID,
    },
  };
};

/** Состояние квартиры по её номеру: тесты читают план так же, как человек. */
const flat = (plan: HousePlan, number: number): string | undefined =>
  plan.entrances
    .flatMap((entrance) => entrance.risers.flatMap((riser) => riser.flats))
    .find((item) => item.number === number)?.state;

describe('план дома', () => {
  it('раскладывает квартиры по подъездам и стоякам', async () => {
    const { deps } = await setup();

    const plan = await housePlan(deps, PEOPLE.staff!);

    assert.deepEqual(
      plan.entrances.map((entrance) => entrance.entrance),
      [1, 2],
    );
    assert.deepEqual(
      plan.entrances[0]?.risers.map((riser) => riser.riser),
      [1, 2],
    );
    assert.deepEqual(
      plan.entrances[0]?.risers[1]?.flats.map((item) => item.number),
      [2, 3, 4],
    );
  });

  it('заявка по стояку красит стояк, а ответ соседа рисует границу', async () => {
    const { deps } = await setup();

    const water = await createServiceRequest(deps, {
      resident: PEOPLE.ivan!,
      description: 'Нет горячей воды',
      startParam: 'rsr_b1_1_2',
    });

    await transitionRequest(deps, { resident: PEOPLE.staff!, requestId: water.id, to: 'accepted' });
    await answerAlert(deps, { resident: PEOPLE.petr!, requestId: water.id, affected: false });

    const plan = await housePlan(deps, PEOPLE.staff!);

    assert.equal(flat(plan, 2), 'open');
    assert.equal(flat(plan, 3), 'open');
    assert.equal(flat(plan, 4), 'fine');
    assert.equal(flat(plan, 1), 'quiet');

    const risers = plan.entrances[0]?.risers ?? [];

    assert.deepEqual(
      risers.find((item) => item.riser === 2)?.alerts.map((alert) => alert.title),
      ['Нет горячей воды'],
    );
    assert.deepEqual(risers.find((item) => item.riser === 1)?.alerts, []);
  });

  it('присоединившийся сосед подсвечен, а автор чужого адреса, нет', async () => {
    const { deps } = await setup();

    await createServiceRequest(deps, {
      resident: PEOPLE.maria!,
      description: 'Не горит лампа на площадке',
      startParam: 'ent_b1_1',
    });

    const kitchen = await createServiceRequest(deps, {
      resident: PEOPLE.ivan!,
      description: 'Течёт кран на кухне',
      apartmentId: 'apt-2',
    });

    await transitionRequest(deps, { resident: PEOPLE.staff!, requestId: kitchen.id, to: 'accepted' });
    await answerAlert(deps, { resident: PEOPLE.anna!, requestId: kitchen.id, affected: true });

    const plan = await housePlan(deps, PEOPLE.staff!);

    assert.equal(flat(plan, 1), 'quiet', 'лампа в подъезде, не в квартире автора');
    assert.equal(flat(plan, 2), 'open');
    assert.equal(flat(plan, 3), 'open', 'подтвердивший «то же самое» тоже в границах');
  });

  it('аварию показывает как аварию, даже если рядом обычная заявка', async () => {
    const { deps } = await setup();

    await submitProblem(deps, { resident: PEOPLE.ivan!, description: 'Течёт кран' });
    await submitProblem(deps, { resident: PEOPLE.ivan!, description: 'Прорыв трубы, заливает' });

    assert.equal(flat(await housePlan(deps, PEOPLE.staff!), 2), 'emergency');
  });

  it('заявка по подъезду идёт строкой, а не заливает квартиры', async () => {
    const { deps } = await setup();

    await createServiceRequest(deps, {
      resident: PEOPLE.maria!,
      description: 'Не горит лампа на площадке',
      startParam: 'ent_b1_1',
    });

    const plan = await housePlan(deps, PEOPLE.staff!);

    assert.equal(plan.entrances[0]?.alerts.length, 1);
    assert.match(plan.entrances[0]?.alerts[0]?.title ?? '', /лампа/i);
    assert.equal(plan.entrances[0]?.risers.flatMap((riser) => riser.flats).every((item) => item.state === 'quiet'), true);
  });

  it('оборудование и дом целиком живут отдельно от сетки квартир', async () => {
    const { deps, repository } = await setup();

    await repository.saveEquipment({ code: 'lift-1', buildingId: BUILDING_ID, title: 'Лифт, подъезд 1' });

    await createServiceRequest(deps, {
      resident: PEOPLE.maria!,
      description: 'Застряли в лифте',
      startParam: 'eqp_b1_lift-1',
    });

    const plan = await housePlan(deps, PEOPLE.staff!);

    assert.equal(plan.house.length, 1);
    assert.equal(plan.house[0]?.emergency, true);
  });

  it('закрытые заявки на плане не висят', async () => {
    const { deps } = await setup();

    const kitchen = await createServiceRequest(deps, {
      resident: PEOPLE.ivan!,
      description: 'Течёт кран',
      apartmentId: 'apt-2',
    });

    for (const to of ['accepted', 'in_progress', 'done'] as const) {
      await transitionRequest(deps, {
        resident: PEOPLE.staff!,
        requestId: kitchen.id,
        to,
        ...(to === 'in_progress' ? { assigneeId: PEOPLE.staff!.id } : {}),
        ...(to === 'done' ? { comment: 'Заменил кран' } : {}),
      });
    }

    await transitionRequest(deps, { resident: PEOPLE.ivan!, requestId: kitchen.id, to: 'confirmed' });

    assert.equal(flat(await housePlan(deps, PEOPLE.staff!), 2), 'quiet');
  });

  it('жильцу план дома не показывают', async () => {
    const { deps } = await setup();

    await assert.rejects(housePlan(deps, PEOPLE.maria!), DomainError);
  });
});
