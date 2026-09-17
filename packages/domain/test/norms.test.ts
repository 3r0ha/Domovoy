import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AVERAGE_MONTHS,
  NORM_FACTOR,
  NORM_PER_PERSON,
  estimateConsumption,
  normFor,
} from '../dist/index.js';

const history = [
  { period: '2026-03', amount: 8 },
  { period: '2026-04', amount: 10 },
  { period: '2026-05', amount: 12 },
];

const base = { kind: 'cold_water' as const, history, residents: 2, area: 50 };

describe('норматив потребления', () => {
  it('считается на человека и с повышающим коэффициентом', () => {
    assert.equal(normFor({ kind: 'cold_water', residents: 2, area: 50 }), 14.55);
    assert.equal(
      normFor({ kind: 'cold_water', residents: 4, area: 50 }),
      normFor({ kind: 'cold_water', residents: 2, area: 50 }) * 2,
    );
  });

  it('без числа жильцов считает как за одного, а не за ноль', () => {
    assert.equal(
      normFor({ kind: 'cold_water', residents: 0, area: 50 }),
      normFor({ kind: 'cold_water', residents: 1, area: 50 }),
    );
    assert.ok(NORM_PER_PERSON.cold_water > 0 && NORM_FACTOR > 1);
  });

  it('отопление считается от площади, а не от числа жильцов', () => {
    const small = normFor({ kind: 'heating', residents: 5, area: 30 });
    const large = normFor({ kind: 'heating', residents: 1, area: 90 });

    assert.ok(large > small, 'больше площадь, больше норматив');
  });
});

describe('расчёт без показаний', () => {
  it('первые три месяца молчания считаются по среднему', () => {
    const estimate = estimateConsumption({ ...base, monthsSilent: AVERAGE_MONTHS });

    assert.deepEqual(estimate, { amount: 10, basis: 'average' });
  });

  it('после трёх месяцев переходит на норматив', () => {
    const estimate = estimateConsumption({ ...base, monthsSilent: AVERAGE_MONTHS + 1 });

    assert.equal(estimate.basis, 'norm');
    assert.equal(estimate.amount, normFor({ kind: 'cold_water', residents: 2, area: 50 }));
  });

  it('среднее берётся по последним месяцам, а не по всей истории', () => {
    const long = Array.from({ length: 12 }, (_, index) => ({
      period: `2026-${`${index + 1}`.padStart(2, '0')}`,
      amount: index < 6 ? 30 : 10,
    }));

    assert.equal(estimateConsumption({ ...base, history: long, monthsSilent: 1 }).amount, 10);
  });

  it('без единого показания среднее брать неоткуда, сразу норматив', () => {
    const estimate = estimateConsumption({ ...base, history: [], monthsSilent: 1 });

    assert.equal(estimate.basis, 'norm');
  });

  it('расход не берётся из воздуха: одна и та же цифра не повторяется вечно', () => {
    const year = estimateConsumption({ ...base, monthsSilent: 12 });
    const decade = estimateConsumption({ ...base, monthsSilent: 120 });

    assert.equal(year.basis, 'norm');
    assert.deepEqual(year, decade);
    assert.notEqual(year.amount, history.at(-1)?.amount);
  });
});
