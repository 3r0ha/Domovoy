import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DomainError,
  NOTICE_TO_ADMIN_DAYS,
  NOTICE_TO_OWNERS_DAYS,
  PAPER_CUTOFF_HOURS,
  PROTOCOL_STORAGE_YEARS,
  VOTING_MAX_DAYS,
  VOTING_MIN_DAYS,
  meetingSchedule,
} from '../dist/index.js';

const ANNOUNCED = new Date('2026-09-01T00:00:00Z');
const DAY = 24 * 3600_000;

const schedule = (days: number) => meetingSchedule({ announcedAt: ANNOUNCED, days });

describe('расписание общего собрания', () => {
  it('голосование открывается через срок на извещение собственников', () => {
    const plan = schedule(VOTING_MIN_DAYS);

    assert.equal(NOTICE_TO_OWNERS_DAYS, 10);
    assert.equal(plan.noticeBy.toISOString(), ANNOUNCED.toISOString());
    assert.equal(plan.votingFrom.toISOString(), '2026-09-11T00:00:00.000Z');
    assert.equal(plan.votingTo.toISOString(), '2026-09-18T00:00:00.000Z');
  });

  it('администратор получает сообщение раньше собственников', () => {
    const plan = schedule(VOTING_MIN_DAYS);

    assert.equal(plan.noticeToAdminBy.toISOString(), '2026-08-28T00:00:00.000Z');
    assert.equal(
      plan.votingFrom.getTime() - plan.noticeToAdminBy.getTime(),
      NOTICE_TO_ADMIN_DAYS * DAY,
    );
    assert.ok(plan.noticeToAdminBy.getTime() < plan.noticeBy.getTime());
  });

  it('письменные решения принимаются до отсечки перед концом голосования', () => {
    const plan = schedule(VOTING_MIN_DAYS);

    assert.equal(PAPER_CUTOFF_HOURS, 48);
    assert.equal(plan.paperBy.toISOString(), '2026-09-16T00:00:00.000Z');
    assert.equal(plan.votingTo.getTime() - plan.paperBy.getTime(), PAPER_CUTOFF_HOURS * 3600_000);
  });

  it('подлинники хранятся годами после конца голосования', () => {
    const plan = schedule(VOTING_MIN_DAYS);

    assert.equal(PROTOCOL_STORAGE_YEARS, 3);
    assert.equal(plan.storageUntil.toISOString(), '2029-09-18T00:00:00.000Z');
    assert.ok(plan.storageUntil.getTime() > plan.toInspectionBy.getTime());
  });

  it('семь и шестьдесят дней голосования принимаются', () => {
    assert.equal(schedule(VOTING_MIN_DAYS).votingTo.toISOString(), '2026-09-18T00:00:00.000Z');
    assert.equal(schedule(VOTING_MAX_DAYS).votingTo.toISOString(), '2026-11-10T00:00:00.000Z');
  });

  it('за границами срока собрание не назначается', () => {
    for (const days of [VOTING_MIN_DAYS - 1, VOTING_MAX_DAYS + 1, 0, -7, 10.5]) {
      assert.throws(
        () => schedule(days),
        (error: unknown) => {
          assert.ok(error instanceof DomainError);
          assert.equal(error.code, 'poll_period_invalid');
          return true;
        },
        `срок ${days} должен быть отклонён`,
      );
    }
  });
});
