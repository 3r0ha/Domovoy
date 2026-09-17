import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  areaToQuorum,
  castVote,
  countVotes,
  isOpen,
  type Apartment,
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

  it('дом без площадей считается, но кворума не даёт', () => {
    const unknown = APARTMENTS.map((apartment) => ({ ...apartment, area: undefined }));
    const result = countVotes(poll(), unknown, [vote('apt-1', 'for')]);

    assert.equal(result.totalArea, 0);
    assert.equal(result.turnout, 0);
    assert.equal(result.passed, false);
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
});
