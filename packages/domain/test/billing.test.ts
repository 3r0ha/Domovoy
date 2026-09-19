import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TARIFFS, DomainError, chargesFor, type ChargeInput, type Tariffs } from '../dist/index.js';

const charges = (overrides: Partial<ChargeInput> = {}) =>
  chargesFor({
    period: '2026-09',
    area: 50,
    consumption: [{ kind: 'cold_water', title: 'Холодная вода', unit: 'м³', amount: 4 }],
    tariffs: DEFAULT_TARIFFS,
    ...overrides,
  });

const water = (amount: number): ChargeInput['consumption'] => [
  { kind: 'cold_water', title: 'Холодная вода', unit: 'м³', amount },
];

describe('начисление за месяц', () => {
  it('считает по тарифу дома', () => {
    const bill = charges();
    const line = bill.lines.find((item) => item.title === 'Холодная вода');

    assert.equal(line?.amount, 174);
    assert.equal(bill.total, 174 + 50 * DEFAULT_TARIFFS.maintenance);
  });

  it('перерасчёт остаётся строкой квитанции', () => {
    const bill = charges({ area: 0, consumption: water(-2) });

    assert.equal(bill.lines.length, 1, 'вместе со строкой из квитанции исчезли бы и деньги жильца');
    assert.equal(bill.lines[0]?.amount, -87);
    assert.equal(bill.total, -87);
  });

  it('нулевой расход строки не заводит', () => {
    assert.deepEqual(charges({ area: 0, consumption: water(0) }).lines, []);
  });

  it('без ставки тарифа начисление не делается молча', () => {
    // Ставки, которой нет в справочнике, хватает, чтобы в квитанции появилось
    // нечисло: умножение на неё даёт NaN, а сравнения с NaN все ложны.
    const broken: Tariffs = {
      ...DEFAULT_TARIFFS,
      meters: { ...DEFAULT_TARIFFS.meters, cold_water: Number.NaN },
    };

    assert.throws(
      () => charges({ tariffs: broken }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'tariff_invalid');

        return true;
      },
    );
  });

  it('нечисло вместо расхода в деньги не превращается', () => {
    assert.throws(() => charges({ consumption: water(Number.NaN) }), /не числом/);
  });
});
