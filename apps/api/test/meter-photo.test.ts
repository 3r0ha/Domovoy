import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, type MeterVision, type Resident } from '@domovoy/app';
import { DomainError } from '@domovoy/domain';
import { signInitData } from '@maxkit/bridge';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'photo-bot-token';
const BUILDING_ID = 'b1';

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

/** Однопиксельный jpeg: содержимое неважно, важен путь снимка через продукт. */
const PIXEL =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////8AAEQgAAQABAwERAAIRAQMRAf/EABQAAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+A/9k=';

const initDataFor = (userId: number): Promise<string> =>
  signInitData(
    { auth_date: Math.floor(Date.now() / 1000), query_id: `q-${userId}`, user: JSON.stringify({ id: userId }) },
    BOT_TOKEN,
  );

const setup = async (vision?: MeterVision) => {
  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15' }],
    apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 }],
    residents: [maria],
  });

  await repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository,
    defaultBuildingId: BUILDING_ID,
    ...(vision ? { vision } : {}),
  });

  const session = await app.inject({
    method: 'POST',
    url: '/auth/session',
    headers: { 'x-max-init-data': await initDataFor(1001) },
  });
  const headers = { authorization: `Bearer ${session.json<{ token: string }>().token}` };

  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/files',
    headers,
    payload: { contentType: 'image/jpeg', data: PIXEL },
  });

  assert.equal(uploaded.statusCode, 201, uploaded.body);

  const read = () =>
    app.inject({
      method: 'POST',
      url: '/api/meters/cold-1/photo',
      headers,
      payload: { token: uploaded.json<{ token: string }>().token },
    });

  return { app, repository, headers, read };
};

describe('показание с фотографии табло', () => {
  it('распознанное число возвращается, а показание не подаётся', async () => {
    const { app, repository, read } = await setup({ read: () => Promise.resolve(1234.5) });

    const response = await read();

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { value: 1234.5 });
    assert.equal((await repository.listReadings('cold-1')).length, 0, 'показание ушло в начисление без человека');

    await app.close();
  });

  it('нечитаемое табло отвечает пустым значением, а не ошибкой', async () => {
    const { app, read } = await setup({ read: () => Promise.resolve(undefined) });

    const response = await read();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {});

    await app.close();
  });

  it('снимок без табло отвергается своим кодом', async () => {
    const { app, read } = await setup({
      read: () => Promise.reject(new DomainError('meter_not_in_photo', 'На снимке не вижу табло счётчика')),
    });

    const response = await read();

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'meter_not_in_photo');
    assert.match(response.json().message, /не вижу табло/);

    await app.close();
  });

  it('молчание службы распознавания уходит как её недоступность, а не как сбой сервера', async () => {
    const { app, read } = await setup({ read: () => Promise.reject(new Error('GigaChat не ответил за 30 с')) });

    const response = await read();

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'vision_unavailable');
    assert.match(response.json().message, /введите показание цифрами/);

    await app.close();
  });

  it('без службы распознавания ручка отвечает, что её нечем обслужить', async () => {
    const { app, read } = await setup();

    const response = await read();

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'vision_unavailable');

    await app.close();
  });

  it('снимок не того типа и сверх предела отклоняются словами, а не сбоем', async () => {
    const { app, headers } = await setup({ read: () => Promise.resolve(1) });

    const pdf = await app.inject({
      method: 'POST',
      url: '/api/files',
      headers,
      payload: { contentType: 'application/pdf', data: PIXEL },
    });

    assert.equal(pdf.statusCode, 400);
    assert.equal(pdf.json().error, 'file_type_not_allowed');

    const huge = await app.inject({
      method: 'POST',
      url: '/api/files',
      headers,
      payload: { contentType: 'image/heic', data: Buffer.alloc(1_500_001, 1).toString('base64') },
    });

    assert.equal(huge.statusCode, 413);
    assert.equal(huge.json().error, 'file_too_large');
    assert.match(huge.json().message, /меньшим разрешением/);

    await app.close();
  });
});
