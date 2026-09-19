import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { numberFromWords } from '../dist/index.js';

/** Голосом показание диктуют, а не набирают: разбор читает сказанное числом. */
describe('число, названное словами', () => {
  it('читает разряды', () => {
    assert.equal(numberFromWords('сто двадцать три'), 123);
    assert.equal(numberFromWords('двенадцать тысяч триста пятьдесят'), 12350);
    assert.equal(numberFromWords('две тысячи'), 2000);
    assert.equal(numberFromWords('девятьсот девяносто девять'), 999);
  });

  it('читает продиктованное по цифрам', () => {
    assert.equal(numberFromWords('один два три четыре пять'), 12345);
    assert.equal(numberFromWords('ноль ноль семь'), 7);
  });

  it('десятые доли после запятой', () => {
    assert.equal(numberFromWords('сто двадцать три запятая четыре'), 123.4);
    assert.equal(numberFromWords('сто двадцать три целых ноль пять'), 123.05);
    assert.equal(numberFromWords('десять точка два'), 10.2);
  });

  it('женский род и лишние слова разбору не мешают', () => {
    assert.equal(numberFromWords('одна тысяча двести'), 1200);
    assert.equal(numberFromWords('ровно сорок'), 40);
  });

  it('речь без числа числом не становится', () => {
    assert.equal(numberFromWords('течёт труба под раковиной'), undefined);
    assert.equal(numberFromWords('спасибо большое'), undefined);
    assert.equal(numberFromWords(''), undefined);
    assert.equal(numberFromWords('квартира пять на втором этаже'), undefined);
  });

  it('число длиннее табло разбором не считается', () => {
    assert.equal(numberFromWords('сто миллионов'), undefined);
  });
});
