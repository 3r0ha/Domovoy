import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyTransition,
  audiencesOverlap,
  createRequest,
  findJoinable,
  isConfirmedIncident,
  joinRequest,
  leaveRequest,
  markUnaffected,
  promoteToShared,
  reportersCount,
  spreadOf,
  type AnnouncementAudience,
  type LocatedRequest,
  type ServiceRequest,
} from '../dist/index.js';

const CREATED_AT = new Date('2026-09-03T10:00:00Z');
const RISER: AnnouncementAudience = { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 };

const request = (overrides: Partial<Parameters<typeof createRequest>[0]> = {}): ServiceRequest =>
  createRequest({
    id: 'req-1',
    buildingId: 'b1',
    buildingCode: 'Д15',
    sequence: 1,
    authorId: 'res-1',
    category: 'plumbing',
    target: { kind: 'apartment', apartmentId: 'apt-1' },
    description: 'Нет горячей воды',
    createdAt: CREATED_AT,
    ...overrides,
  });

const located = (value: ServiceRequest, audience: AnnouncementAudience | null = RISER): LocatedRequest => ({
  request: value,
  audience,
});

const candidate = (overrides: Partial<Parameters<typeof findJoinable>[0]> = {}) => ({
  category: 'plumbing' as const,
  audience: RISER,
  at: new Date(CREATED_AT.getTime() + 3600_000),
  authorId: 'res-2',
  ...overrides,
});

describe('пересечение зон', () => {
  it('дом включает любой свой стояк', () => {
    assert.equal(audiencesOverlap({ kind: 'building', buildingId: 'b1' }, RISER), true);
    assert.equal(audiencesOverlap(RISER, { kind: 'building', buildingId: 'b1' }), true);
  });

  it('подъезд включает свои стояки, но не чужие', () => {
    assert.equal(audiencesOverlap({ kind: 'entrance', buildingId: 'b1', entrance: 1 }, RISER), true);
    assert.equal(audiencesOverlap({ kind: 'entrance', buildingId: 'b1', entrance: 2 }, RISER), false);
  });

  it('разные дома не пересекаются никогда', () => {
    assert.equal(audiencesOverlap({ kind: 'building', buildingId: 'b2' }, RISER), false);
  });
});

describe('поиск заявки, о которой уже сообщили', () => {
  it('сосед по стояку попадает в ту же заявку', () => {
    const found = findJoinable(candidate(), [located(request())]);

    assert.equal(found?.id, 'req-1');
  });

  it('другая категория, другая проблема', () => {
    const found = findJoinable(candidate({ category: 'cleaning' }), [located(request({ category: 'cleaning' }))]);

    assert.equal(found, undefined, 'уборка не распространяется по стояку');
  });

  it('квартирная проблема не склеивается', () => {
    const found = findJoinable(candidate({ audience: null }), [located(request())]);

    assert.equal(found, undefined);
  });

  it('автор к своей же заявке не присоединяется', () => {
    const found = findJoinable(candidate({ authorId: 'res-1' }), [located(request())]);

    assert.equal(found, undefined);
  });

  it('повторное обращение того же соседа ничего не меняет', () => {
    const joined = joinRequest(request(), 'res-2', CREATED_AT);
    const found = findJoinable(candidate(), [located(joined)]);

    assert.equal(found, undefined);
  });

  it('«это другое» снимает и присоединение, и ответ по опросу, но не автора', () => {
    const joined = markUnaffected(joinRequest(request(), 'res-2', CREATED_AT), 'res-3', CREATED_AT);

    const left = leaveRequest(joined, 'res-2');

    assert.equal(reportersCount(left), 1);
    assert.deepEqual(left.notAffected.map((check) => check.residentId), ['res-3']);
    assert.deepEqual(leaveRequest(left, 'res-3').notAffected, []);
    assert.equal(leaveRequest(joined, 'res-1'), joined, 'автор из своей заявки не уходит');
    assert.equal(leaveRequest(left, 'res-9'), left, 'посторонний ничего не меняет');
  });

  it('закрытая заявка не принимает подтверждений', () => {
    const done = applyTransition(
      applyTransition(
        applyTransition(request(), { to: 'accepted', role: 'dispatcher', actorId: 'd', at: CREATED_AT }),
        { to: 'in_progress', role: 'technician', actorId: 't', at: CREATED_AT },
      ),
      { to: 'done', role: 'technician', actorId: 't', at: CREATED_AT, comment: 'Заменил кран' },
    );

    const confirmed = applyTransition(done, {
      to: 'confirmed',
      role: 'resident',
      actorId: 'res-1',
      at: CREATED_AT,
    });

    assert.equal(findJoinable(candidate(), [located(confirmed)]), undefined);
  });

  it('вчерашняя авария сегодняшнюю не поглощает', () => {
    const old = request({ createdAt: new Date(CREATED_AT.getTime() - 48 * 3600_000) });

    assert.equal(findJoinable(candidate(), [located(old)]), undefined);
  });

  it('из нескольких подходящих берётся самая ранняя', () => {
    const first = request({ id: 'first', createdAt: CREATED_AT });
    const second = request({ id: 'second', createdAt: new Date(CREATED_AT.getTime() + 600_000) });

    const found = findJoinable(candidate(), [located(second), located(first)]);

    assert.equal(found?.id, 'first', 'к ней уже привязаны наряд и срок');
  });
});

describe('подтверждения соседей', () => {
  it('копятся и делают из жалобы аварию', () => {
    let value = request();

    assert.equal(reportersCount(value), 1);
    assert.equal(isConfirmedIncident(value), false);

    value = joinRequest(value, 'res-2', CREATED_AT);
    value = joinRequest(value, 'res-3', CREATED_AT);

    assert.equal(reportersCount(value), 3);
    assert.equal(isConfirmedIncident(value), true, 'трое независимо, это уже не жалоба одного');
  });

  it('один и тот же житель дважды не считается', () => {
    const once = joinRequest(request(), 'res-2', CREATED_AT);

    assert.equal(reportersCount(joinRequest(once, 'res-2', CREATED_AT)), 2);
  });
});

describe('опрос соседей', () => {
  it('пока никто не ответил, говорить нечего', () => {
    assert.deepEqual(spreadOf(request()), { affected: 1, fine: 0, verdict: 'unknown' });
  });

  it('сосед с тем же самым означает общее имущество', () => {
    const answered = joinRequest(request(), 'res-2', CREATED_AT);

    assert.deepEqual(spreadOf(answered), { affected: 2, fine: 0, verdict: 'shared' });
  });

  it('два «у меня работает» сужают аварию до квартиры', () => {
    const one = markUnaffected(request(), 'res-2', CREATED_AT);

    assert.equal(spreadOf(one).verdict, 'unknown');

    const two = markUnaffected(one, 'res-3', CREATED_AT);

    assert.deepEqual(spreadOf(two), { affected: 1, fine: 2, verdict: 'local' });
  });

  it('подтверждение перевешивает: чинить всё равно общее', () => {
    const mixed = joinRequest(
      markUnaffected(markUnaffected(request(), 'res-2', CREATED_AT), 'res-3', CREATED_AT),
      'res-4',
      CREATED_AT,
    );

    assert.deepEqual(spreadOf(mixed), { affected: 2, fine: 2, verdict: 'shared' });
  });

  it('ответивший не отвечает дважды и не меняет сторону', () => {
    const said = joinRequest(request(), 'res-2', CREATED_AT);
    const again = markUnaffected(said, 'res-2', CREATED_AT);

    assert.equal(again.notAffected.length, 0, 'сообщивший о проблеме уже дал показание');
    assert.equal(markUnaffected(markUnaffected(request(), 'res-2', CREATED_AT), 'res-2', CREATED_AT).notAffected.length, 1);
  });

  it('автор обращения сам себе сосед не бывает', () => {
    assert.equal(markUnaffected(request(), 'res-1', CREATED_AT).notAffected.length, 0);
  });
});

describe('повышение до общего имущества', () => {
  it('второе обращение по стояку переносит заявку с квартиры на стояк', () => {
    const promoted = promoteToShared(request(), RISER);

    assert.deepEqual(promoted.target, { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 });
  });

  it('подъездная авария переносит заявку на подъезд', () => {
    const promoted = promoteToShared(request(), { kind: 'entrance', buildingId: 'b1', entrance: 3 });

    assert.deepEqual(promoted.target, { kind: 'entrance', buildingId: 'b1', entrance: 3 });
  });

  it('общедомовая, на дом целиком', () => {
    const promoted = promoteToShared(request(), { kind: 'building', buildingId: 'b1' });

    assert.deepEqual(promoted.target, { kind: 'building', buildingId: 'b1' });
  });

  it('уже общий адрес не трогается', () => {
    const shared = request({ target: { kind: 'entrance', buildingId: 'b1', entrance: 1 } });

    assert.deepEqual(promoteToShared(shared, RISER).target, {
      kind: 'entrance',
      buildingId: 'b1',
      entrance: 1,
    });
  });
});
