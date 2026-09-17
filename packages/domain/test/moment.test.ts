import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatClock, formatDate, formatMoment } from '../dist/index.js';

const AT = new Date('2026-09-07T06:38:25Z');

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
