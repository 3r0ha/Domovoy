import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  acceptReading,
  compareToNeighbours,
  consumption,
  daysLeftInWindow,
  isReadingWindow,
  isSpike,
  READING_WINDOW,
  VERIFICATION_WARNING_DAYS,
  verificationState,
  type Meter,
  type Reading,
} from '../dist/index.js';

const AT = new Date('2026-09-22T10:00:00Z');

const meter: Meter = {
  id: 'meter-1',
  apartmentId: 'apt-1',
  kind: 'cold_water',
  serial: 'ХВС-12345',
};

const reading = (value: number, at: Date, id = `r-${value}`): Reading => ({
  id,
  meterId: meter.id,
  value,
  at,
  submittedBy: 'res-1',
});

describe('окно подачи показаний', () => {
  it('открыто в последнюю декаду месяца', () => {
    assert.equal(isReadingWindow(new Date('2026-09-19T12:00:00Z')), false);
    assert.equal(isReadingWindow(new Date('2026-09-20T00:00:00Z')), true, '03:00 двадцатого по Москве');
    assert.equal(isReadingWindow(new Date('2026-09-25T12:00:00Z')), true);
    assert.equal(isReadingWindow(new Date('2026-09-26T00:00:00Z')), false);
  });

  it('день считается по календарю дома, а не по часам сервера', () => {
    const lateEvening = new Date('2026-09-25T23:00:00Z');

    assert.equal(isReadingWindow(lateEvening), false);
    assert.equal(isReadingWindow(lateEvening, READING_WINDOW, 'UTC'), true, 'на сервере по UTC, ещё вчера');
  });

  it('подсказывает, сколько дней осталось', () => {
    assert.equal(daysLeftInWindow(new Date('2026-09-22T10:00:00Z')), 3);
    assert.equal(daysLeftInWindow(new Date('2026-09-27T10:00:00Z')), -2, 'окно закрылось');
  });
});

describe('приём показания', () => {
  it('округляет до точности прибора', () => {
    const accepted = acceptReading({ id: 'r1', meter, value: 123.456789, at: AT, submittedBy: 'res-1' });

    assert.equal(accepted.value, 123.457);
  });

  it('счётчик не крутится назад', () => {
    assert.throws(
      () =>
        acceptReading({
          id: 'r2',
          meter,
          value: 100,
          at: AT,
          submittedBy: 'res-1',
          previous: reading(120, new Date('2026-08-22T10:00:00Z')),
        }),
      /не может показать меньше/,
    );
  });

  it('значение длиннее табло не принимается', () => {
    assert.throws(
      () => acceptReading({ id: 'r3', meter, value: 123456, at: AT, submittedBy: 'res-1' }),
      /не поместится/,
    );
  });

  it('за один месяц показание подаётся один раз', () => {
    assert.throws(
      () =>
        acceptReading({
          id: 'r4',
          meter,
          value: 130,
          at: AT,
          submittedBy: 'res-1',
          previous: reading(125, new Date('2026-09-21T10:00:00Z')),
        }),
      /уже подано/,
    );
  });

  it('то же значение в новом месяце принимается: жилец мог не пользоваться водой', () => {
    const accepted = acceptReading({
      id: 'r5',
      meter,
      value: 125,
      at: AT,
      submittedBy: 'res-1',
      previous: reading(125, new Date('2026-08-21T10:00:00Z')),
    });

    assert.equal(accepted.value, 125);
  });

  it('после истечения поверки показания не принимаются', () => {
    assert.throws(
      () =>
        acceptReading({
          id: 'r6',
          meter: { ...meter, verifiedUntil: new Date('2026-06-01T00:00:00Z') },
          value: 130,
          at: AT,
          submittedBy: 'res-1',
        }),
      /Срок поверки/,
    );
  });

  it('о поверке предупреждают заранее, а не в день срока', () => {
    const day = 24 * 3600_000;
    const until = (days: number): Meter => ({ ...meter, verifiedUntil: new Date(AT.getTime() + days * day) });

    assert.equal(verificationState(meter, AT), 'ok', 'без даты поверки прибор вопросов не вызывает');
    assert.equal(verificationState(until(VERIFICATION_WARNING_DAYS + 1), AT), 'ok');
    assert.equal(verificationState(until(VERIFICATION_WARNING_DAYS), AT), 'soon');
    assert.equal(verificationState(until(1), AT), 'soon');
    assert.equal(verificationState(until(0), AT), 'expired', 'в день истечения показания уже недостоверны');
    assert.equal(verificationState(until(-30), AT), 'expired');
  });

  it('мусор вместо числа не принимается', () => {
    assert.throws(() => acceptReading({ id: 'r7', meter, value: Number.NaN, at: AT, submittedBy: 'res-1' }), /числом/);
    assert.throws(() => acceptReading({ id: 'r8', meter, value: -5, at: AT, submittedBy: 'res-1' }), /не меньше нуля/);
  });
});

describe('расход', () => {
  it('считается разницей с прошлым показанием', () => {
    const previous = reading(120.5, new Date('2026-08-22T10:00:00Z'));
    const current = reading(123.75, AT);

    assert.equal(consumption(previous, current), 3.25);
  });

  it('первое показание расхода не даёт', () => {
    assert.equal(consumption(undefined, reading(120, AT)), 0);
  });
});

describe('резкий скачок расхода', () => {
  const history = [
    reading(100, new Date('2026-06-22T10:00:00Z'), 'a'),
    reading(103, new Date('2026-07-22T10:00:00Z'), 'b'),
    reading(106, new Date('2026-08-22T10:00:00Z'), 'c'),
  ];

  it('замечает расход втрое выше обычного', () => {
    assert.equal(isSpike(history, reading(121, AT)), true);
  });

  it('обычный расход скачком не считается', () => {
    assert.equal(isSpike(history, reading(109, AT)), false);
  });

  it('без истории выводов не делает', () => {
    assert.equal(isSpike([reading(100, new Date('2026-08-22T10:00:00Z'))], reading(200, AT)), false);
  });
});

describe('расход в сравнении с соседями', () => {
  it('заметно выше соседского, повод сказать', () => {
    const compared = compareToNeighbours(12, [3, 4, 5, 4]);

    assert.equal(compared.median, 4);
    assert.equal(compared.unusual, true);
  });

  it('обычный расход поводом не считается', () => {
    assert.equal(compareToNeighbours(5, [3, 4, 5, 4]).unusual, false);
    assert.equal(compareToNeighbours(8, [3, 4, 5, 4]).unusual, false);
  });

  it('по двум соседям среднего не бывает', () => {
    const compared = compareToNeighbours(100, [1, 1]);

    assert.equal(compared.unusual, false, 'на таком сравнении можно оговорить кого угодно');
    assert.equal(compared.median, 0);
  });

  it('пустые квартиры в счёт не идут', () => {
    assert.equal(compareToNeighbours(9, [0, 0, 0, 4, 5, 4]).unusual, true);
    assert.equal(compareToNeighbours(9, [0, 0, 0]).unusual, false);
  });
});
