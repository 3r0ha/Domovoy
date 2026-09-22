import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  closeDuePolls,
  createCollectingNotifier,
  formatPollResult,
  listPollsFor,
  pollProtocol,
  remindAboutPolls,
  startPoll,
  vote,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const START = new Date('2026-09-01T10:00:00Z');
const DAY = 24 * 3600_000;

/** 150 м² на дом: две квартиры по 50 и две по 25. */
const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
  { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2, area: 50 },
  { id: 'apt-3', buildingId: BUILDING_ID, number: 3, entrance: 1, riser: 1, area: 25 },
  { id: 'apt-4', buildingId: BUILDING_ID, number: 4, entrance: 1, riser: 2, area: 25 },
];

const resident = (id: string, apartmentId: string, maxUserId: number): Resident => ({
  id,
  maxUserId,
  displayName: `Житель ${id}`,
  role: 'resident',
  apartmentId,
  buildingId: BUILDING_ID,
  owned: [{ apartmentId, share: 1, basis: 'company' }],
});

const maria = resident('res-1', 'apt-1', 1001);
const ivan = resident('res-2', 'apt-2', 1002);
const anna = resident('res-3', 'apt-3', 1003);

const manager: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Управляющий',
  role: 'manager',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier>; advance: (ms: number) => void };

const setup = (): Deps => {
  let counter = 0;
  let clock = START.getTime();

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: APARTMENTS,
      residents: [maria, ivan, anna, manager],
    }),
    now: () => new Date(clock),
    createId: () => `poll-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
    advance: (ms) => {
      clock += ms;
    },
  };
};

const announce = (deps: Deps) =>
  startPoll(deps, {
    resident: manager,
    kind: 'simple',
    title: 'Ремонт подъездов',
    question: 'Утвердить смету на ремонт подъездов',
    days: 14,
  });

describe('объявление собрания', () => {
  it('уведомляет всех собственников дома', async () => {
    const deps = setup();
    const poll = await announce(deps);

    assert.equal(poll.closesAt.getTime(), START.getTime() + 14 * DAY);

    assert.deepEqual(
      deps.notifier.sent.map((item) => item.maxUserId).sort(),
      [maria.maxUserId, ivan.maxUserId, anna.maxUserId].sort(),
    );
    assert.match(deps.notifier.sent[0]?.text ?? '', /Простое большинство/);
    assert.equal(deps.notifier.sent[0]?.section, 'polls', 'под объявлением кнопка перехода к собранию');
  });

  it('жилец собрание не объявляет', async () => {
    const deps = setup();

    await assert.rejects(
      startPoll(deps, { resident: maria, kind: 'simple', title: 'Тест', question: 'Вопрос', days: 7 }),
      /объявляет управляющая организация/,
    );
  });

  it('голосование на ноль дней не заводится', async () => {
    const deps = setup();

    await assert.rejects(
      startPoll(deps, { resident: manager, kind: 'simple', title: 'Тест', question: 'Вопрос', days: 0 }),
      /хотя бы день/,
    );
  });

  it('без площадей помещений собрание не объявляется', async () => {
    const deps = setup();

    for (const apartment of APARTMENTS) {
      await deps.repository.saveApartment({ ...apartment, area: undefined });
    }

    await assert.rejects(
      startPoll(deps, { resident: manager, kind: 'simple', title: 'Тест', question: 'Вопрос', days: 7 }),
      /не внесены площади/,
    );

    await assert.doesNotReject(listPollsFor(deps, maria));
  });
});

describe('голосование', () => {
  it('считает доли и доводит до решения', async () => {
    const deps = setup();
    const poll = await announce(deps);

    const first = await vote(deps, { resident: maria, pollId: poll.id, choice: 'for' });

    assert.equal(first.result.turnout, 0.3333);
    assert.equal(first.result.quorum, false);
    assert.equal(first.areaToQuorum, 25, 'нужно 75 м², есть 50');
    assert.equal(first.myChoice, 'for');

    const second = await vote(deps, { resident: ivan, pollId: poll.id, choice: 'for' });

    assert.equal(second.result.quorum, true);
    assert.equal(second.result.passed, true);
  });

  it('переголосовать до закрытия можно', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await vote(deps, { resident: maria, pollId: poll.id, choice: 'against' });
    deps.advance(DAY);
    const after = await vote(deps, { resident: maria, pollId: poll.id, choice: 'for' });

    assert.equal(after.result.shares.against, 0);
    assert.equal(after.result.shares.for, 0.3333);
    assert.equal(after.myChoice, 'for');
  });

  it('после закрытия голос не принимается', async () => {
    const deps = setup();
    const poll = await announce(deps);

    deps.advance(15 * DAY);

    await assert.rejects(vote(deps, { resident: maria, pollId: poll.id, choice: 'for' }), /завершено/);
  });

  it('без квартиры голосовать нельзя', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await assert.rejects(
      vote(deps, { resident: { ...maria, apartmentId: undefined }, pollId: poll.id, choice: 'for' }),
      /собственники помещений/,
    );
  });

  it('несуществующее голосование не находится', async () => {
    const deps = setup();

    await assert.rejects(vote(deps, { resident: maria, pollId: 'нет', choice: 'for' }), /не найдено/);
  });
});

describe('список собраний', () => {
  it('идущие идут первыми', async () => {
    const deps = setup();

    const old = await announce(deps);
    deps.advance(20 * DAY);
    const current = await announce(deps);

    const polls = await listPollsFor(deps, maria);

    assert.deepEqual(
      polls.map((view) => [view.poll.id, view.open]),
      [
        [current.id, true],
        [old.id, false],
      ],
    );
  });
});

describe('итоги словами', () => {
  it('показывают доли и нехватку до кворума', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await vote(deps, { resident: anna, pollId: poll.id, choice: 'for' });

    const [view] = await listPollsFor(deps, anna);
    const text = formatPollResult(view!);

    assert.match(text, /Участие: 17% площади дома/);
    assert.match(text, /нужны голоса собственников ещё 50 м²/);
    assert.match(text, /Голос квартиры: за/);
  });

  it('дробные метры округляются до одного знака', async () => {
    const deps = setup();

    const poll = await startPoll(deps, {
      resident: manager,
      kind: 'qualified',
      title: 'Капитальный ремонт',
      question: 'Утвердить',
      days: 7,
    });

    await vote(deps, { resident: anna, pollId: poll.id, choice: 'for' });

    const views = await listPollsFor(deps, anna);
    const text = formatPollResult(views.find((view) => view.poll.id === poll.id)!);

    assert.match(text, /ещё 50 м²/);
  });

  it('после закрытия сообщают, принято решение или нет', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await vote(deps, { resident: maria, pollId: poll.id, choice: 'for' });
    await vote(deps, { resident: ivan, pollId: poll.id, choice: 'for' });
    deps.advance(15 * DAY);

    const [view] = await listPollsFor(deps, maria);

    assert.match(formatPollResult(view!), /Решение принято/);
  });

  it('провалившееся собрание так и называется', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await vote(deps, { resident: anna, pollId: poll.id, choice: 'for' });
    deps.advance(15 * DAY);

    const [view] = await listPollsFor(deps, anna);

    assert.match(formatPollResult(view!), /Решение не принято/);
  });
});

describe('напоминание о собрании', () => {
  it('уходит перед закрытием тем, кто ещё не голосовал', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await vote(deps, { resident: maria, pollId: poll.id, choice: 'for' });
    deps.advance(13 * DAY);
    deps.notifier.sent.length = 0;

    const reminded = await remindAboutPolls(deps, BUILDING_ID);

    assert.deepEqual(
      reminded.map((person) => person.id).sort(),
      [ivan.id, anna.id].sort(),
    );
    assert.match(deps.notifier.sent[0]?.text ?? '', /не хватает \d+ м²/u);
  });

  it('заранее не тревожит и после закрытия молчит', async () => {
    const deps = setup();

    await announce(deps);

    assert.deepEqual(await remindAboutPolls(deps, BUILDING_ID), []);

    deps.advance(15 * DAY);

    assert.deepEqual(await remindAboutPolls(deps, BUILDING_ID), []);
  });

  it('при собранном кворуме никого не беспокоит', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await vote(deps, { resident: maria, pollId: poll.id, choice: 'for' });
    await vote(deps, { resident: ivan, pollId: poll.id, choice: 'for' });
    deps.advance(13 * DAY);

    assert.deepEqual(await remindAboutPolls(deps, BUILDING_ID), []);
  });
});

describe('итоги собрания', () => {
  it('по истечении срока подводятся сами и объявляются собственникам', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await vote(deps, { resident: maria, pollId: poll.id, choice: 'for' });
    await vote(deps, { resident: ivan, pollId: poll.id, choice: 'for' });
    deps.advance(15 * DAY);
    deps.notifier.sent.length = 0;

    const [closed] = await closeDuePolls(deps);

    assert.equal(closed?.result.passed, true);
    assert.deepEqual(
      deps.notifier.sent.map((item) => item.maxUserId).sort(),
      [maria.maxUserId, ivan.maxUserId, anna.maxUserId].sort(),
    );
    assert.match(deps.notifier.sent[0]?.text ?? '', /Решение принято/);
  });

  it('второй раз итоги не подводятся', async () => {
    const deps = setup();

    await announce(deps);
    deps.advance(15 * DAY);

    assert.equal((await closeDuePolls(deps)).length, 1);
    deps.notifier.sent.length = 0;
    assert.deepEqual(await closeDuePolls(deps), []);
    assert.deepEqual(deps.notifier.sent, []);
  });

  it('идущее собрание не закрывают досрочно', async () => {
    const deps = setup();

    await announce(deps);
    deps.advance(DAY);

    assert.deepEqual(await closeDuePolls(deps), []);
  });

  it('протокол показывает, из чего сложилось решение', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await vote(deps, { resident: maria, pollId: poll.id, choice: 'for' });
    await vote(deps, { resident: ivan, pollId: poll.id, choice: 'against' });
    await vote(deps, { resident: anna, pollId: poll.id, choice: 'for' });
    deps.advance(15 * DAY);
    await closeDuePolls(deps);

    const protocol = await pollProtocol(deps, maria, poll.id);

    assert.match(protocol, /Протокол общего собрания собственников/);
    assert.match(protocol, /Инициатор: Управляющий/);
    assert.match(protocol, /Общая площадь помещений: 150 м²/);
    assert.match(protocol, /Приняли участие: 125 м² \(83%\)/);
    assert.match(protocol, /За: 75 м² \(50%\)/);
    assert.match(protocol, /Против: 50 м² \(33%\)/);
    assert.match(protocol, /Воздержались: 0 м² \(0%\)/);
    assert.match(protocol, /Голосование: с 1 сентября 2026 г\. по 15 сентября 2026 г\./);
    assert.match(protocol, /Протокол сформирован 16 сентября 2026 г\./);
    assert.match(protocol, /Простое большинство: 60% от проголосовавших при пороге более 50%/);
    assert.match(protocol, /Решение принято/);
    assert.match(protocol, /Приложения: реестр собственников, решения собственников/);
    assert.match(protocol, /орган государственного жилищного надзора\.$/);
  });

  it('жильцу протокол читается на его языке, а в систему уходит русский подлинник', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await vote(deps, { resident: maria, pollId: poll.id, choice: 'for' });
    await vote(deps, { resident: ivan, pollId: poll.id, choice: 'against' });
    await vote(deps, { resident: anna, pollId: poll.id, choice: 'for' });
    deps.advance(15 * DAY);

    const [closed] = await closeDuePolls(deps);
    const uzbek = await deps.repository.saveResident({ ...maria, language: 'uz' });
    const own = await pollProtocol(deps, uzbek, poll.id);

    assert.match(own, /Mulkdorlar umumiy yigʻilishi bayonnomasi/);
    assert.match(own, /Xonalarning umumiy maydoni: 150 m²/);
    assert.match(closed?.protocol ?? '', /Протокол общего собрания собственников/);
  });

  it('без кворума собрание не состоялось, а не «решение не принято»', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await vote(deps, { resident: anna, pollId: poll.id, choice: 'for' });
    deps.advance(15 * DAY);

    const [closed] = await closeDuePolls(deps);

    assert.match(closed?.protocol ?? '', /Кворум: нет, не хватает 50 м²/);
    assert.match(closed?.protocol ?? '', /Собрание не состоялось: кворума нет/);
    assert.match(deps.notifier.sent.at(-1)?.text ?? '', /Кворума нет/);
  });

  it('протокол идущего собрания не выдаётся', async () => {
    const deps = setup();
    const poll = await announce(deps);

    await assert.rejects(pollProtocol(deps, maria, poll.id), /Собрание ещё идёт/);
  });
});
