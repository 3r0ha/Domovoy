import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyTransition,
  assigneeQuality,
  categoryLoad,
  confirmedIncidents,
  createRequest,
  dailyLoad,
  joinRequest,
  lastDays,
  previousPeriod,
  problemObjects,
  summarize,
  summarizePeriod,
  type Period,
  type RequestTarget,
  type ServiceRequest,
} from '../dist/index.js';

const CREATED_AT = new Date('2026-09-03T10:00:00Z');
const HOUR = 3600_000;

let sequence = 0;

const request = (overrides: Partial<Parameters<typeof createRequest>[0]> = {}): ServiceRequest =>
  createRequest({
    id: `req-${++sequence}`,
    buildingId: 'b1',
    buildingCode: 'Д15',
    sequence,
    authorId: 'res-1',
    category: 'plumbing',
    target: { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 },
    description: 'Нет горячей воды',
    createdAt: CREATED_AT,
    ...overrides,
  });

const step = (value: ServiceRequest, to: Parameters<typeof applyTransition>[1]['to'], extra: Record<string, unknown> = {}) =>
  applyTransition(value, {
    to,
    role: to === 'confirmed' ? 'resident' : to === 'accepted' ? 'dispatcher' : 'technician',
    actorId: 'actor',
    at: CREATED_AT,
    ...(to === 'done' ? { comment: 'Работа сдана' } : {}),
    ...extra,
  });

/** Заявка, доведённая до «выполнено» назначенным мастером. */
const done = (assigneeId: string, overrides: Partial<Parameters<typeof createRequest>[0]> = {}): ServiceRequest =>
  step(step(step(request(overrides), 'accepted'), 'in_progress', { assigneeId }), 'done');

describe('сводка по дому', () => {
  it('считает открытые, просроченные и принятые', () => {
    const now = new Date(CREATED_AT.getTime() + 100 * HOUR);

    const requests = [
      request(),
      step(done('tech-1'), 'confirmed'),
      step(step(request(), 'accepted'), 'rejected', { role: 'dispatcher', comment: 'Не наше' }),
    ];

    const summary = summarize(requests, now);

    assert.equal(summary.total, 3);
    assert.equal(summary.open, 1, 'новая заявка ещё в работе');
    assert.equal(summary.overdue, 1, 'её же срок нарушен');
    assert.equal(summary.confirmed, 1);
    assert.equal(summary.rejected, 1);
  });

  it('нарушенный норматив считается одним правилом со сводкой по категориям', () => {
    const late = new Date(CREATED_AT.getTime() + 100 * HOUR);
    const closed = step(step(step(request(), 'accepted'), 'in_progress', { assigneeId: 'tech-1' }), 'done', {
      at: late,
    });

    const now = new Date(late.getTime() + HOUR);
    const [load] = categoryLoad([closed], now);
    const summary = summarize([closed], now);

    assert.equal(summary.missed, 1, 'норматив нарушен, хоть работа и сдана');
    assert.equal(load?.overdue, 1);

    // «Горит сейчас» это другой вопрос: по сданной работе смене бежать некуда.
    assert.equal(summary.overdue, 0);
  });

  it('горящей считается открытая заявка, у которой вышел срок', () => {
    const now = new Date(CREATED_AT.getTime() + 100 * HOUR);
    const summary = summarize([request()], now);

    assert.equal(summary.overdue, 1);
    assert.equal(summary.missed, 1);
  });

  it('показывает, сколько обращений сэкономила склейка', () => {
    const merged = joinRequest(joinRequest(request(), 'res-2', CREATED_AT), 'res-3', CREATED_AT);

    assert.equal(summarize([merged], CREATED_AT).mergedReports, 2);
  });
});

describe('качество работы мастеров', () => {
  it('считает долю непринятых работ', () => {
    const reopened = step(done('tech-1'), 'in_progress', { role: 'resident', comment: 'Вода не появилась' });
    const clean = done('tech-2');

    const quality = assigneeQuality([reopened, clean]);

    assert.equal(quality[0]?.assigneeId, 'tech-1', 'худший показатель сверху');
    assert.equal(quality[0]?.reopened, 1);
    assert.equal(quality[0]?.reopenRate, 1);
    assert.equal(quality[1]?.assigneeId, 'tech-2');
    assert.equal(quality[1]?.reopenRate, 0);
  });

  it('заявки без исполнителя в оценку не попадают', () => {
    assert.deepEqual(assigneeQuality([request(), step(request(), 'accepted')]), []);
  });

  it('переназначение не переписывает чужую историю', () => {
    const first = done('tech-1');
    const returned = step(first, 'in_progress', { role: 'resident', comment: 'Не сделано' });
    const reassigned = step(returned, 'done', { assigneeId: 'tech-2' });

    const quality = assigneeQuality([reassigned]);
    const one = quality.find((item) => item.assigneeId === 'tech-1');
    const two = quality.find((item) => item.assigneeId === 'tech-2');

    assert.equal(one?.completed, 1, 'первая сдача осталась за первым');
    assert.equal(one?.reopened, 1, 'и возврат тоже');
    assert.equal(two?.completed, 1, 'вторая сдача, за вторым');
    assert.equal(two?.reopened, 0, 'чужой возврат ему не достаётся');
  });

  it('оценка достаётся тому, чью работу приняли', () => {
    const returned = step(done('tech-1'), 'in_progress', { role: 'resident', comment: 'Не сделано' });
    const finished = step(step(returned, 'done', { assigneeId: 'tech-2' }), 'confirmed', { rating: 5 });

    const quality = assigneeQuality([finished]);

    assert.equal(quality.find((item) => item.assigneeId === 'tech-2')?.averageRating, 5);
    assert.equal(quality.find((item) => item.assigneeId === 'tech-1')?.rated, 0);
  });

  it('средняя оценка считается только по оценённым работам', () => {
    const praised = step(done('tech-1'), 'confirmed', { rating: 5 });
    const scolded = step(done('tech-1'), 'confirmed', { rating: 3 });
    const silent = step(done('tech-1'), 'confirmed');

    const [quality] = assigneeQuality([praised, scolded, silent]);

    assert.equal(quality?.rated, 2);
    assert.equal(quality?.averageRating, 4);
    assert.equal(quality?.completed, 3);
  });

  it('без единой оценки средняя равна нулю, а не пятёрке', () => {
    const [quality] = assigneeQuality([done('tech-1')]);

    assert.equal(quality?.rated, 0);
    assert.equal(quality?.averageRating, 0);
  });

  it('повторная сдача работы считается отдельно', () => {
    const twice = step(step(done('tech-1'), 'in_progress', { role: 'resident', comment: 'Не сделано' }), 'done');

    const [quality] = assigneeQuality([twice]);

    assert.equal(quality?.completed, 2);
    assert.equal(quality?.reopened, 1);
    assert.equal(quality?.reopenRate, 0.5);
  });
});

describe('объекты, которые пора менять', () => {
  const lift: RequestTarget = { kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-1' };

  it('в отчёт попадают только повторяющиеся поломки', () => {
    const requests = [
      request({ target: lift, category: 'elevator' }),
      request({ target: lift, category: 'elevator' }),
      request({ target: lift, category: 'elevator' }),
      request({ target: { kind: 'entrance', buildingId: 'b1', entrance: 2 } }),
    ];

    const objects = problemObjects(requests);

    assert.equal(objects.length, 1, 'единичная заявка объект проблемным не делает');
    assert.equal(objects[0]?.title, 'оборудование lift-1');
    assert.equal(objects[0]?.requests, 3);
  });

  it('одинаковые по виду, но разные объекты не сливаются', () => {
    const requests = [
      request({ target: { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 1 } }),
      request({ target: { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 } }),
      request({ target: { kind: 'riser', buildingId: 'b1', entrance: 2, riser: 1 } }),
    ];

    assert.deepEqual(problemObjects(requests, 2), [], 'три разных стояка, не один проблемный');
  });

  it('объекты каждого вида считаются отдельно', () => {
    const targets: RequestTarget[] = [
      { kind: 'apartment', apartmentId: 'apt-1' },
      { kind: 'entrance', buildingId: 'b1', entrance: 1 },
      { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 1 },
      { kind: 'building', buildingId: 'b1' },
      { kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-1' },
    ];

    const requests = targets.flatMap((target) => [request({ target }), request({ target })]);
    const objects = problemObjects(requests, 2);

    assert.equal(objects.length, targets.length, 'каждый объект остался собой');
    assert.ok(objects.every((object) => object.requests === 2));
  });

  it('порог настраивается', () => {
    const requests = [request({ target: lift }), request({ target: lift })];

    assert.equal(problemObjects(requests, 2).length, 1);
  });
});

describe('нагрузка по категориям', () => {
  it('сверху то, где норматив выполняется хуже всего', () => {
    const now = new Date(CREATED_AT.getTime() + 100 * HOUR);

    const requests: ServiceRequest[] = [
      request({ category: 'plumbing' }),
      step(done('tech-1', { category: 'cleaning' }), 'confirmed'),
      step(done('tech-1', { category: 'cleaning' }), 'confirmed'),
    ];

    const load = categoryLoad(requests, now);

    assert.equal(load[0]?.category, 'plumbing');
    assert.equal(load[0]?.overdueRate, 1);
    assert.equal(load[1]?.title, 'Уборка');
    assert.equal(load[1]?.overdueRate, 0, 'принятые работы просрочку не копят');
  });
});

describe('подтверждённые аварии', () => {
  it('сверху та, о которой сообщило больше жильцов', () => {
    const many = joinRequest(joinRequest(request(), 'res-2', CREATED_AT), 'res-3', CREATED_AT);
    const few = joinRequest(request(), 'res-4', CREATED_AT);

    const incidents = confirmedIncidents([few, many]);

    assert.deepEqual(
      incidents.map((incident) => incident.reporters),
      [3, 2],
    );
  });

  it('закрытые аварии в список не попадают', () => {
    const closed = step(joinRequest(done('tech-1'), 'res-2', CREATED_AT), 'confirmed');

    assert.deepEqual(confirmedIncidents([closed]), []);
  });

  it('заявка одного жильца аварией не считается', () => {
    assert.deepEqual(confirmedIncidents([request()]), []);
  });
});

describe('итоги за период', () => {
  /** Заявка, сданная через `hours` после подачи. */
  const closedAfter = (hours: number, createdAt: Date = CREATED_AT): ServiceRequest => {
    const at = new Date(createdAt.getTime() + hours * HOUR);
    const created = request({ createdAt });

    return applyTransition(
      applyTransition(applyTransition(created, { to: 'accepted', role: 'dispatcher', actorId: 'd', at: createdAt }), {
        to: 'in_progress',
        role: 'dispatcher',
        actorId: 'd',
        at: createdAt,
        assigneeId: 'tech-1',
      }),
      { to: 'done', role: 'technician', actorId: 'tech-1', at, comment: 'Работа сдана' },
    );
  };

  const now = new Date(CREATED_AT.getTime() + 20 * 24 * HOUR);
  const month: Period = lastDays(now, 30);

  it('считает поданное и закрытое, среднее время и долю в срок', () => {
    const summary = summarizePeriod([closedAfter(10), closedAfter(30), request()], month, now);

    assert.equal(summary.created, 3);
    assert.equal(summary.closed, 2);
    assert.equal(summary.missed, 1);
    assert.equal(summary.inTimeRate, 0.5);
    assert.equal(summary.averageHours, 20);
  });

  it('заявка вне окна в период не попадает', () => {
    const old = request({ createdAt: new Date(CREATED_AT.getTime() - 60 * 24 * HOUR) });
    const summary = summarizePeriod([old], month, now);

    assert.equal(summary.created, 0);
    assert.equal(summary.closed, 0);
  });

  it('прошлый период стыкуется с текущим без нахлёста', () => {
    const before = previousPeriod(month);

    assert.equal(before.to.getTime(), month.from.getTime());
    assert.equal(month.from.getTime() - before.from.getTime(), month.to.getTime() - month.from.getTime());

    const edge = request({ createdAt: month.from });

    assert.equal(summarizePeriod([edge], month, now).created, 0);
    assert.equal(summarizePeriod([edge], before, now).created, 1);
  });

  it('на пустом периоде доли нет: обещать сто процентов не по чему', () => {
    const summary = summarizePeriod([], month, now);

    assert.equal(summary.closed, 0);
    assert.equal(summary.inTimeRate, 0);
    assert.equal(summary.averageHours, 0);
    assert.equal(summary.rated, 0);
    assert.equal(summary.averageRating, 0);
  });

  it('средняя оценка за период считается по оценённым заявкам', () => {
    const rated = (hours: number, rating?: number): ServiceRequest =>
      applyTransition(closedAfter(hours), {
        to: 'confirmed',
        role: 'resident',
        actorId: 'res-1',
        at: new Date(CREATED_AT.getTime() + (hours + 1) * HOUR),
        ...(rating === undefined ? {} : { rating }),
      });

    const summary = summarizePeriod([rated(10, 5), rated(12, 4), rated(14)], month, now);

    assert.equal(summary.rated, 2);
    assert.equal(summary.averageRating, 4.5);
  });

  it('заявка, подана и закрыта в разных периодах, считается по разным событиям', () => {
    const spanning = closedAfter(24 * 25, new Date(CREATED_AT.getTime() - 20 * 24 * HOUR));

    assert.equal(summarizePeriod([spanning], month, now).created, 0);
    assert.equal(summarizePeriod([spanning], month, now).closed, 1);
  });

  it('склеенное обращение считается по своему времени, а не по времени заявки', () => {
    const old = request({ createdAt: new Date(CREATED_AT.getTime() - 60 * 24 * HOUR) });
    const merged = joinRequest(old, 'res-2', CREATED_AT);

    assert.equal(summarizePeriod([merged], month, now).mergedReports, 1, 'обращение внутри окна');
    assert.equal(summarizePeriod([merged], month, now).created, 0, 'а сама заявка, снаружи');
    assert.equal(summarizePeriod([merged], previousPeriod(month), now).mergedReports, 0);
  });
});

describe('пульс дома', () => {
  const period = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-06T00:00:00Z') };

  it('заявки раскладываются по суткам периода', () => {
    const load = dailyLoad(
      [
        request({ createdAt: new Date('2026-09-01T09:00:00Z') }),
        request({ createdAt: new Date('2026-09-01T20:00:00Z') }),
        request({ createdAt: new Date('2026-09-04T12:00:00Z') }),
      ],
      period,
    );

    assert.deepEqual(load, [2, 0, 0, 1, 0]);
  });

  it('то, что было до периода, в пульс не попадает', () => {
    const load = dailyLoad([request({ createdAt: new Date('2026-08-20T09:00:00Z') })], period);

    assert.deepEqual(load, [0, 0, 0, 0, 0]);
  });

  it('без заявок пульс ровный, а не пустой', () => {
    assert.equal(dailyLoad([], period).length, 5);
  });
});
