import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { translatorFor } from '@domovoy/i18n';

import {
  formatArea,
  formatClock,
  formatDate,
  formatDay,
  formatMeterValue,
  formatMoney,
  formatMoment,
  formatSpan,
} from '../dist/index.js';

const AT = new Date('2026-09-07T06:38:25Z');

/** Названия месяцев по-русски: их не должно быть в дате на чужом языке. */
const RUSSIAN_MONTHS =
  /январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр/iu;

describe('время словами', () => {
  it('момент называется днём и часом, без секунд', () => {
    assert.equal(formatMoment(AT), '7 сентября в 09:38');
  });

  it('дата остаётся датой, без времени', () => {
    assert.equal(formatDate(AT), '7 сентября 2026 г.');
  });

  it('часы и минуты, сами по себе', () => {
    assert.equal(formatClock(AT), '09:38');
  });

  it('пояс дома меняет и день, и час', () => {
    assert.equal(formatMoment(AT, 'Asia/Vladivostok'), '7 сентября в 16:38');
    assert.equal(formatClock(new Date('2026-09-07T22:00:00Z'), 'Asia/Vladivostok'), '08:00');
    assert.equal(formatDate(new Date('2026-09-07T22:00:00Z'), 'Asia/Vladivostok'), '8 сентября 2026 г.');
  });
});

describe('дата на языке человека', () => {
  it('у жильца с чужим языком в дате нет русского месяца', () => {
    for (const code of ['en', 'uz', 'hy', 'ka', 'zh', 'ro'] as const) {
      const t = translatorFor(code);

      assert.doesNotMatch(formatDay(AT, undefined, t), RUSSIAN_MONTHS, code);
      assert.doesNotMatch(formatDate(AT, undefined, t), RUSSIAN_MONTHS, code);
      assert.doesNotMatch(formatMoment(AT, undefined, t), RUSSIAN_MONTHS, code);
    }

    assert.equal(formatDay(AT, undefined, translatorFor('en')), '7 September');
    assert.equal(formatMoment(AT, undefined, translatorFor('en')), '7 September at 09:38');
  });

  it('у смены дата остаётся русской', () => {
    assert.match(formatDay(AT), RUSSIAN_MONTHS);
    assert.match(formatDate(AT), RUSSIAN_MONTHS);
    assert.match(formatMoment(AT), RUSSIAN_MONTHS);
  });

  it('промежуток называется словами своего языка', () => {
    const to = new Date('2026-09-09T06:38:25Z');

    assert.equal(formatSpan(AT, to), '2 дня');
    assert.equal(formatSpan(AT, to, translatorFor('en')), '2 days');
    assert.equal(formatSpan(AT, new Date('2026-09-08T06:38:25Z'), translatorFor('en')), '1 day');
  });

  it('разделитель дробной части свой у каждого языка, а рубль остаётся рублём', () => {
    assert.match(formatMoney(5240.5), /240,50 ₽$/u);
    assert.equal(formatMoney(5240.5, translatorFor('en')), '5,240.50 ₽');
    assert.equal(formatMeterValue(137.1), '137,1');
    assert.equal(formatMeterValue(137.1, translatorFor('en')), '137.1');
    assert.equal(formatArea(40.5, translatorFor('zh')), '40.5');
  });
});
