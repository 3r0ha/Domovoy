import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '@domovoy/domain';

import {
  InMemoryRepository,
  readMeterPhoto,
  uploadFile,
  type MeterVision,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-05T10:00:00Z');

const MARIA: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const NEIGHBOUR: Resident = { ...MARIA, id: 'res-2', maxUserId: 1002, apartmentId: 'apt-2' };

/** Однопиксельный jpeg: содержимое неважно, важен путь снимка через продукт. */
const PIXEL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////8AAEQgAAQABAwERAAIRAQMRAf/EABQAAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+A/9k=';

const setup = async (vision?: MeterVision) => {
  const repository = new InMemoryRepository();
  let counter = 0;

  await repository.saveBuilding({ id: BUILDING_ID, code: 'Д1', address: 'ул. Ленина, 1', managementCompany: 'УК' });
  await repository.saveApartment({ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 40 });
  await repository.saveApartment({ id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2, area: 40 });
  await repository.saveResident(MARIA);
  await repository.saveResident(NEIGHBOUR);
  await repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
  await repository.saveMeter({ id: 'cold-2', apartmentId: 'apt-2', kind: 'cold_water', serial: 'ХВС-2' });

  const deps = {
    repository,
    now: () => NOW,
    createId: () => `id-${(counter += 1)}`,
    defaultBuildingId: BUILDING_ID,
    ...(vision ? { vision } : {}),
  };

  const photo = await uploadFile(deps, MARIA, { contentType: 'image/jpeg', base64: PIXEL });

  return { deps, token: photo.token };
};

describe('показание с фотографии', () => {
  it('распознанное значение возвращается, но не подаётся само', async () => {
    const seen: Blob[] = [];
    const { deps, token } = await setup({
      async read(image) {
        seen.push(image);
        return 126.5;
      },
    });

    const value = await readMeterPhoto(deps, { resident: MARIA, meterId: 'cold-1', token });

    assert.equal(value, 126.5);
    assert.equal(seen.length, 1, 'снимок дошёл до службы');
    assert.equal((await deps.repository.listReadings('cold-1')).length, 0);
  });

  it('нераспознанное, не ошибка: вводят руками', async () => {
    const { deps, token } = await setup({ async read() { return undefined; } });

    assert.equal(await readMeterPhoto(deps, { resident: MARIA, meterId: 'cold-1', token }), undefined);
  });

  it('без службы распознавания честно отказывает', async () => {
    const { deps, token } = await setup();

    await assert.rejects(readMeterPhoto(deps, { resident: MARIA, meterId: 'cold-1', token }), /не подключено/);
  });

  it('чужой счётчик по фотографии не прочитать', async () => {
    const { deps, token } = await setup({ async read() { return 100; } });

    await assert.rejects(
      readMeterPhoto(deps, { resident: MARIA, meterId: 'cold-2', token }),
      /счётчик другой квартиры/,
    );
  });

  it('чужой снимок в распознавание не отдаётся', async () => {
    const { deps, token } = await setup({ async read() { return 100; } });

    await assert.rejects(
      readMeterPhoto(deps, { resident: NEIGHBOUR, meterId: 'cold-2', token }),
      DomainError,
    );
  });

  it('ссылка вместо своего снимка не принимается', async () => {
    const { deps } = await setup({ async read() { return 100; } });

    await assert.rejects(
      readMeterPhoto(deps, { resident: MARIA, meterId: 'cold-1', token: 'https://example.test/meter.jpg' }),
      /загружен в продукт/,
    );
  });
});
