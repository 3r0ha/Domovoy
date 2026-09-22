import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGridFeed, houseOfGridAddress, parseGridRow, sameHouse, searchTextOf } from '../dist/index.js';

/**
 * Ответ сетевой организации, снятый с живой службы. Поля и написание адреса
 * взяты как есть: по ним и сверяется разбор.
 */
const ROWS = [
  {
    Address: 'Республика Татарстан,Казань г, Ямашева пр-кт, д. 12',
    From: '22 сентября 2026, 00:00',
    From_: '2026-09-21T21:00:00Z',
    To: '23 сентября 2026, 00:00',
    To_: '2026-09-22T21:00:00Z',
    Description: 'неплановая',
    Condition: 'с отключением',
  },
  {
    Address: 'г Тетюши, Школьная, д. 10 -, кв. 8         ',
    From: '12 января 2026, 09:00',
    From_: '2026-01-12T06:00:00Z',
    To: '12 января 2026, 17:00',
    To_: '2026-01-12T14:00:00Z',
    Description: 'плановая',
    Condition: 'с отключением',
  },
];

/** Соседний дом на той же улице: служба отдаёт его вместе с нужным. */
const NEIGHBOUR = {
  Address: 'Российская Федерация, Республика Татарстан,г. Казань,Московский р-н Проспект Ямашева 99',
  From_: '2026-09-22T05:00:00Z',
  To_: '2026-09-22T14:00:00Z',
  Description: 'плановая',
  Condition: 'с отключением',
};

const answer = (rows: unknown[], total = rows.length): Response =>
  new Response(JSON.stringify({ Code: '200', Messages: [], Model: { AllDataModel: rows, TotalCount: total } }), {
    headers: { 'content-type': 'application/json' },
  });

const URL_OF = 'https://pdo.example/api/Ajax/GetInterruptions';

const KAZAN = 'г. Казань, пр. Ямашева, 12';

/** Момент, в который отключение из первой строки ещё идёт. */
const NOW = (): Date => new Date('2026-09-22T09:00:00Z');

describe('отключения от сетевой организации', () => {
  it('адрес дома отделяется от квартиры и прочерков', () => {
    assert.equal(houseOfGridAddress(ROWS[1]?.Address), 'г Тетюши, Школьная, д. 10');
    assert.equal(houseOfGridAddress(ROWS[0]?.Address), 'Республика Татарстан,Казань г, Ямашева пр-кт, д. 12');
    assert.equal(houseOfGridAddress(''), undefined);
    assert.equal(houseOfGridAddress(undefined), undefined);
  });

  it('разобранный адрес сходится с адресом дома установки', () => {
    const outage = parseGridRow(ROWS[0]!);

    assert.equal(sameHouse(KAZAN, outage?.addresses[0] ?? ''), true);
  });

  it('спрашивают улицей: номер дома, тип улицы и город в запрос не идут', () => {
    assert.equal(searchTextOf(KAZAN), 'ямашева');
    assert.equal(searchTextOf('пр. Ямашева, 12'), 'ямашева');
    assert.equal(searchTextOf('Ямашева 12'), 'ямашева');
    assert.equal(searchTextOf('ул. Баумана, 3, корп. 2'), 'баумана');
    assert.equal(searchTextOf('г Казань, ул Максима Горького, д 4'), 'максима горького');
    assert.equal(searchTextOf('15'), '');
  });

  it('строка разбирается в событие, а плановость попадает в причину', () => {
    const outage = parseGridRow(ROWS[0]!, 'АО «Сетевая компания»');

    assert.equal(outage?.resource, 'electricity');
    assert.equal(outage?.from.toISOString(), '2026-09-21T21:00:00.000Z');
    assert.equal(outage?.until.toISOString(), '2026-09-22T21:00:00.000Z');
    assert.equal(outage?.reason, 'Неплановая, с отключением');
    assert.equal(outage?.by, 'АО «Сетевая компания»');
  });

  it('строка без границ или без адреса пропускается, а не роняет список', () => {
    assert.equal(parseGridRow({ Address: 'г Казань, ул Ленина, д 15' }), undefined);
    assert.equal(parseGridRow({ From_: '2026-09-21T21:00:00Z', To_: '2026-09-22T21:00:00Z' }), undefined);
    assert.equal(parseGridRow({ Address: 'кв. 8', From_: 'вчера', To_: 'завтра' }), undefined);
  });

  it('спрашивают по каждому дому установки за окно ближайших дней', async () => {
    const asked: URL[] = [];

    const feed = createGridFeed({
      url: URL_OF,
      title: 'Сетевая компания',
      days: 3,
      now: NOW,
      addresses: async () => ['ул. Ленина, 15', KAZAN],
      fetch: async (input) => {
        const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);

        asked.push(url);

        return answer(ROWS);
      },
    });

    const outages = await feed.outages();

    assert.deepEqual(
      asked.map((url) => url.searchParams.get('SearchText')),
      ['ленина', 'ямашева'],
    );
    // Окно уходит на два дня назад: работы, начавшиеся ночью, служба относит
    // к предыдущей дате.
    assert.equal(asked[0]?.searchParams.get('From'), '2026-09-20');
    assert.equal(asked[0]?.searchParams.get('To'), '2026-09-25');
    assert.equal(feed.model, false);
    // Улица Ленина ничего из ответа не берёт: там Ямашева и Тетюши.
    assert.equal(outages.length, 1);
    assert.equal(outages[0]?.addresses[0], 'Республика Татарстан,Казань г, Ямашева пр-кт, д. 12');
  });

  it('соседние дома на той же улице отбрасываются', async () => {
    const feed = createGridFeed({
      url: URL_OF,
      title: 'Сетевая компания',
      now: NOW,
      addresses: async () => [KAZAN],
      fetch: async () => answer([NEIGHBOUR, ROWS[0]]),
    });

    const outages = await feed.outages();

    assert.equal(outages.length, 1);
    assert.equal(outages[0]?.from.toISOString(), '2026-09-21T21:00:00.000Z');
  });

  it('законченное отключение не возвращается', async () => {
    const past = { ...ROWS[0], From_: '2026-09-19T21:00:00Z', To_: '2026-09-20T21:00:00Z' };

    const feed = createGridFeed({
      url: URL_OF,
      title: 'Сетевая компания',
      now: NOW,
      addresses: async () => [KAZAN],
      fetch: async () => answer([past]),
    });

    assert.deepEqual(await feed.outages(), []);
  });

  it('полная страница дочитывается до конца, а пустая улица не спрашивается', async () => {
    const pages: string[] = [];
    const full = Array.from({ length: 100 }, () => NEIGHBOUR);

    const feed = createGridFeed({
      url: URL_OF,
      title: 'Сетевая компания',
      now: NOW,
      addresses: async () => [KAZAN, '15'],
      fetch: async (input) => {
        const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input);
        const page = url.searchParams.get('Page') ?? '';

        pages.push(page);

        return page === '1' ? answer(full, 101) : answer([ROWS[0]], 101);
      },
    });

    const outages = await feed.outages();

    assert.deepEqual(pages, ['1', '2']);
    assert.equal(outages.length, 1);
  });

  it('отказ службы оставляет пустой список, а не исключение', async () => {
    const errors: unknown[] = [];

    const feed = createGridFeed({
      url: URL_OF,
      title: 'Сетевая компания',
      addresses: async () => ['ул. Ленина, 15'],
      onError: (error) => errors.push(error),
      fetch: async () => new Response('нет', { status: 503 }),
    });

    assert.deepEqual(await feed.outages(), []);
    assert.equal(errors.length, 1);
  });
});
