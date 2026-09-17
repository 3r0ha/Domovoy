import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CATEGORY_RULES,
  computeDeadlines,
  deadlineCrossedIn,
  isOverdue,
  isReactionOverdue,
  isResolutionOverdue,
  warningCrossedIn,
  type RequestStatus,
  type ServiceRequest,
} from '../dist/index.js';

const CREATED = new Date('2026-09-01T06:00:00Z');

const request = (overrides: Partial<ServiceRequest> = {}): ServiceRequest => ({
  id: 'req-1',
  number: 'Д15-2609-0001',
  buildingId: 'b1',
  authorId: 'res-1',
  category: 'plumbing',
  priority: 'normal',
  target: { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 },
  title: 'Нет горячей воды',
  description: 'Нет горячей воды',
  status: 'new',
  createdAt: CREATED,
  reactionDueAt: new Date('2026-09-01T06:30:00Z'),
  resolutionDueAt: new Date('2026-09-02T06:00:00Z'),
  history: [],
  joinedBy: [],
  notAffected: [],
  attachments: [],
  reopenCount: 0,
  ...overrides,
});

/** Состояния, в которых работа уже не идёт и срок копиться не должен. */
const SETTLED: RequestStatus[] = ['done', 'confirmed', 'rejected', 'withdrawn', 'needs_info'];

describe('нормативные сроки', () => {
  it('срочность сжимает сроки, плановость растягивает', () => {
    const normal = computeDeadlines('plumbing', 'normal', CREATED);
    const emergency = computeDeadlines('plumbing', 'emergency', CREATED);
    const planned = computeDeadlines('plumbing', 'planned', CREATED);

    const minutes = (from: Date, to: Date): number => (to.getTime() - from.getTime()) / 60_000;

    assert.equal(minutes(CREATED, normal.reactionDueAt), 30);
    assert.equal(minutes(CREATED, emergency.reactionDueAt), 8, 'полминуты округляются вверх, а не теряются');
    assert.equal(minutes(CREATED, planned.reactionDueAt), 60);
    assert.equal(minutes(CREATED, planned.resolutionDueAt), 48 * 60);
  });

  it('у каждой категории есть и полное имя, и короткое для чипов', () => {
    for (const [category, rule] of Object.entries(CATEGORY_RULES)) {
      assert.ok(rule.title.length > 0, category);
      assert.ok(rule.short.length > 0, category);
      assert.ok(rule.short.length <= rule.title.length, `${category}: короткое имя длиннее полного`);
      assert.ok(rule.reactionMinutes > 0 && rule.resolutionHours > 0, category);
    }
  });

  it('лифт и безопасность отвечают быстрее всех: там люди, а не неудобство', () => {
    assert.equal(CATEGORY_RULES.elevator.reactionMinutes, 15);
    assert.equal(CATEGORY_RULES.safety.reactionMinutes, 15);
    assert.equal(CATEGORY_RULES.elevator.defaultPriority, 'emergency');
    assert.equal(CATEGORY_RULES.safety.defaultPriority, 'emergency');
  });
});

describe('нарушение срока', () => {
  it('срок реакции нарушает только непринятая заявка', () => {
    const late = new Date('2026-09-01T07:00:00Z');

    assert.equal(isReactionOverdue(request(), late), true);
    assert.equal(isReactionOverdue(request({ status: 'accepted' }), late), false);
  });

  it('ожидание жильца и сданная работа просрочку не копят', () => {
    const late = new Date('2026-09-05T06:00:00Z');

    assert.equal(isResolutionOverdue(request({ status: 'in_progress' }), late), true);

    for (const status of SETTLED) {
      assert.equal(isResolutionOverdue(request({ status }), late), false, status);
    }
  });

  it('просрочена заявка, у которой нарушен хоть один срок', () => {
    assert.equal(isOverdue(request(), new Date('2026-09-01T07:00:00Z')), true);
    assert.equal(isOverdue(request({ status: 'in_progress' }), new Date('2026-09-01T07:00:00Z')), false);
  });
});

describe('переход через срок между проверками', () => {
  it('срок засчитывается один раз, в тот проход, когда он и наступил', () => {
    const before = deadlineCrossedIn(request(), new Date('2026-09-01T06:00:00Z'), new Date('2026-09-01T06:20:00Z'));
    const during = deadlineCrossedIn(request(), new Date('2026-09-01T06:20:00Z'), new Date('2026-09-01T06:40:00Z'));
    const after = deadlineCrossedIn(request(), new Date('2026-09-01T06:40:00Z'), new Date('2026-09-01T07:00:00Z'));

    assert.equal(before, null);
    assert.equal(during, 'reaction');
    assert.equal(after, null, 'иначе о нарушении напоминали бы каждые пять минут');
  });

  it('граница промежутка принадлежит правому концу', () => {
    const exactly = deadlineCrossedIn(request(), new Date('2026-09-01T06:00:00Z'), new Date('2026-09-01T06:30:00Z'));

    assert.equal(exactly, 'reaction');
  });

  it('сданная работа срок не пересекает', () => {
    for (const status of SETTLED) {
      const crossed = deadlineCrossedIn(
        request({ status }),
        new Date('2026-09-02T05:00:00Z'),
        new Date('2026-09-02T07:00:00Z'),
      );

      assert.equal(crossed, null, status);
    }
  });

  it('предупреждение приходит в последнюю четверть срока, а не за минуту до него', () => {
    const early = warningCrossedIn(request(), new Date('2026-09-01T06:00:00Z'), new Date('2026-09-01T06:20:00Z'));
    const point = warningCrossedIn(request(), new Date('2026-09-01T06:20:00Z'), new Date('2026-09-01T06:25:00Z'));

    assert.equal(early, null);
    assert.equal(point, 'reaction');
  });

  it('о том, на что сотрудник не влияет, его не предупреждают', () => {
    for (const status of SETTLED) {
      const warned = warningCrossedIn(
        request({ status }),
        new Date('2026-09-01T23:00:00Z'),
        new Date('2026-09-02T01:00:00Z'),
      );

      assert.equal(warned, null, status);
    }
  });
});
