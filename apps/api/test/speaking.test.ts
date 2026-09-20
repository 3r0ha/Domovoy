import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signInitData } from '@maxkit/bridge';
import type { FastifyInstance } from 'fastify';

import { InMemoryRepository, type Resident } from '@domovoy/app';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'speaking-bot-token';
const BUILDING_ID = 'b1';
const SPEAKER_ID = 4101;
const STAFF_ID = 4102;

/** Жилец с английским языком: сервер обязан отвечать ему словами его языка. */
const speaker: Resident = {
  id: 'res-speaker',
  maxUserId: SPEAKER_ID,
  displayName: 'John',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
  language: 'en',
};

/** Диспетчер: язык у него не спрашивают, очередь ведётся по-русски. */
const dispatcher: Resident = {
  id: 'res-dispatcher',
  maxUserId: STAFF_ID,
  displayName: 'Диспетчер',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

interface Harness {
  app: FastifyInstance;
  login: (userId: number, name: string) => Promise<string>;
}

const setup = async (): Promise<Harness> => {
  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, code: 'ACEFHK34', number: 1, entrance: 1, riser: 1, area: 50 },
      ],
      residents: [speaker, dispatcher],
    }),
    defaultBuildingId: BUILDING_ID,
  });

  const login = async (userId: number, name: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: {
        'x-max-init-data': await signInitData(
          {
            auth_date: Math.floor(Date.now() / 1000),
            query_id: `q-${userId}`,
            user: JSON.stringify({ id: userId, first_name: name }),
          },
          BOT_TOKEN,
        ),
      },
    });

    assert.equal(response.statusCode, 200, `вход не удался: ${response.body}`);

    return response.json<{ token: string }>().token;
  };

  return { app, login };
};

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

/** Кириллица в ответе жильцу: по ней видно непереведённую строку. */
const CYRILLIC = /[а-яё]/iu;

describe('сервер говорит с жильцом на его языке', () => {
  it('карточка заявки приходит словами языка жильца, а смене остаётся русской', async () => {
    const { app, login } = await setup();
    const token = await login(SPEAKER_ID, 'John');

    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: authed(token),
      payload: { description: 'Прорвало трубу в ванной, заливает пол' },
    });

    assert.equal(created.statusCode, 201, created.body);

    const request = created.json().request;

    assert.equal(request.category, 'plumbing');
    assert.equal(request.categoryTitle, 'Water supply and drainage');
    assert.equal(request.categoryShort, 'Water');
    assert.equal(request.statusTitle, 'new');
    assert.equal(request.target, 'Apartment 1');
    assert.match(request.hint ?? '', /shut off the water/u, 'совет при аварии идёт на языке жильца');

    // Текст самого обращения и номер заявки не переводятся: первое написал
    // человек, второе собрано из кода дома в справочнике.
    for (const [field, value] of Object.entries(request)) {
      if (typeof value !== 'string') continue;
      if (field === 'title' || field === 'description' || field === 'number') continue;

      assert.doesNotMatch(value, CYRILLIC, `поле ${field} осталось по-русски: ${value}`);
    }

    const zone = await app.inject({
      method: 'GET',
      url: `/api/requests/${request.id}/responsibility`,
      headers: authed(token),
    });

    assert.equal(zone.statusCode, 200, zone.body);
    assert.equal(zone.json().title, 'Management organisation');
    assert.equal(zone.json().basis, 'This is common property of the house, maintained by the management organisation');

    const forStaff = await app.inject({
      method: 'GET',
      url: `/api/requests/${request.id}`,
      headers: authed(await login(STAFF_ID, 'Диспетчер')),
    });

    assert.equal(forStaff.statusCode, 200, forStaff.body);
    assert.equal(forStaff.json().categoryTitle, 'Водоснабжение и канализация', 'смена работает по-русски');
    assert.equal(forStaff.json().statusTitle, 'новая');

    await app.close();
  });

  it('собрание, объявление и подсказки помощника переводятся тому же жильцу', async () => {
    const { app, login } = await setup();
    const token = await login(SPEAKER_ID, 'John');
    const staffToken = await login(STAFF_ID, 'Диспетчер');

    const called = await app.inject({
      method: 'POST',
      url: '/api/polls',
      headers: authed(staffToken),
      payload: {
        kind: 'qualified',
        title: 'Ремонт кровли',
        question: 'Начать ремонт кровли за счёт текущего ремонта?',
        days: 14,
      },
    });

    assert.equal(called.statusCode, 201, called.body);

    const polls = await app.inject({ method: 'GET', url: '/api/polls', headers: authed(token) });

    assert.equal(polls.statusCode, 200, polls.body);
    assert.equal(polls.json()[0].kindTitle, 'Qualified majority');
    assert.equal(polls.json()[0].basis, 'This question needs two thirds of the votes');

    const starters = await app.inject({ method: 'GET', url: '/api/assistant', headers: authed(token) });

    assert.equal(starters.statusCode, 200, starters.body);
    assert.deepEqual(starters.json().starters, [
      'How do I report a breakdown?',
      'Where do I submit readings?',
      'What is happening with my request?',
      'How do I open the entrance door?',
    ]);

    const announced = await app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: authed(staffToken),
      payload: { title: 'Плановые работы', body: 'Отключим воду на стояке', audience: { kind: 'building' } },
    });

    assert.equal(announced.statusCode, 201, announced.body);

    const news = await app.inject({ method: 'GET', url: '/api/announcements', headers: authed(token) });

    assert.equal(news.statusCode, 200, news.body);
    assert.equal(news.json()[0].audience, 'the whole house');

    await app.close();
  });
});
