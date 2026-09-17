import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isWorkingHours, onCall } from '../dist/index.js';

/** Полдень и полночь по Москве: сервер при этом живёт по UTC. */
const NOON = new Date('2026-09-03T09:00:00Z');
const NIGHT = new Date('2026-09-03T00:30:00Z');

const staff = [
  { id: 'disp-1', onDuty: false },
  { id: 'tech-1', onDuty: true },
  { id: 'mgr-1' },
];

describe('дежурство', () => {
  it('рабочие часы считаются по календарю дома, а не сервера', () => {
    assert.equal(isWorkingHours(NOON), true, '12:00 по Москве');
    assert.equal(isWorkingHours(NIGHT), false);
    assert.equal(isWorkingHours(NIGHT, { from: 0, to: 24 }), true, 'круглосуточная служба');
  });

  it('днём заявку видит вся смена', () => {
    assert.deepEqual(
      onCall(staff, NOON).map((person) => person.id),
      ['disp-1', 'tech-1', 'mgr-1'],
    );
  });

  it('ночью, только дежурный', () => {
    assert.deepEqual(
      onCall(staff, NIGHT).map((person) => person.id),
      ['tech-1'],
    );
  });

  it('без назначенных дежурных ночью будят всех', () => {
    const nobody = [{ id: 'disp-1' }, { id: 'tech-1', onDuty: false }];

    assert.deepEqual(
      onCall(nobody, NIGHT).map((person) => person.id),
      ['disp-1', 'tech-1'],
    );
  });

  it('пустая смена остаётся пустой', () => {
    assert.deepEqual(onCall([], NIGHT), []);
  });
});
