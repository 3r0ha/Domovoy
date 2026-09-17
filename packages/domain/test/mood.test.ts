import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { houseMood, type ServiceRequest } from '../dist/index.js';

const CREATED = new Date('2026-09-01T06:00:00Z');
const NOW = new Date('2026-09-01T08:00:00Z');

const request = (overrides: Partial<ServiceRequest> = {}): ServiceRequest => ({
  id: 'req-1',
  number: 'Д15-2609-0001',
  buildingId: 'b1',
  authorId: 'res-1',
  category: 'plumbing',
  priority: 'normal',
  target: { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 },
  title: 'Нет горячей воды',
  description: 'Нет горячей воды со вчерашнего вечера',
  status: 'accepted',
  createdAt: CREATED,
  reactionDueAt: new Date('2026-09-01T10:00:00Z'),
  resolutionDueAt: new Date('2026-09-02T06:00:00Z'),
  history: [],
  joinedBy: [],
  notAffected: [],
  attachments: [],
  reopenCount: 0,
  ...overrides,
});

describe('состояние дома', () => {
  it('дом без открытых заявок спокоен', () => {
    assert.equal(houseMood([], NOW), 'sleeping');
  });

  it('заявка в срок дом не будит', () => {
    assert.equal(houseMood([request()], NOW), 'sleeping');
  });

  it('просроченная заявка поднимает домового', () => {
    const overdue = request({ resolutionDueAt: new Date('2026-09-01T07:00:00Z') });

    assert.equal(houseMood([overdue], NOW), 'walking');
  });

  it('авария важнее просрочки', () => {
    const overdue = request({ resolutionDueAt: new Date('2026-09-01T07:00:00Z') });
    const emergency = request({ id: 'req-2', priority: 'emergency' });

    assert.equal(houseMood([overdue, emergency], NOW), 'alarmed');
  });

  it('закрытые заявки состояние дома не портят', () => {
    const settled = request({
      status: 'confirmed',
      priority: 'emergency',
      resolutionDueAt: new Date('2026-09-01T07:00:00Z'),
    });

    assert.equal(houseMood([settled], NOW), 'sleeping');
  });
});
