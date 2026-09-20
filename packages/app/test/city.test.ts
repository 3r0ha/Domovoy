import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createCollectingNotifier,
  createHttpCityFeed,
  createMockCityFeed,
  createSweeper,
  importOutages,
  normalizeAddress,
  parseOutage,
  sameHouse,
  submitProblem,
  type AppDeps,
  type CityFeed,
  type CityOutage,
  type Resident,
} from '../dist/index.js';

const NOW = new Date('2026-09-20T09:00:00Z');

const MARIA: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: 'dom15',
};

const PETR: Resident = {
  id: 'res-petr',
  maxUserId: 1004,
  displayName: 'Пётр',
  role: 'resident',
  apartmentId: 'apt-17',
  buildingId: 'dom17',
};

const OUTAGE: CityOutage = {
  id: '125822',
  resource: 'cold_water',
  reason: 'Ремонтные работы на водоводе',
  from: new Date('2026-09-21T05:00:00Z'),
  until: new Date('2026-09-21T17:00:00Z'),
  addresses: ['г Казань, ул Агрономическая, д 76', 'г Казань, ул Ленина, д 15'],
  by: 'Водоканал',
};

const feedOf = (outages: CityOutage[]): CityFeed => ({
  title: 'Портал города',
  model: false,
  outages: async () => outages,
});

const setup = (city?: CityFeed): AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> } => {
  let counter = 0;
  const notifier = createCollectingNotifier();

  return {
    repository: new InMemoryRepository({
      buildings: [
        { id: 'dom15', code: 'Д15', address: 'ул. Ленина, 15' },
        { id: 'dom17', code: 'Д17', address: 'ул. Ленина, 17' },
      ],
      apartments: [
        { id: 'apt-1', buildingId: 'dom15', code: 'ACEFHK34', number: 1, entrance: 1, riser: 1, area: 50, residents: 1 },
        { id: 'apt-17', buildingId: 'dom17', code: 'LMNPRT47', number: 4, entrance: 1, riser: 1, area: 50, residents: 1 },
      ],
      residents: [MARIA, PETR],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: 'dom15',
    notifier,
    ...(city ? { city } : {}),
  };
};

describe('адрес дома и адрес города', () => {
  it('сравниваются без типов улиц, номеров корпусов через «к» и без города', () => {
    assert.equal(normalizeAddress('г Казань, ул Ленина, д 15 к 2'), 'казань ленина 15 2');
    assert.equal(sameHouse('ул. Ленина, 15', 'г Казань, ул Ленина, д 15'), true);
    assert.equal(sameHouse('ул. Ленина, 15, корп. 2', 'г. Казань, улица Ленина, дом 15 к 2'), true);
    assert.equal(sameHouse('просп. Победы, 8', 'г Казань, пр-кт Победы, д 8'), true, 'сокращения проспекта сходятся');
  });

  it('дом 15 и дом 150 разные дома, а пустой адрес ничему не равен', () => {
    assert.equal(sameHouse('ул. Ленина, 15', 'г Казань, ул Ленина, д 150'), false);
    assert.equal(sameHouse('ул. Ленина, 15', 'г Казань, ул Ленина, д 1'), false);
    assert.equal(sameHouse('', 'г Казань, ул Ленина, д 15'), false);
  });
});

describe('отключения по данным города', () => {
  it('становятся объявлением о работах для своего дома и уходят жильцам', async () => {
    const deps = setup(feedOf([OUTAGE]));

    const { created, seen } = await importOutages(deps);

    assert.equal(created.length, 1);
    assert.equal(created[0]?.buildingId, 'dom15');
    assert.equal(created[0]?.title, 'Отключение холодной воды');
    assert.match(created[0]?.body ?? '', /Ремонтные работы на водоводе/);
    assert.match(created[0]?.body ?? '', /Водоканал/);
    assert.match(created[0]?.body ?? '', /По данным: Портал города/);
    assert.equal(created[0]?.works?.category, 'plumbing');
    assert.deepEqual(Object.keys(seen), ['125822:dom15']);

    assert.deepEqual(
      deps.notifier.sent.map((item) => item.maxUserId),
      [MARIA.maxUserId],
      'сосед из дома 17 отключения не получает',
    );
  });

  it('одно событие объявляется дому один раз, а старые отметки забываются', async () => {
    const deps = setup(feedOf([OUTAGE]));

    const first = await importOutages(deps);
    const second = await importOutages(deps, {
      ...first.seen,
      'old:dom15': '2026-09-01T00:00:00.000Z',
    });

    assert.equal(second.created.length, 0);
    assert.deepEqual(Object.keys(second.seen), ['125822:dom15'], 'отметка недельной давности стёрта');
  });

  it('закончившееся отключение не объявляется', async () => {
    const deps = setup(feedOf([{ ...OUTAGE, from: new Date('2026-09-18T05:00:00Z'), until: new Date('2026-09-18T17:00:00Z') }]));

    assert.equal((await importOutages(deps)).created.length, 0);
  });

  it('обращение «нет воды» в часы отключения получает срок вместо заявки', async () => {
    const deps = setup(feedOf([{ ...OUTAGE, from: new Date('2026-09-20T05:00:00Z'), until: new Date('2026-09-20T17:00:00Z') }]));

    await importOutages(deps);

    const result = await submitProblem(deps, { resident: MARIA, description: 'Нет холодной воды в квартире' });

    assert.equal(result.kind, 'planned');
  });

  it('без источника обход ничего не объявляет, с источником считает объявленное', async () => {
    const quiet = setup();

    assert.equal((await createSweeper(quiet).run()).outages, 0);

    const deps = setup(feedOf([OUTAGE]));
    const sweeper = createSweeper(deps);

    assert.equal((await sweeper.run()).outages, 1);
    assert.equal((await sweeper.run()).outages, 0, 'второй обход помнит объявленное');
  });
});

describe('источник отключений по адресу', () => {
  const fetchOf = (status: number, body: unknown): typeof fetch =>
    async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('читает список в формате продукта и пропускает кривые записи', async () => {
    const feed = createHttpCityFeed({
      url: 'https://city.example/outages',
      fetch: fetchOf(200, {
        items: [
          { id: 7, resource: 'electricity', from: '2026-09-21T06:00:00+03:00', until: '2026-09-21T18:00:00+03:00', addresses: ['ул Ленина, 15'] },
          { id: 8, resource: 'lifts', from: '2026-09-21T06:00:00Z', until: '2026-09-21T18:00:00Z', addresses: ['ул Ленина, 15'] },
          { id: 9, resource: 'gas', from: 'вчера', until: '2026-09-21T18:00:00Z', addresses: ['ул Ленина, 15'] },
          { id: 10, resource: 'gas', from: '2026-09-21T06:00:00Z', until: '2026-09-21T18:00:00Z', addresses: [] },
          'мусор',
        ],
      }),
    });

    const outages = await feed.outages();

    assert.deepEqual(
      outages.map((outage) => [outage.id, outage.resource]),
      [['7', 'electricity']],
    );
    assert.equal(outages[0]?.from.toISOString(), '2026-09-21T03:00:00.000Z');
  });

  it('ключ уходит заголовком, а отказ источника даёт пустой список, а не падение', async () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    const feed = createHttpCityFeed({
      url: 'https://city.example/outages',
      key: 'secret',
      onError: (error) => void errors.push(error),
      fetch: async (_url: unknown, init?: RequestInit) => {
        seen.push(String((init?.headers as Record<string, string> | undefined)?.['authorization']));

        return new Response('нет', { status: 503 });
      },
    });

    assert.deepEqual(await feed.outages(), []);
    assert.deepEqual(seen, ['Bearer secret']);
    assert.equal(errors.length, 1);
  });

  it('разбирает одно событие с числовым идентификатором и без причины', () => {
    const outage = parseOutage({ id: 1, resource: 'hot_water', from: '2026-09-21T06:00:00Z', until: '2026-09-21T18:00:00Z', addresses: ['ул Ленина, 15'] });

    assert.equal(outage?.id, '1');
    assert.equal('reason' in (outage ?? {}), false);
  });
});

describe('модельный источник', () => {
  it('объявляет завтрашнее отключение по первому дому установки', async () => {
    const feed = createMockCityFeed({ addresses: async () => ['ул. Ленина, 15'], now: () => NOW });
    const [outage] = await feed.outages();

    assert.equal(feed.model, true);
    assert.equal(outage?.resource, 'hot_water');
    assert.equal(outage?.from.toISOString(), '2026-09-21T06:00:00.000Z');
    assert.deepEqual(outage?.addresses, ['ул. Ленина, 15']);
  });
});
