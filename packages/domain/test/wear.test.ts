import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isWearDue, wearOf } from '../dist/index.js';

const DAY = 24 * 3600_000;
const NOW = new Date('2026-09-12T09:00:00Z');

const daysAgo = (count: number): Date => new Date(NOW.getTime() - count * DAY);

describe('износ объекта', () => {
  it('по одной поломке ничего не предсказывают', () => {
    assert.deepEqual(wearOf([daysAgo(3)], NOW), {});
  });

  it('без поломок тоже', () => {
    assert.deepEqual(wearOf([], NOW), {});
  });

  it('средний промежуток считается по всем поломкам', () => {
    const wear = wearOf([daysAgo(80), daysAgo(40), daysAgo(5)], NOW);

    assert.equal(wear.averageDays, 38);
    assert.equal(wear.dueInDays, 33);
  });

  it('порядок поломок значения не имеет', () => {
    const ordered = wearOf([daysAgo(80), daysAgo(40), daysAgo(5)], NOW);
    const shuffled = wearOf([daysAgo(40), daysAgo(5), daysAgo(80)], NOW);

    assert.deepEqual(shuffled, ordered);
  });

  it('несколько поломок за день промежутком не считаются', () => {
    const wear = wearOf([daysAgo(0), daysAgo(0), daysAgo(0)], NOW);

    assert.deepEqual(wear, {});
  });
});

describe('пора ли ждать поломку', () => {
  it('за неделю до срока, пора', () => {
    assert.equal(isWearDue({ averageDays: 38, dueInDays: 5 }, 7), true);
  });

  it('до срока далеко, не пора', () => {
    assert.equal(isWearDue({ averageDays: 38, dueInDays: 20 }, 7), false);
  });

  it('срок вышел недавно, всё ещё пора', () => {
    assert.equal(isWearDue({ averageDays: 38, dueInDays: -10 }, 7), true);
  });

  it('объект перестал ломаться: напоминание не выдаётся', () => {
    assert.equal(isWearDue({ averageDays: 38, dueInDays: -290 }, 7), false);
  });

  it('без среднего срока ждать нечего', () => {
    assert.equal(isWearDue({}, 7), false);
  });
});
