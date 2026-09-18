import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  WORKS_WARNING_HOURS,
  describeUntil,
  describeWork,
  explainingWork,
  isUnderway,
  worksCrossedIn,
  type PlannedWork,
} from '../dist/index.js';

const NOW = new Date('2026-09-03T10:00:00Z');
const HOUR = 3600_000;

const work = (overrides: Partial<PlannedWork> = {}): PlannedWork => ({
  id: 'ann-1',
  title: 'Замена задвижки на стояке',
  category: 'plumbing',
  audience: { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 },
  from: new Date(NOW.getTime() - HOUR),
  until: new Date(NOW.getTime() + 4 * HOUR),
  ...overrides,
});

describe('плановые работы', () => {
  it('идут между началом и концом', () => {
    assert.equal(isUnderway(work(), NOW), true);
    assert.equal(isUnderway(work(), new Date(NOW.getTime() - 2 * HOUR)), false, 'ещё не начались');
    assert.equal(isUnderway(work(), new Date(NOW.getTime() + 5 * HOUR)), false, 'уже кончились');
  });

  it('объясняют обращение по тому же стояку и той же части хозяйства', () => {
    const found = explainingWork([work()], { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 }, 'plumbing', NOW);

    assert.equal(found?.id, 'ann-1');
  });

  it('работы по всему дому объясняют обращение из любой квартиры', () => {
    const found = explainingWork(
      [work({ audience: { kind: 'building', buildingId: 'b1' } })],
      { kind: 'riser', buildingId: 'b1', entrance: 4, riser: 7 },
      'plumbing',
      NOW,
    );

    assert.ok(found);
  });

  it('отключение воды не объясняет застрявший лифт', () => {
    const found = explainingWork([work()], { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 }, 'elevator', NOW);

    assert.equal(found, undefined);
  });

  it('работы в соседнем подъезде не объясняют ничего', () => {
    const found = explainingWork([work()], { kind: 'riser', buildingId: 'b1', entrance: 3, riser: 1 }, 'plumbing', NOW);

    assert.equal(found, undefined);
  });

  it('работы в другом доме не объясняют ничего', () => {
    const found = explainingWork([work()], { kind: 'building', buildingId: 'b2' }, 'plumbing', NOW);

    assert.equal(found, undefined);
  });

  it('объявленные назавтра работы сегодняшнюю аварию не объясняют', () => {
    const tomorrow = work({
      from: new Date(NOW.getTime() + 20 * HOUR),
      until: new Date(NOW.getTime() + 26 * HOUR),
    });

    const found = explainingWork([tomorrow], { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 }, 'plumbing', NOW);

    assert.equal(found, undefined, 'предупреждение, это ещё не отключение');
  });

  it('срок словами: сегодня, время, дальше, с датой', () => {
    assert.match(describeUntil(work(), NOW), /^до \d{2}:\d{2}$/);

    const longer = work({ until: new Date(NOW.getTime() + 20 * HOUR) });

    assert.match(describeUntil(longer, NOW), /завтра$/);

    const week = work({ until: new Date(NOW.getTime() + 7 * 24 * HOUR) });

    assert.match(describeUntil(week, NOW), /сентября/);
  });

  it('время показывается в поясе дома, а не сервера', () => {
    const until = new Date('2026-09-03T13:00:00Z');

    assert.equal(describeUntil(work({ until }), NOW), 'до 16:00');
    assert.equal(describeUntil(work({ until }), NOW, 'Asia/Vladivostok'), 'до 23:00');
  });

  it('день считается по поясу дома: полночь по UTC, это уже завтра', () => {
    const until = new Date('2026-09-03T22:00:00Z');

    assert.match(describeUntil(work({ until }), NOW), /завтра$/);
  });

  it('послезавтра завтрашним не называется, хотя до него меньше двух суток', () => {
    const until = new Date('2026-09-05T02:00:00Z');

    assert.equal(describeUntil(work({ until }), NOW), 'до 5 сентября, 05:00');
  });

  it('ответ жильцу начинается со срока, а не с названия работ', () => {
    const [first, second] = describeWork(work(), NOW).split('\n');

    assert.match(first ?? '', /^Водоснабжение и канализация: плановые работы до /);
    assert.match(second ?? '', /Замена задвижки на стояке: подъезд 1, стояк 2/);
  });
});

describe('события плановых работ между проверками', () => {
  const planned = work({
    from: new Date(NOW.getTime() + 48 * HOUR),
    until: new Date(NOW.getTime() + 54 * HOUR),
  });

  /** Момент попадает ровно в стык двух окон: он принадлежит первому из них. */
  const atJunction = (moment: Date): [ReturnType<typeof worksCrossedIn>, ReturnType<typeof worksCrossedIn>] => [
    worksCrossedIn(planned, new Date(moment.getTime() - HOUR), moment),
    worksCrossedIn(planned, moment, new Date(moment.getTime() + HOUR)),
  ];

  it('предупреждение отдаётся один раз, окном, которое кончается на нём', () => {
    const warning = new Date(planned.from.getTime() - WORKS_WARNING_HOURS * HOUR);

    assert.deepEqual(atJunction(warning), ['soon', null]);
  });

  it('начало работ тоже достаётся первому окну', () => {
    assert.deepEqual(atJunction(planned.from), ['started', null]);
  });

  it('и конец работ', () => {
    assert.deepEqual(atJunction(planned.until), ['finished', null]);
  });

  it('между событиями сообщать не о чем', () => {
    const quiet = new Date(planned.from.getTime() - 10 * HOUR);

    assert.equal(worksCrossedIn(planned, quiet, new Date(quiet.getTime() + HOUR)), null);
  });
});
