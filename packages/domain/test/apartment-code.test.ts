import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  APARTMENT_CODE_ALPHABET,
  APARTMENT_CODE_LENGTH,
  apartmentCodeFrom,
  isApartmentCode,
  normalizeApartmentCode,
} from '../dist/index.js';

const fromAlphabet = (code: string): boolean => [...code].every((sign) => APARTMENT_CODE_ALPHABET.includes(sign));

describe('код квартиры из строки-семени', () => {
  it('готовый код возвращается как есть', () => {
    assert.equal(apartmentCodeFrom('ACEFHKLM'), 'ACEFHKLM');
    assert.equal(apartmentCodeFrom('acef-hklm'), 'ACEFHKLM', 'регистр и разделители не важны');
  });

  it('из случайной строки получается код нужной длины', () => {
    for (const seed of ['0e7c1a9f4b2d', 'квартира 12', 'zzzz', '', 'b']) {
      const code = apartmentCodeFrom(seed);

      assert.equal(code.length, APARTMENT_CODE_LENGTH, `не та длина для «${seed}»`);
      assert.ok(fromAlphabet(code), `чужие знаки в коде для «${seed}»`);
      assert.ok(isApartmentCode(code), `код для «${seed}» не проходит проверку`);
    }
  });

  it('одно и то же семя даёт один и тот же код', () => {
    assert.equal(apartmentCodeFrom('0e7c1a9f4b2d'), apartmentCodeFrom('0e7c1a9f4b2d'));
    assert.notEqual(apartmentCodeFrom('0e7c1a9f4b2d'), apartmentCodeFrom('4b2d0e7c1a9f'));
  });

  it('похожие друг на друга знаки в код не попадают', () => {
    // Ноль, единицу и B в квитанции путают с O, I и 8, поэтому их в алфавите нет.
    for (const sign of ['0', '1', 'B', 'D', 'G', 'I', 'O', 'Q', 'S', 'Z']) {
      assert.ok(!APARTMENT_CODE_ALPHABET.includes(sign), `знак ${sign} остался в алфавите`);
    }

    assert.ok(fromAlphabet(apartmentCodeFrom('00011BDGIOQSZ')));
  });

  it('набранное человеком приводится к виду хранения', () => {
    assert.equal(normalizeApartmentCode(' acef hklm '), 'ACEFHKLM');
    assert.equal(normalizeApartmentCode('key_ACEFHKLM'), 'ACEFHKLM');
    assert.equal(isApartmentCode('ACEFHKL'), false, 'короткий код не принимается');
    assert.equal(isApartmentCode('ACEFHKLB'), false, 'знака B в алфавите нет');
  });
});
