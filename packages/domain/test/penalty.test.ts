import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PENALTY_FREE_DAYS, PENALTY_SOFT_UNTIL_DAY, overdueDays, penaltyFor } from '../dist/index.js';

const RATE = 0.16;

describe('пени за просрочку', () => {
  it('первый месяц просрочки пеней не даёт', () => {
    assert.equal(penaltyFor(10_000, 0, RATE), 0);
    assert.equal(penaltyFor(10_000, PENALTY_FREE_DAYS, RATE), 0);
  });

  it('с тридцать первого дня идёт одна трёхсотая ставки за день', () => {
    const day = 10_000 * RATE * (1 / 300);

    assert.equal(penaltyFor(10_000, PENALTY_FREE_DAYS + 1, RATE), Math.round(day * 100) / 100);
    assert.equal(penaltyFor(10_000, PENALTY_FREE_DAYS + 10, RATE), Math.round(day * 10 * 100) / 100);
  });

  it('после девяноста дней ставка становится жёстче', () => {
    const soft = PENALTY_SOFT_UNTIL_DAY - PENALTY_FREE_DAYS;
    const expected = 10_000 * RATE * (soft / 300 + 10 / 130);

    assert.equal(penaltyFor(10_000, PENALTY_SOFT_UNTIL_DAY + 10, RATE), Math.round(expected * 100) / 100);
  });

  it('на границе девяностого дня жёсткая ставка ещё не включилась', () => {
    const soft = PENALTY_SOFT_UNTIL_DAY - PENALTY_FREE_DAYS;

    assert.equal(
      penaltyFor(10_000, PENALTY_SOFT_UNTIL_DAY, RATE),
      Math.round(10_000 * RATE * (soft / 300) * 100) / 100,
    );
  });

  it('без долга и без ставки пеней нет', () => {
    assert.equal(penaltyFor(0, 365, RATE), 0);
    assert.equal(penaltyFor(-100, 365, RATE), 0);
    assert.equal(penaltyFor(10_000, 365, 0), 0, 'ставку не задали, начислять не по чему');
  });

  it('нечисло в начисление не проходит', () => {
    // Ни одно сравнение с NaN не истинно, поэтому без проверки он доходит до квитанции.
    assert.throws(() => penaltyFor(Number.NaN, 100, RATE), /по числам/);
    assert.throws(() => penaltyFor(10_000, Number.NaN, RATE), /по числам/);
    assert.throws(() => penaltyFor(10_000, 100, Number.NaN), /по числам/);
    assert.throws(() => penaltyFor(Number.POSITIVE_INFINITY, 100, RATE), /по числам/);
  });

  it('дни просрочки считаются от срока и не уходят в минус', () => {
    const due = new Date('2026-04-10T00:00:00Z');

    assert.equal(overdueDays(due, new Date('2026-04-01T00:00:00Z')), 0, 'срок ещё не наступил');
    assert.equal(overdueDays(due, new Date('2026-04-10T00:00:00Z')), 0);
    assert.equal(overdueDays(due, new Date('2026-04-25T00:00:00Z')), 15);
  });
});
