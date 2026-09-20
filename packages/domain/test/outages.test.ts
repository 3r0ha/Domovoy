import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TARIFFS, chargesFor, excessOutageHours, outageReduction, type Outage } from '../dist/index.js';

const PERIOD = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };

const outage = (kind: Outage['kind'], from: string, until: string): Outage => ({
  kind,
  from: new Date(from),
  until: new Date(until),
});

describe('перерывы сверх нормы', () => {
  it('короткое отключение воды в норме: четыре часа подряд и восемь за месяц', () => {
    const outages = [
      outage('cold_water', '2026-08-03T09:00:00Z', '2026-08-03T13:00:00Z'),
      outage('cold_water', '2026-08-20T09:00:00Z', '2026-08-20T13:00:00Z'),
    ];

    assert.equal(excessOutageHours('cold_water', outages, PERIOD), 0);
  });

  it('один длинный перерыв считается сверх четырёх часов, месячная сумма не удваивает', () => {
    const outages = [outage('hot_water', '2026-08-10T08:00:00Z', '2026-08-10T20:00:00Z')];

    assert.equal(excessOutageHours('hot_water', outages, PERIOD), 8);
  });

  it('много коротких перерывов складываются против месячной нормы', () => {
    const outages = Array.from({ length: 5 }, (_, day) =>
      outage('electricity', `2026-08-0${day + 1}T10:00:00Z`, `2026-08-0${day + 1}T11:30:00Z`),
    );

    assert.equal(excessOutageHours('electricity', outages, PERIOD), 5.5);
  });

  it('перерыв обрезается краем месяца, а чужой ресурс не считается', () => {
    const outages = [
      outage('cold_water', '2026-07-31T20:00:00Z', '2026-08-01T06:00:00Z'),
      outage('hot_water', '2026-08-05T00:00:00Z', '2026-08-06T00:00:00Z'),
    ];

    assert.equal(excessOutageHours('cold_water', outages, PERIOD), 2);
  });

  it('снижение считается от платы за ресурс: 0,15 процента за час', () => {
    assert.equal(outageReduction(435, 8), 5.22);
    assert.equal(outageReduction(435, 0), 0);
  });

  it('в квитанции перерасчёт стоит отрицательной строкой рядом с ресурсом', () => {
    const bill = chargesFor({
      period: '2026-08',
      area: 0,
      consumption: [{ kind: 'cold_water', title: 'Холодная вода', unit: 'м³', amount: 10 }],
      tariffs: DEFAULT_TARIFFS,
      outages: [
        { kind: 'cold_water', excessHours: 8 },
        { kind: 'hot_water', excessHours: 3 },
      ],
    });

    assert.deepEqual(
      bill.lines.map((line) => [line.title, line.amount]),
      [
        ['Холодная вода', 435],
        ['Перерасчёт: холодная вода отключали дольше нормы', -5.22],
      ],
      'горячей воды в квитанции нет, снижать нечего',
    );
    assert.match(bill.lines[1]?.detail ?? '', /8 ч сверх нормы × 0,15% × 435 ₽/);
    assert.equal(bill.total, 429.78);
  });
});
