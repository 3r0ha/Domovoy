import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  REQUESTS_PER_HOUR,
  houseAhead,
  houseNow,
  planInspections,
  publishAnnouncement,
  startPoll,
  submitProblem,
  transitionRequest,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-05T10:00:00Z');
const HOUR = 60 * 60 * 1000;

const PEOPLE: Record<string, Resident> = {
  staff: { id: 'staff-1', maxUserId: 2001, displayName: 'Ольга', role: 'dispatcher', buildingId: BUILDING_ID },
  ivan: { id: 'res-1', maxUserId: 1001, displayName: 'Иван', role: 'resident', apartmentId: 'apt-1', buildingId: BUILDING_ID },
  anna: { id: 'res-2', maxUserId: 1002, displayName: 'Анна', role: 'resident', apartmentId: 'apt-2', buildingId: BUILDING_ID },
  petr: { id: 'res-3', maxUserId: 1003, displayName: 'Пётр', role: 'resident', apartmentId: 'apt-3', buildingId: BUILDING_ID },
};

const setup = async () => {
  const repository = new InMemoryRepository();
  let counter = 0;

  await repository.saveBuilding({ id: BUILDING_ID, code: 'Д1', address: 'ул. Ленина, 1', managementCompany: 'УК' });
  await repository.saveApartment({ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 40 });
  await repository.saveApartment({ id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2, area: 40 });
  await repository.saveApartment({ id: 'apt-3', buildingId: BUILDING_ID, number: 3, entrance: 1, riser: 1, area: 40 });

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

describe('поток заявок', () => {
  it('жилец не заводит бесконечно много заявок за час', async () => {
    const { deps } = await setup();

    for (let index = 0; index < REQUESTS_PER_HOUR; index += 1) {
      await submitProblem(deps, { resident: PEOPLE.ivan!, description: `Не закрывается окно ${index}` });
    }

    await assert.rejects(
      submitProblem(deps, { resident: PEOPLE.ivan!, description: 'И ещё одна' }),
      /Слишком много заявок/,
    );
  });

  it('двойное нажатие «отправить» не заводит вторую заявку', async () => {
    const { deps } = await setup();

    const first = await submitProblem(deps, { resident: PEOPLE.ivan!, description: 'Течёт кран на кухне' });
    const again = await submitProblem(deps, { resident: PEOPLE.ivan!, description: 'Течёт кран на кухне' });

    assert.equal(first.kind, 'created');
    assert.equal(again.kind === 'created' && again.request.id, first.kind === 'created' && first.request.id);
    assert.equal((await deps.repository.listRequests({ authorId: PEOPLE.ivan!.id })).length, 1);
  });

  it('после снятой заявки то же обращение заводится заново', async () => {
    const { deps } = await setup();

    const first = await submitProblem(deps, { resident: PEOPLE.ivan!, description: 'Течёт кран на кухне' });

    assert.equal(first.kind, 'created');

    if (first.kind !== 'created') return;

    await transitionRequest(deps, { resident: PEOPLE.ivan!, requestId: first.request.id, to: 'withdrawn' });

    const again = await submitProblem(deps, { resident: PEOPLE.ivan!, description: 'Течёт кран на кухне' });

    assert.equal(again.kind, 'created');
    assert.notEqual(again.kind === 'created' && again.request.id, first.request.id);
    assert.equal((await deps.repository.listRequests({ authorId: PEOPLE.ivan!.id })).length, 2);
  });

  it('жилец снимает свою заявку, но не чужую', async () => {
    const { deps } = await setup();

    const mine = await submitProblem(deps, { resident: PEOPLE.ivan!, description: 'Течёт кран на кухне' });

    assert.equal(mine.kind, 'created');

    if (mine.kind !== 'created') return;

    await assert.rejects(
      transitionRequest(deps, { resident: PEOPLE.anna!, requestId: mine.request.id, to: 'withdrawn' }),
      /не найдена/,
    );

    const withdrawn = await transitionRequest(deps, {
      resident: PEOPLE.ivan!,
      requestId: mine.request.id,
      to: 'withdrawn',
    });

    assert.equal(withdrawn.status, 'withdrawn');
    assert.equal((await deps.repository.listRequests({ buildingId: BUILDING_ID, statuses: ['rejected'] })).length, 0);
  });

  it('другое обращение того же человека заводится своей заявкой', async () => {
    const { deps } = await setup();

    await submitProblem(deps, { resident: PEOPLE.ivan!, description: 'Течёт кран на кухне' });
    await submitProblem(deps, { resident: PEOPLE.ivan!, description: 'Не закрывается окно' });

    assert.equal((await deps.repository.listRequests({ authorId: PEOPLE.ivan!.id })).length, 2);
  });

  it('сотрудника предел не касается: он заводит заявки по звонкам', async () => {
    const { deps } = await setup();

    for (let index = 0; index < REQUESTS_PER_HOUR + 2; index += 1) {
      await submitProblem(deps, {
        resident: PEOPLE.staff!,
        description: `Заявка по звонку ${index}`,
        apartmentId: 'apt-1',
      });
    }
  });
});

describe('что в доме сейчас', () => {
  it('авария по стояку видна соседям, но не самому заявителю', async () => {
    const { deps } = await setup();

    await submitProblem(deps, {
      resident: PEOPLE.ivan!,
      description: 'Прорыв трубы, заливает',
      startParam: 'rsr_b1_1_1',
    });

    const forAuthor = await houseNow(deps, PEOPLE.ivan!);
    const forRiser = await houseNow(deps, PEOPLE.petr!);
    const forOther = await houseNow(deps, PEOPLE.anna!);

    assert.equal(forAuthor.incidents.length, 0);
    assert.equal(forRiser.incidents.length, 1);
    assert.equal(forOther.incidents.length, 0);
  });

  it('общедомовая авария касается всех', async () => {
    const { deps } = await setup();

    await submitProblem(deps, {
      resident: PEOPLE.ivan!,
      description: 'Застряли в лифте',
      startParam: 'ent_b1_1',
    });

    const seen = await houseNow(deps, PEOPLE.anna!);

    assert.equal(seen.incidents.length, 1);
    assert.match(seen.incidents[0]?.title ?? '', /лифт/i);
  });

  it('идущие работы показываются, будущие, нет', async () => {
    const { deps } = await setup();

    await publishAnnouncement(deps, {
      resident: PEOPLE.staff!,
      title: 'Отключение горячей воды',
      body: 'Замена арматуры',
      works: { category: 'plumbing', from: new Date(NOW.getTime() - HOUR), until: new Date(NOW.getTime() + HOUR) },
    });

    await publishAnnouncement(deps, {
      resident: PEOPLE.staff!,
      title: 'Промывка системы',
      body: 'На следующей неделе',
      works: { category: 'heating', from: new Date(NOW.getTime() + 24 * HOUR), until: new Date(NOW.getTime() + 30 * HOUR) },
    });

    const seen = await houseNow(deps, PEOPLE.anna!);

    assert.deepEqual(
      seen.works.map((item) => item.title),
      ['Отключение горячей воды'],
    );
  });

  it('заявка по квартире соседей не касается', async () => {
    const { deps } = await setup();

    await submitProblem(deps, { resident: PEOPLE.ivan!, description: 'Прорыв трубы, заливает' });

    assert.equal((await houseNow(deps, PEOPLE.petr!)).incidents.length, 0);
  });

  it('без квартиры видно только общедомовое', async () => {
    const { deps, repository } = await setup();

    await submitProblem(deps, {
      resident: PEOPLE.ivan!,
      description: 'Прорыв трубы, заливает',
      startParam: 'rsr_b1_1_1',
    });

    const unbound: Resident = { ...PEOPLE.anna!, id: 'res-4', maxUserId: 1004, apartmentId: undefined };

    await repository.saveResident(unbound);

    assert.equal((await houseNow(deps, unbound)).incidents.length, 0);
  });
});

describe('что в доме будет', () => {
  const DAY = 24 * HOUR;

  it('работы, собрание и обход идут одной лентой по времени', async () => {
    const { deps } = await setup();

    await publishAnnouncement(deps, {
      resident: PEOPLE.staff!,
      title: 'Отключение горячей воды',
      body: 'Плановая замена',
      works: { category: 'plumbing', from: new Date(NOW.getTime() + 2 * DAY), until: new Date(NOW.getTime() + 3 * DAY) },
    });

    await startPoll(deps, {
      resident: PEOPLE.staff!,
      kind: 'simple',
      title: 'Ремонт подъездов',
      question: 'Утвердить смету?',
      days: 5,
    });

    await planInspections(deps, BUILDING_ID);

    const ahead = await houseAhead(deps, PEOPLE.ivan!);

    assert.deepEqual(
      ahead.map((event) => event.kind),
      [...ahead].sort((left, right) => left.at.getTime() - right.at.getTime()).map((event) => event.kind),
      'события идут по времени, а не по разделам',
    );
    assert.ok(
      ahead.some((event) => event.kind === 'works' && event.title === 'Отключение горячей воды'),
      'работы в ленте',
    );
    assert.ok(ahead.some((event) => event.kind === 'poll' && event.title === 'Ремонт подъездов'), 'собрание в ленте');
  });

  it('идущие работы в «на неделе» не повторяются: они уже в «сейчас»', async () => {
    const { deps } = await setup();

    await publishAnnouncement(deps, {
      resident: PEOPLE.staff!,
      title: 'Отключение горячей воды',
      body: 'Идёт прямо сейчас',
      works: {
        category: 'plumbing',
        from: new Date(NOW.getTime() - 2 * HOUR),
        until: new Date(NOW.getTime() + 3 * HOUR),
      },
    });

    assert.equal((await houseNow(deps, PEOPLE.ivan!)).works.length, 1, 'это «сейчас»');
    assert.deepEqual(await houseAhead(deps, PEOPLE.ivan!), [], 'и не «на неделе»');
  });

  it('дальше горизонта не заглядывает', async () => {
    const { deps } = await setup();

    await startPoll(deps, {
      resident: PEOPLE.staff!,
      kind: 'simple',
      title: 'Дальнее собрание',
      question: 'Что-то',
      days: 30,
    });

    assert.deepEqual(await houseAhead(deps, PEOPLE.ivan!), [], 'через месяц, это ещё не «на неделе»');
  });

  it('чужой стояк в ленту не попадает', async () => {
    const { deps } = await setup();

    await publishAnnouncement(deps, {
      resident: PEOPLE.staff!,
      title: 'Замена стояка',
      body: 'По стояку 2',
      entrance: 1,
      riser: 2,
      works: { category: 'plumbing', from: new Date(NOW.getTime() + DAY), until: new Date(NOW.getTime() + 2 * DAY) },
    });

    assert.deepEqual(await houseAhead(deps, PEOPLE.ivan!), []);
    assert.equal((await houseAhead(deps, PEOPLE.anna!)).length, 1);
  });

  it('закрытое собрание в ленте не висит', async () => {
    const { deps, repository } = await setup();

    const poll = await startPoll(deps, {
      resident: PEOPLE.staff!,
      kind: 'simple',
      title: 'Ремонт подъездов',
      question: 'Утвердить смету?',
      days: 3,
    });

    await repository.savePoll({ ...poll, closedAt: NOW });

    assert.deepEqual(await houseAhead(deps, PEOPLE.ivan!), []);
  });
});
