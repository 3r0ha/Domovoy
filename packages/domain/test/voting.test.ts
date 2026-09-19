import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ELDER_TERM_YEARS,
  INITIATIVE_SHARE,
  areaToQuorum,
  areasMissingNote,
  castVote,
  countVotes,
  electElder,
  elderNow,
  isOpen,
  standingOf,
  type Apartment,
  type Initiative,
  type Poll,
  type Vote,
  type VoteChoice,
} from '../dist/index.js';

const OPENS = new Date('2026-09-01T00:00:00Z');
const CLOSES = new Date('2026-09-15T00:00:00Z');
const DURING = new Date('2026-09-10T12:00:00Z');

const poll = (kind: Poll['kind'] = 'simple'): Poll => ({
  id: 'poll-1',
  buildingId: 'b1',
  kind,
  title: 'Ремонт подъездов',
  question: 'Утвердить смету на ремонт подъездов',
  opensAt: OPENS,
  closesAt: CLOSES,
});

/** Четыре квартиры: две по 50 м² и две по 25 м², всего 150 м². */
const APARTMENTS: Apartment[] = [
  { id: 'apt-1', buildingId: 'b1', number: 1, entrance: 1, riser: 1, area: 50 },
  { id: 'apt-2', buildingId: 'b1', number: 2, entrance: 1, riser: 2, area: 50 },
  { id: 'apt-3', buildingId: 'b1', number: 3, entrance: 1, riser: 1, area: 25 },
  { id: 'apt-4', buildingId: 'b1', number: 4, entrance: 1, riser: 2, area: 25 },
];

const vote = (apartmentId: string, choice: VoteChoice, at = DURING): Vote => ({
  pollId: 'poll-1',
  apartmentId,
  choice,
  at,
  residentId: `res-${apartmentId}`,
});

describe('приём голоса', () => {
  it('до открытия и после закрытия не принимается', () => {
    const base = { poll: poll(), apartment: APARTMENTS[0]!, residentId: 'res-1', choice: 'for' as const };

    assert.throws(() => castVote({ ...base, at: new Date('2026-08-31T23:00:00Z') }), /ещё не началось/);
    assert.throws(() => castVote({ ...base, at: new Date('2026-09-16T00:00:00Z') }), /завершено/);
  });

  it('чужой дом не голосует', () => {
    assert.throws(
      () =>
        castVote({
          poll: poll(),
          apartment: { ...APARTMENTS[0]!, buildingId: 'b2' },
          residentId: 'res-1',
          choice: 'for',
          at: DURING,
        }),
      /собственники помещений этого дома/,
    );
  });

  it('голос привязан к помещению, а не к человеку', () => {
    const accepted = castVote({
      poll: poll(),
      apartment: APARTMENTS[0]!,
      residentId: 'res-1',
      choice: 'for',
      at: DURING,
    });

    assert.equal(accepted.apartmentId, 'apt-1');
    assert.equal(accepted.residentId, 'res-1');
  });

  it('открыто ли голосование, видно отдельно', () => {
    assert.equal(isOpen(poll(), DURING), true);
    assert.equal(isOpen(poll(), new Date('2026-09-20T00:00:00Z')), false);
  });

  it('после подведения итогов голос не принимается, даже если срок ещё идёт', () => {
    const closed: Poll = { ...poll(), closedAt: new Date('2026-09-11T00:00:00Z') };

    assert.equal(isOpen(closed, DURING), false);
    assert.throws(
      () =>
        castVote({ poll: closed, apartment: APARTMENTS[0]!, residentId: 'res-1', choice: 'for', at: DURING }),
      /Итоги подведены/,
    );
  });
});

describe('подсчёт по долям площади', () => {
  it('голос весит столько, сколько площадь помещения', () => {
    const result = countVotes(poll(), APARTMENTS, [vote('apt-1', 'for')]);

    assert.equal(result.totalArea, 150);
    assert.equal(result.votedArea, 50);
    assert.equal(result.turnout, 0.3333);
    assert.equal(result.shares.for, 0.3333);
    assert.equal(result.quorum, false, 'треть, не кворум');
    assert.equal(result.passed, false);
  });

  it('решение принимается при кворуме и большинстве', () => {
    const result = countVotes(poll(), APARTMENTS, [
      vote('apt-1', 'for'),
      vote('apt-2', 'for'),
      vote('apt-3', 'against'),
    ]);

    assert.equal(result.quorum, true);
    assert.equal(result.shares.for, 0.6667);
    assert.equal(result.passed, true);
  });

  it('доли считаются от всего дома, а не от проголосовавших', () => {
    const result = countVotes(poll(), APARTMENTS, [vote('apt-3', 'for')]);

    assert.equal(result.shares.for, 0.1667);
    assert.equal(result.passed, false);
  });

  it('квалифицированное большинство требует двух третей', () => {
    const votes = [vote('apt-1', 'for'), vote('apt-2', 'for'), vote('apt-3', 'for')];
    const simple = countVotes(poll('simple'), APARTMENTS, votes);
    const qualified = countVotes(poll('qualified'), APARTMENTS, votes);

    assert.equal(simple.passed, true);
    assert.equal(qualified.passed, true);

    const half = [vote('apt-1', 'for'), vote('apt-2', 'against'), vote('apt-3', 'for')];

    assert.equal(countVotes(poll('simple'), APARTMENTS, half).passed, true);
    assert.equal(countVotes(poll('qualified'), APARTMENTS, half).passed, false, '50% меньше двух третей');
  });

  it('простое большинство считается от участвующих, квалифицированное, от дома', () => {
    const split = [vote('apt-1', 'for'), vote('apt-2', 'against')];

    assert.equal(countVotes(poll('simple'), APARTMENTS, split).support, 0.5);
    assert.equal(countVotes(poll('simple'), APARTMENTS, split).passed, false, 'ровно половина, не большинство');
    assert.equal(countVotes(poll('qualified'), APARTMENTS, split).support, 0.3333);

    const both = [vote('apt-1', 'for'), vote('apt-2', 'for')];

    assert.equal(countVotes(poll('simple'), APARTMENTS, both).support, 1);
    assert.equal(countVotes(poll('simple'), APARTMENTS, both).passed, true);
    assert.equal(countVotes(poll('qualified'), APARTMENTS, both).support, 0.6667);
  });

  it('ровно половина площади кворума не даёт', () => {
    const half = [vote('apt-2', 'for'), vote('apt-3', 'for')];
    const result = countVotes(poll(), APARTMENTS, half);

    assert.equal(result.turnout, 0.5);
    assert.equal(result.quorum, false);
    assert.equal(result.passed, false);
  });

  it('переголосовавший считается один раз', () => {
    const result = countVotes(poll(), APARTMENTS, [
      vote('apt-1', 'against', new Date('2026-09-05T00:00:00Z')),
      vote('apt-1', 'for', new Date('2026-09-10T00:00:00Z')),
      vote('apt-2', 'for'),
    ]);

    assert.equal(result.votedArea, 100, 'квартира учтена один раз');
    assert.equal(result.shares.against, 0);
    assert.equal(result.shares.for, 0.6667);
  });

  it('воздержавшиеся идут в кворум, но не в поддержку', () => {
    const result = countVotes(poll(), APARTMENTS, [
      vote('apt-1', 'for'),
      vote('apt-2', 'abstain'),
      vote('apt-3', 'abstain'),
    ]);

    assert.equal(result.quorum, true, 'участие 125 из 150');
    assert.equal(result.shares.abstain, 0.5);
    assert.equal(result.passed, false, 'за, только треть');
  });

  it('голоса чужого голосования не учитываются', () => {
    const alien: Vote = { ...vote('apt-1', 'for'), pollId: 'другое' };

    assert.equal(countVotes(poll(), APARTMENTS, [alien]).votedArea, 0);
  });

  it('дом без площадей решения не принимает', () => {
    const unknown = APARTMENTS.map((apartment) => ({ ...apartment, area: undefined }));
    const result = countVotes(poll(), unknown, [vote('apt-1', 'for')]);

    assert.equal(result.areasMissing, unknown.length);
    assert.equal(result.quorum, false);
    assert.equal(result.passed, false);
  });
});

describe('доли сравниваются до округления', () => {
  /** Дом на сто тысяч метров: на нём видно разницу между долей и её округлением. */
  const large: Apartment[] = [
    { id: 'apt-big', buildingId: 'b1', number: 1, entrance: 1, riser: 1, area: 66666 },
    { id: 'apt-rest', buildingId: 'b1', number: 2, entrance: 1, riser: 1, area: 33334 },
  ];

  it('66666 из 100000 это не две трети', () => {
    const result = countVotes(poll('qualified'), large, [vote('apt-big', 'for')]);

    assert.equal(result.quorum, true, 'две трети площади, кворум есть');
    assert.equal(result.support, 0.6667, 'в отчёт доля идёт округлённой');
    assert.equal(result.passed, false, 'до двух третей не хватило шести десятитысячных');
  });

  it('ровно две трети решение принимают', () => {
    const exact: Apartment[] = [
      { ...large[0]!, area: 2 },
      { ...large[1]!, area: 1 },
    ];

    assert.equal(countVotes(poll('qualified'), exact, [vote('apt-big', 'for')]).passed, true);
  });

  it('ровно половина площади кворума не даёт и на больших числах', () => {
    const half: Apartment[] = [
      { ...large[0]!, area: 50000 },
      { ...large[1]!, area: 50000 },
    ];

    assert.equal(countVotes(poll(), half, [vote('apt-big', 'for')]).quorum, false);

    const over: Apartment[] = [
      { ...large[0]!, area: 50001 },
      { ...large[1]!, area: 49999 },
    ];

    assert.equal(countVotes(poll(), over, [vote('apt-big', 'for')]).quorum, true, 'одного метра хватило');
  });
});

describe('площади помещений', () => {
  const nameless: Apartment = { id: 'apt-5', buildingId: 'b1', number: 5, entrance: 1, riser: 1 };

  it('без площади хотя бы одного помещения решение не принимается', () => {
    const result = countVotes(poll(), [...APARTMENTS, nameless], [vote('apt-1', 'for'), vote('apt-2', 'for')]);

    assert.equal(result.areasMissing, 1);
    assert.equal(result.quorum, false, 'кворум подтверждён на неполных площадях');
    assert.equal(result.passed, false);
  });

  it('на неполных площадях голоса считаются по помещениям, а не по тем, у кого площадь есть', () => {
    const all = [...APARTMENTS, nameless];
    const result = countVotes(poll(), all, [vote('apt-1', 'for'), vote('apt-2', 'for')]);

    // Иначе два проголосовавших из пяти помещений давали бы стопроцентную явку.
    assert.equal(result.totalArea, all.length);
    assert.equal(result.votedArea, 2);
    assert.equal(result.turnout, Number((2 / all.length).toFixed(4)));
  });

  it('незаполненные площади объясняются словами', () => {
    assert.equal(areasMissingNote(APARTMENTS), undefined);
    assert.match(areasMissingNote([...APARTMENTS, nameless]) ?? '', /у 1 помещений она не внесена \(5\)/);
  });
});

describe('сколько не хватает до кворума', () => {
  it('считается в квадратных метрах', () => {
    const result = countVotes(poll(), APARTMENTS, [vote('apt-3', 'for')]);

    assert.equal(areaToQuorum(poll(), result), 50);
  });

  it('при достигнутом кворуме, ноль', () => {
    const result = countVotes(poll(), APARTMENTS, [vote('apt-1', 'for'), vote('apt-2', 'for')]);

    assert.equal(areaToQuorum(poll(), result), 0);
  });

  it('ровно половина площади это не «не хватает нуля»', () => {
    const result = countVotes(poll(), APARTMENTS, [vote('apt-1', 'for'), vote('apt-3', 'for')]);

    assert.equal(result.votedArea, 75, 'ровно половина от ста пятидесяти');
    assert.equal(result.quorum, false, 'кворум берётся строго больше половины');
    assert.ok(areaToQuorum(poll(), result) > 0, 'собрание не состоялось, значит, площади не хватило');
  });
});

describe('старший по подъезду', () => {
  const ELECTED = new Date('2026-09-15T00:00:00Z');
  const elder = electElder(poll(), { entrance: 2, residentId: 'res-7' }, ELECTED);

  it('полномочия начинаются в день собрания и длятся свой срок', () => {
    assert.equal(ELDER_TERM_YEARS, 2);
    assert.equal(elder.buildingId, 'b1');
    assert.equal(elder.since.toISOString(), ELECTED.toISOString());
    assert.equal(elder.until.toISOString(), '2028-09-15T00:00:00.000Z');
  });

  it('пока срок идёт, старший находится по своему подъезду', () => {
    assert.equal(elderNow([elder], 2, new Date('2027-01-01T00:00:00Z'))?.residentId, 'res-7');
    assert.equal(elderNow([elder], 1, new Date('2027-01-01T00:00:00Z')), undefined, 'соседний подъезд');
  });

  it('истёкшие полномочия не считаются', () => {
    assert.equal(elderNow([elder], 2, elder.until), undefined, 'последний день уже не в счёт');
    assert.equal(elderNow([elder], 2, new Date('2029-01-01T00:00:00Z')), undefined);
    assert.equal(elderNow([elder], 2, new Date('2026-09-01T00:00:00Z')), undefined, 'ещё не выбрали');
  });

  it('из нескольких сроков берётся последний начавшийся', () => {
    const reelected = electElder(poll(), { entrance: 2, residentId: 'res-9' }, new Date('2027-06-01T00:00:00Z'));

    assert.equal(elderNow([elder, reelected], 2, new Date('2027-07-01T00:00:00Z'))?.residentId, 'res-9');
  });

  it('подъезд номер два есть в каждом доме, поэтому дом называется отдельно', () => {
    const neighbour = electElder(
      { ...poll(), buildingId: 'b2' },
      { entrance: 2, residentId: 'res-8' },
      ELECTED,
    );

    assert.throws(
      () => elderNow([neighbour, elder], 2, new Date('2027-01-01T00:00:00Z')),
      /разных домов/,
      'иначе старшим второго подъезда дома А становится житель дома Б',
    );
  });

  it('полномочия с двадцать девятого февраля кончаются февралём', () => {
    const leapYear = electElder(poll(), { entrance: 1, residentId: 'res-1' }, new Date('2028-02-29T00:00:00Z'));

    assert.equal(leapYear.until.toISOString(), '2030-02-28T00:00:00.000Z', 'а не первым марта');
  });
});

describe('подписи под инициативой', () => {
  /** Дом на сто метров: десятая часть это ровно десять. */
  const HOUSE: Apartment[] = [
    { id: 'apt-small', buildingId: 'b1', number: 1, entrance: 1, riser: 1, area: 10 },
    { id: 'apt-large', buildingId: 'b1', number: 2, entrance: 1, riser: 1, area: 90 },
  ];

  const initiative = (apartmentIds: readonly string[]): Initiative => ({
    id: 'ini-1',
    buildingId: 'b1',
    authorId: 'res-1',
    title: 'Поставить шлагбаум',
    question: 'Установить шлагбаум на въезде во двор',
    kind: 'simple',
    createdAt: OPENS,
    signatures: apartmentIds.map((apartmentId) => ({ residentId: `res-${apartmentId}`, apartmentId, at: OPENS })),
  });

  it('ровно десятая часть площади право требовать собрания даёт', () => {
    const standing = standingOf(initiative(['apt-small']), HOUSE);

    assert.equal(INITIATIVE_SHARE, 0.1);
    assert.equal(standing.share, 0.1);
    assert.equal(standing.areaToDemand, 0);
    assert.equal(standing.enough, true);
  });

  it('метра не хватило, значит не хватило', () => {
    const short = HOUSE.map((apartment) => (apartment.id === 'apt-small' ? { ...apartment, area: 9 } : apartment));
    const standing = standingOf(initiative(['apt-small']), short);

    assert.equal(standing.areaToDemand, 0.9);
    assert.equal(standing.enough, false);
  });

  it('дом без известных площадей права требовать не даёт', () => {
    const unknown = HOUSE.map((apartment) => ({ ...apartment, area: undefined }));

    assert.deepEqual(standingOf(initiative(['apt-small']), unknown), {
      share: 0,
      areaToDemand: 0,
      enough: false,
    });
  });
});
