import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildComplaint, canEscalate, type ServiceRequest } from '../dist/index.js';

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
  description: 'Нет горячей воды со вчерашнего вечера',
  status: 'new',
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

describe('основание для жалобы', () => {
  it('пока сроки соблюдаются, обращаться не с чем', () => {
    const check = canEscalate(request(), new Date('2026-09-01T08:00:00Z'));

    assert.equal(check.possible, false);
    assert.equal(check.reason, 'сроки соблюдаются');
  });

  it('непринятая заявка, основание сразу после срока реакции', () => {
    const check = canEscalate(request(), new Date('2026-09-01T10:30:00Z'));

    assert.equal(check.possible, true);
    assert.match(check.reason, /срок ответа нарушен на 30 минут/);
  });

  it('просрочка выполнения становится основанием только при двукратном превышении', () => {
    const working = request({ status: 'in_progress' });

    const early = canEscalate(working, new Date('2026-09-02T12:00:00Z'));

    assert.equal(early.possible, false);
    assert.match(early.reason, /в пределах разумного/);

    const late = canEscalate(working, new Date('2026-09-03T07:00:00Z'));

    assert.equal(late.possible, true);
    assert.match(late.reason, /работы не выполнены за 2 дня при назначенном сроке 1 день/);
  });

  it('в основании стоит срок самой заявки, а не срок категории', () => {
    // Срок продлили при регистрации, и в документе он печатается ещё и числом:
    // два разных срока в одной бумаге, это повод отказать по ней.
    const working = request({ status: 'in_progress', resolutionDueAt: new Date('2026-09-03T06:00:00Z') });

    const check = canEscalate(working, new Date('2026-09-05T07:00:00Z'));

    assert.equal(check.possible, true);
    assert.match(check.reason, /при назначенном сроке 2 дня/);
  });

  it('закрытая заявка поводом не служит, даже если её вели плохо', () => {
    for (const status of ['confirmed', 'rejected'] as const) {
      const check = canEscalate(request({ status }), new Date('2026-09-30T06:00:00Z'));

      assert.equal(check.possible, false, status);
      assert.equal(check.reason, 'заявка закрыта');
    }
  });
});

describe('обращение в жилищную инспекцию', () => {
  const complaint = (overrides: Partial<ServiceRequest> = {}): string =>
    buildComplaint({
      request: request({
        status: 'in_progress',
        history: [
          { at: CREATED, actorId: 'res-1', role: 'resident', status: 'new' },
          { at: new Date('2026-09-01T11:00:00Z'), actorId: 'disp-1', role: 'dispatcher', status: 'accepted' },
          {
            at: new Date('2026-09-02T09:00:00Z'),
            actorId: 'res-1',
            role: 'resident',
            kind: 'message',
            status: 'in_progress',
            comment: 'Воды по-прежнему нет',
          },
        ],
        ...overrides,
      }),
      address: 'ул. Ленина, 15',
      residentName: 'Мария Иванова',
      residentApartment: 1,
      managementCompany: 'ООО «УК Ленинская»',
      now: new Date('2026-09-03T07:00:00Z'),
      actorName: (id) => (id === 'res-1' ? 'заявитель' : 'управляющая компания'),
    });

  it('документ начинается с адресата и заявителя', () => {
    const lines = complaint().split('\n');

    assert.equal(lines[0], 'В Государственную жилищную инспекцию');
    assert.equal(lines[2], 'От: Мария Иванова');
    assert.equal(lines[3], 'Адрес: ул. Ленина, 15, кв. 1');
    assert.equal(lines[4], 'Управляющая организация: ООО «УК Ленинская»');
  });

  it('без управляющей организации строка не превращается в пустую', () => {
    const text = buildComplaint({
      request: request(),
      address: 'ул. Ленина, 15',
      residentName: 'Мария Иванова',
      now: new Date('2026-09-03T07:00:00Z'),
    });

    assert.doesNotMatch(text, /Управляющая организация/);
    assert.doesNotMatch(text, /undefined/);
    assert.match(text, /Адрес: ул\. Ленина, 15\n/);
  });

  it('сроки названы оба и отнесены к управляющей организации, а не к закону', () => {
    const text = complaint();

    assert.match(text, /реакция: до 01\.09\.2026, 13:00/);
    assert.match(text, /выполнение: до 02\.09\.2026, 09:00/);
    assert.doesNotMatch(text, /Нормативные сроки/, 'это регламент компании, инспекция проверяет по своим');
  });

  it('хронология перечисляет и переходы, и переписку', () => {
    const text = complaint();

    assert.match(text, /01\.09\.2026, 09:00: зарегистрирована \(заявитель\)/);
    assert.match(text, /01\.09\.2026, 14:00: принята в работу \(управляющая компания\)/);
    assert.match(text, /02\.09\.2026, 12:00: сообщение \(заявитель\): Воды по-прежнему нет/);
  });

  it('нарушение названо основанием, а не общими словами', () => {
    assert.match(
      complaint(),
      /Нарушение на 03\.09\.2026, 10:00: работы не выполнены за 2 дня при назначенном сроке 1 день\./,
    );
  });

  it('без имён участников обращение не разваливается', () => {
    const text = buildComplaint({
      request: request({ history: [{ at: CREATED, actorId: 'res-1', role: 'resident', status: 'new' }] }),
      address: 'ул. Ленина, 15',
      residentName: 'Мария Иванова',
      now: new Date('2026-09-03T07:00:00Z'),
    });

    assert.match(text, /зарегистрирована \(res-1\)/);
  });

  it('заканчивается просьбой, с которой инспекция и работает', () => {
    assert.match(complaint(), /Прошу провести проверку и принять меры в пределах компетенции\.$/);
  });
});
