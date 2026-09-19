import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatMoney, roundMoney } from '../dist/index.js';

describe('рубли до копеек', () => {
  it('полкопейки округляется от нуля, а не теряется вниз', () => {
    assert.equal(roundMoney(1.005), 1.01);
    assert.equal(roundMoney(2.675), 2.68);
    assert.equal(roundMoney(-0.005), -0.01);
  });

  it('меньше полукопейки округляется к нулю', () => {
    assert.equal(roundMoney(0.004), 0);
    assert.equal(roundMoney(1.004), 1);
  });

  it('минус ноль остаётся нулём', () => {
    assert.ok(Object.is(roundMoney(-0), 0), 'иначе в квитанции печатается «-0,00 ₽»');
    assert.ok(Object.is(roundMoney(-0.001), 0));
  });

  it('в квитанцию минус ноль не попадает', () => {
    assert.equal(formatMoney(-0), '0,00 ₽');
    assert.equal(formatMoney(-0.001), '0,00 ₽');
    assert.equal(formatMoney(12.5), '12,50 ₽');
  });
});
