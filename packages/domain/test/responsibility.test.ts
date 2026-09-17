import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HANDOFF_HOURS,
  handoffDueAt,
  isHandoffOverdue,
  isHandoffTarget,
  responsibilityFor,
  type Handoff,
} from '../dist/index.js';

const FLAT = { kind: 'apartment', apartmentId: 'apt-1', number: 1 } as const;
const RISER = { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 } as const;
const LIFT = { kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-1' } as const;

describe('зона ответственности', () => {
  it('общее имущество ведёт управляющая организация', () => {
    const answer = responsibilityFor('plumbing', RISER);

    assert.equal(answer.kind, 'management');
    assert.match(answer.basis, /ст\. 36 ЖК РФ/);
  });

  it('течь только в одной квартире это зона собственника', () => {
    const answer = responsibilityFor('plumbing', FLAT, 'local');

    assert.equal(answer.kind, 'owner');
    assert.match(answer.basis, /первого отключающего устройства/);
    assert.match(answer.next ?? '', /по отдельной заявке/);
  });

  it('пока неизвестно, одна ли квартира, отвечает организация', () => {
    assert.equal(responsibilityFor('plumbing', FLAT).kind, 'management');
    assert.equal(responsibilityFor('plumbing', FLAT, 'shared').kind, 'management');
  });

  it('лифт обслуживает специализированная организация', () => {
    const answer = responsibilityFor('elevator', LIFT);

    assert.equal(answer.kind, 'contractor');
    assert.match(answer.basis, /ТР ТС 011\/2011/);
  });

  it('двор ведёт организация, но граница участка названа', () => {
    const answer = responsibilityFor('yard', { kind: 'building', buildingId: 'b1' });

    assert.equal(answer.kind, 'management');
    assert.match(answer.next ?? '', /за границей участка/i);
  });

  it('уборка и справки остаются за организацией', () => {
    assert.equal(responsibilityFor('cleaning', RISER).kind, 'management');
    assert.equal(responsibilityFor('document', FLAT, 'local').kind, 'management');
  });
});

describe('передача обращения', () => {
  const sent = (to: Handoff['to'], at: Date): Handoff => ({
    id: 'h-1',
    requestId: 'req-1',
    buildingId: 'b1',
    to,
    organization: 'Водоканал',
    channel: 'manual',
    status: 'sent',
    dueAt: handoffDueAt(to, at),
    createdAt: at,
  });

  it('срок ответа берётся из нормы, а не назначается продуктом', () => {
    const at = new Date('2026-09-22T10:00:00Z');

    assert.equal(HANDOFF_HOURS.resource, 2);
    assert.equal(handoffDueAt('resource', at).toISOString(), '2026-09-22T12:00:00.000Z');
    assert.equal(handoffDueAt('municipal', at).toISOString(), '2026-10-22T10:00:00.000Z');
  });

  it('просрочка наступает после срока и только пока ответа нет', () => {
    const at = new Date('2026-09-22T10:00:00Z');
    const handoff = sent('resource', at);

    assert.equal(isHandoffOverdue(handoff, new Date('2026-09-22T11:00:00Z')), false);
    assert.equal(isHandoffOverdue(handoff, new Date('2026-09-22T13:00:00Z')), true);
    assert.equal(isHandoffOverdue({ ...handoff, status: 'answered' }, new Date('2026-09-30T10:00:00Z')), false);
    assert.equal(isHandoffOverdue({ ...handoff, status: 'failed' }, new Date('2026-09-30T10:00:00Z')), false);
  });

  it('чужое слово адресатом не становится', () => {
    assert.equal(isHandoffTarget('resource'), true);
    assert.equal(isHandoffTarget('кто-нибудь'), false);
  });
});
