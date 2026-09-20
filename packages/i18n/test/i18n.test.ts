import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_LANGUAGE,
  DICTIONARIES,
  LANGUAGES,
  dictionaryFor,
  isLanguage,
  languageFrom,
  languageTitle,
  translator,
  translatorFor,
} from '../dist/index.js';

describe('языки продукта', () => {
  it('у каждого языка свой код и название на нём самом', () => {
    const codes = LANGUAGES.map((language) => language.code);

    assert.equal(new Set(codes).size, codes.length, 'код языка повторяется');
    assert.equal(codes[0], DEFAULT_LANGUAGE, 'первым идёт язык, на котором продукт написан');

    for (const language of LANGUAGES) {
      assert.ok(language.title.trim().length > 0, `нет названия у ${language.code}`);
    }
  });

  it('код клиента приводится к нашему, а незнакомый не подменяется', () => {
    assert.equal(languageFrom('ru-RU'), 'ru');
    assert.equal(languageFrom('uz-Latn'), 'uz');
    assert.equal(languageFrom('mo'), 'ro', 'молдавский это румынский');
    assert.equal(languageFrom('tj'), 'tg');
    assert.equal(languageFrom('de'), undefined);
    assert.equal(languageFrom(''), undefined);
    assert.equal(languageFrom(undefined), undefined);
    assert.equal(isLanguage('tg'), true);
    assert.equal(isLanguage('xx'), false);
    assert.equal(languageTitle('hy'), 'Հայերեն');
  });
});

describe('перевод строк', () => {
  const dictionaries = {
    ru: { 'bill.due': 'Заплатить {сумма} до {срок}', 'only.ru': 'Только по-русски' },
    en: { 'bill.due': 'Pay {сумма} by {срок}' },
  };

  it('подставляет значения и берёт язык человека', () => {
    const t = translator('en', { dictionaries });

    assert.equal(t('bill.due', { сумма: '1 200 ₽', срок: '10 октября' }), 'Pay 1 200 ₽ by 10 октября');
  });

  it('непереведённая строка приходит по-русски, а не пропадает', () => {
    const missing: string[] = [];
    const t = translator('en', { dictionaries, onMissing: (key) => missing.push(key) });

    assert.equal(t('only.ru'), 'Только по-русски');
    assert.equal(t('нет.такого'), 'нет.такого', 'ключ виден, и его легко найти');
    assert.deepEqual(missing, ['нет.такого']);
  });

  it('незаполненная подстановка остаётся собой, а не пустотой', () => {
    const t = translator('ru', { dictionaries });

    assert.equal(t('bill.due', { сумма: '0 ₽' }), 'Заплатить 0 ₽ до {срок}');
  });

  it('у каждого языка продукта свой словарь, а без языка продукт говорит по-русски', () => {
    for (const { code } of LANGUAGES) {
      assert.notEqual(dictionaryFor(code), undefined, `у языка ${code} нет словаря`);
      assert.equal(translatorFor(code)('нет.такого'), 'нет.такого', 'ключ без строки виден как есть');
    }

    assert.equal(dictionaryFor('ru'), DICTIONARIES.ru);
    assert.equal(translatorFor(undefined)('app.status.new'), 'новая');
  });
});

describe('полнота словарей', () => {
  it('в каждом языке те же ключи, что и в русском', () => {
    const source = Object.keys(DICTIONARIES.ru);

    for (const { code } of LANGUAGES) {
      const own = DICTIONARIES[code];

      if (!own) continue;

      const missing = source.filter((key) => own[key] === undefined);
      const extra = Object.keys(own).filter((key) => DICTIONARIES.ru[key] === undefined);

      assert.deepEqual(missing, [], `в языке ${code} не хватает строк`);
      assert.deepEqual(extra, [], `в языке ${code} есть лишние строки`);
    }
  });

  it('подстановки в переводе те же, что в исходной строке', () => {
    const names = (text: string): string[] =>
      [...text.matchAll(/\{([\p{L}\d_]+)\}/gu)].map((found) => found[1] ?? '').sort();

    for (const { code } of LANGUAGES) {
      const own = DICTIONARIES[code];

      if (!own || code === 'ru') continue;

      for (const [key, text] of Object.entries(own)) {
        assert.deepEqual(names(text), names(DICTIONARIES.ru[key] ?? ''), `подстановки разошлись: ${code}, ${key}`);
      }
    }
  });
});
