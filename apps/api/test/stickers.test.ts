import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, createCollectingNotifier, type Resident } from '@domovoy/app';
import { signInitData } from '@maxkit/bridge';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'api-bot-token';
const BUILDING_ID = 'b1';

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const initDataFor = (userId: number): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `q-${userId}`,
      user: JSON.stringify({ id: userId }),
    },
    BOT_TOKEN,
  );

const setup = async () => {
  const notifier = createCollectingNotifier();

  const repository = new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
    apartments: [
      { id: 'apt-1', buildingId: BUILDING_ID, code: 'ACEFHK34', number: 1, entrance: 1, riser: 1 },
      { id: 'apt-2', buildingId: BUILDING_ID, code: 'LMNPRT47', number: 2, entrance: 2, riser: 2 },
    ],
    residents: [maria, dispatcher],
    equipment: [{ buildingId: BUILDING_ID, code: 'lift-1', title: 'Лифт, подъезд 1' }],
  });

  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository,
    defaultBuildingId: BUILDING_ID,
    createId: () => 'id-1',
    now: () => new Date('2026-09-07T10:00:00Z'),
    notifier,
    botName: 'uk_bot',
    stickers: { svg: (plan, look) => `<svg data-code="${plan.payload}">${look?.note ?? ''}</svg>` },
  });

  const login = async (userId: number): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(userId) },
    });

    return response.json<{ token: string }>().token;
  };

  return { app, login, notifier };
};

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

interface StickersView {
  styles: { name: string; title: string }[];
  objects: { payload: string; caption: string; link: string; target: string }[];
}

describe('наклейки по HTTP', () => {
  it('смена видит объекты всего дома и стили на выбор', async () => {
    const { app, login } = await setup();

    const response = await app.inject({ method: 'GET', url: '/api/stickers', headers: authed(await login(5005)) });
    const view = response.json<StickersView>();

    assert.equal(response.statusCode, 200);
    assert.ok(view.styles.some((style) => style.name === 'night'));
    assert.deepEqual(
      view.objects.map((object) => object.caption),
      [
        'Подъезд 1',
        'Подъезд 1, стояк 1',
        'Подъезд 2',
        'Подъезд 2, стояк 2',
        'Лифт, подъезд 1',
        'Квартира 1: код для квитанции',
        'Квартира 2: код для квитанции',
      ],
    );
    assert.match(view.objects[0]?.link ?? '', /^https:\/\/max\.ru\/uk_bot\?start=ent_b1_1$/);

    await app.close();
  });

  it('жильцу отдают его подъезд и его квартиру, а не соседский', async () => {
    const { app, login } = await setup();

    const response = await app.inject({ method: 'GET', url: '/api/stickers', headers: authed(await login(1001)) });

    assert.deepEqual(
      response.json<StickersView>().objects.map((object) => object.caption),
      ['Подъезд 1', 'Подъезд 1, стояк 1', 'Лифт, подъезд 1', 'Квартира 1: код для квитанции'],
    );

    await app.close();
  });

  it('картинка приходит разметкой, а не обёрткой', async () => {
    const { app, login } = await setup();

    const response = await app.inject({
      method: 'GET',
      url: '/api/stickers/image?payload=ent_b1_1&style=night&note=Звонить+в+первую',
      headers: authed(await login(1001)),
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /image\/svg\+xml/);
    assert.match(response.body, /^<svg data-code="ent_b1_1">Звонить в первую<\/svg>$/);

    await app.close();
  });

  it('наклейка уходит в переписку, а приложение получает, что пересылать', async () => {
    const { app, login, notifier } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/api/stickers/send',
      headers: authed(await login(1001)),
      payload: { payload: 'ent_b1_1', style: 'sky', note: 'Звонить в первую квартиру' },
    });

    const sent = response.json<{ caption: string; messageId?: string }>();
    const [file] = notifier.files;

    assert.equal(sent.caption, 'Подъезд 1');
    assert.equal(sent.messageId, 'mid-file-1');
    assert.equal(file?.maxUserId, maria.maxUserId);
    assert.equal(file?.name, 'ent_b1_1.svg');
    assert.match(file?.content ?? '', /Звонить в первую квартиру/);

    await app.close();
  });

  it('чужой объект наклейкой не становится', async () => {
    const { app, login } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/api/stickers/send',
      headers: authed(await login(1001)),
      payload: { payload: 'ent_b1_2' },
    });

    assert.equal(response.statusCode, 400);

    await app.close();
  });

  it('надпись длиннее наклейки не принимается', async () => {
    const { app, login } = await setup();

    const response = await app.inject({
      method: 'GET',
      url: `/api/stickers/image?payload=ent_b1_1&note=${encodeURIComponent('слово '.repeat(40))}`,
      headers: authed(await login(1001)),
    });

    assert.equal(response.statusCode, 400, 'длина поля это разбор запроса');

    await app.close();
  });
});
