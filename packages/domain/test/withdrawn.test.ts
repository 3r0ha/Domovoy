import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assessDeadlineRisk,
  canEscalate,
  categoryLoad,
  confirmedIncidents,
  isOverdue,
  summarize,
  type ServiceRequest,
} from '../dist/index.js';

const CREATED = new Date('2026-09-01T06:00:00Z');
const LATE = new Date('2026-09-10T06:00:00Z');

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
  status: 'withdrawn',
  createdAt: CREATED,
  reactionDueAt: new Date('2026-09-01T06:30:00Z'),
  resolutionDueAt: new Date('2026-09-02T06:00:00Z'),
  history: [],
  joinedBy: [{ residentId: 'res-2', at: CREATED }],
  notAffected: [],
  attachments: [],
  reopenCount: 0,
  ...overrides,
});

describe('жилец снял своё обращение', () => {
  it('срок по нему больше не идёт', () => {
    assert.equal(isOverdue(request(), LATE), false);
    assert.equal(assessDeadlineRisk(request(), [], LATE).risk, 'none');
  });

  it('в сводку дома оно не попадает ни открытым, ни просроченным', () => {
    const summary = summarize([request()], LATE);

    assert.equal(summary.open, 0);
    assert.equal(summary.overdue, 0);
  });

  it('норматив по нему не считается нарушенным', () => {
    const [load] = categoryLoad([request()], LATE);

    assert.equal(load?.overdue, 0);
  });

  it('в подтверждённые аварии оно не попадает', () => {
    assert.deepEqual(confirmedIncidents([request()]), []);
  });

  it('основания для жалобы в жилинспекцию по нему нет', () => {
    const check = canEscalate(request(), LATE);

    assert.equal(check.possible, false);
    assert.equal(check.reason, 'заявка закрыта');
  });
});
