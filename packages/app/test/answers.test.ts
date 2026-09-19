import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  answerAboutHouse,
  classifyIntent,
  createCollectingNotifier,
  publishAnnouncement,
  submitProblem,
  type AppDeps,
  type Reasoner,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50, residents: 2 },
  { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2, area: 50, residents: 1 },
];

const maria: Resident = {
  id: 'res-1',
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

const setup = (reasoner?: Reasoner): AppDeps => ({
  repository: new InMemoryRepository({
    buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
    apartments: APARTMENTS,
    residents: [maria, dispatcher],
  }),
  now: () => new Date('2026-09-22T10:00:00Z'),
  createId: () => `id-${Math.random().toString(36).slice(2, 8)}`,
  defaultBuildingId: BUILDING_ID,
  notifier: createCollectingNotifier(),
  ...(reasoner ? { reasoner } : {}),
});

describe('вопрос или обращение', () => {
  it('без модели вопрос узнаётся по знаку вопроса и вопросительному слову', async () => {
    assert.deepEqual(await classifyIntent('Когда дадут воду?'), { intent: 'question', topic: 'works' });
    assert.deepEqual(await classifyIntent('Сколько я должен за август?'), { intent: 'question', topic: 'bill' });
    assert.deepEqual(await classifyIntent('Что с моей заявкой?'), { intent: 'question', topic: 'request' });
    assert.deepEqual(await classifyIntent('Нет горячей воды со вчерашнего вечера'), {
      intent: 'request',
      topic: 'unknown',
    });
  });

  it('модель уточняет тему, а нераспознанный ответ ничего не ломает', async () => {
    const model: Reasoner = {
      understand: async () => undefined,
      intent: async () => ({ intent: 'question', topic: 'bill' }),
    };

    assert.deepEqual(await classifyIntent('а по деньгам что', model), { intent: 'question', topic: 'bill' });

    const broken: Reasoner = {
      understand: async () => undefined,
      intent: async () => ({ intent: 'мусор', topic: 'мусор' }),
    };

    assert.deepEqual(await classifyIntent('Когда дадут воду?', broken), { intent: 'question', topic: 'works' });
  });

  it('упавшая модель не мешает: работают ключевые слова', async () => {
    const broken: Reasoner = {
      understand: async () => undefined,
      intent: () => Promise.reject(new Error('нет связи')),
    };

    assert.deepEqual(await classifyIntent('Когда дадут воду?', broken), { intent: 'question', topic: 'works' });
  });
});

describe('ответ на вопрос жильца', () => {
  it('про отключение отвечает сроком объявленных работ', async () => {
    const deps = setup();

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Замена задвижки',
      body: 'Стояк 1',
      entrance: 1,
      riser: 1,
      works: {
        category: 'plumbing',
        from: new Date('2026-09-22T08:00:00Z'),
        until: new Date('2026-09-22T14:00:00Z'),
      },
    });

    const answer = await answerAboutHouse(deps, maria, 'Когда дадут воду?');

    assert.equal(answer.topic, 'works');
    assert.match(answer.text ?? '', /Замена задвижки/);
  });

  it('про свою заявку отвечает её состоянием', async () => {
    const deps = setup();

    await submitProblem(deps, { resident: maria, description: 'Течёт кран на кухне' });

    const answer = await answerAboutHouse(deps, maria, 'Что с моей заявкой?');

    assert.equal(answer.topic, 'request');
    assert.match(answer.text ?? '', /Д15-\d{4}-\d{4}: новая/);
  });

  it('сообщение о поломке ответом не подменяется', async () => {
    const deps = setup();

    const answer = await answerAboutHouse(deps, maria, 'Течёт кран на кухне, вода капает постоянно');

    assert.equal(answer.text, undefined);
  });

  it('вопрос не по адресу остаётся без ответа: его оформят заявкой', async () => {
    const deps = setup();

    const answer = await answerAboutHouse(deps, maria, 'Кто разрешил ставить машину на газоне?');

    assert.equal(answer.text, undefined);
  });
});
