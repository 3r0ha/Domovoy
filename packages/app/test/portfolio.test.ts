import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '@domovoy/domain';

import {
  InMemoryRepository,
  createServiceRequest,
  portfolio,
  transitionRequest,
  type Resident,
} from '../dist/index.js';

const FIRST = 'dom15';
const SECOND = 'dom17';
const NOW = new Date('2026-09-20T10:00:00Z');
const HOUR = 60 * 60 * 1000;

const MANAGER: Resident = {
  id: 'staff-1',
  maxUserId: 2001,
  displayName: 'Нина',
  role: 'manager',
  buildingId: FIRST,
};

const RESIDENT: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: FIRST,
};

const setup = async () => {
  const repository = new InMemoryRepository();
  let clock = NOW.getTime();
  let counter = 0;

  await repository.saveBuilding({ id: FIRST, code: 'Д15', address: 'ул. Ленина, 15', managementCompany: 'УК' });
  await repository.saveBuilding({ id: SECOND, code: 'Д17', address: 'ул. Ленина, 17', managementCompany: 'УК' });
  await repository.saveApartment({ id: 'apt-1', buildingId: FIRST, number: 1, entrance: 1, riser: 1, area: 40 });
  await repository.saveApartment({ id: 'apt-9', buildingId: SECOND, number: 9, entrance: 1, riser: 1, area: 40 });
  await repository.saveResident(MANAGER);
  await repository.saveResident(RESIDENT);

  const deps = {
    repository,
    now: () => new Date(clock),
    createId: () => `id-${(counter += 1)}`,
    defaultBuildingId: FIRST,
  };

  /** Заявка нужного возраста: у портфеля всё считается по периоду. */
  const complain = async (buildingId: string, hoursAgo: number, description = 'Течёт кран') => {
    clock = NOW.getTime() - hoursAgo * HOUR;

    const request = await createServiceRequest(deps, {
      resident: { ...RESIDENT, buildingId, apartmentId: buildingId === FIRST ? 'apt-1' : 'apt-9' },
      description,
    });

    clock = NOW.getTime();

    return request;
  };

  return { deps, repository, complain, at: (ms: number) => (clock = ms) };
};

describe('дома компании', () => {
  it('считает открытые и просроченные по каждому дому', async () => {
    const { deps, complain } = await setup();

    await complain(FIRST, 2);
    await complain(SECOND, 2);
    await complain(SECOND, 2);

    const lines = await portfolio(deps, MANAGER);

    assert.deepEqual(
      lines.map((line) => [line.code, line.open]),
      [
        ['Д17', 2],
        ['Д15', 1],
      ],
    );
  });

  it('впереди дом с просрочкой, а не с большим числом заявок', async () => {
    const { deps, complain } = await setup();

    await complain(FIRST, 40);
    await complain(SECOND, 0.1);
    await complain(SECOND, 0.1);

    const [first] = await portfolio(deps, MANAGER);

    assert.equal(first?.code, 'Д15');
    assert.equal(first?.overdue, 1);
  });

  it('доля в срок и оценка появляются только когда есть что считать', async () => {
    const { deps, complain } = await setup();

    const request = await complain(FIRST, 0.1);

    for (const to of ['accepted', 'in_progress', 'done'] as const) {
      await transitionRequest(deps, { resident: MANAGER, requestId: request.id, to });
    }

    await transitionRequest(deps, { resident: RESIDENT, requestId: request.id, to: 'confirmed', rating: 5 });

    const lines = await portfolio(deps, MANAGER);
    const closed = lines.find((line) => line.code === 'Д15');
    const quiet = lines.find((line) => line.code === 'Д17');

    assert.equal(closed?.inTimeRate, 1);
    assert.equal(closed?.averageRating, 5);
    assert.equal(quiet?.inTimeRate, undefined);
    assert.equal(quiet?.averageRating, undefined);
  });

  it('жильцу список домов недоступен', async () => {
    const { deps } = await setup();

    await assert.rejects(portfolio(deps, RESIDENT), DomainError);
  });
});
