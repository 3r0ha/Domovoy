import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Inspection, PlannedWork, ServiceRequest } from '@domovoy/domain';

import {
  formatAcceptanceReminder,
  formatAssignment,
  formatAutoConfirmed,
  formatBreachForStaff,
  formatDeadlineWarning,
  formatGuestEntry,
  formatInspection,
  formatMessage,
  formatNeighbourAlert,
  formatNeighbourQuestion,
  formatNewRequest,
  formatOverdue,
  formatStatusChange,
  formatWorksFinished,
  formatWorksSoon,
  formatWorksStarted,
} from '../dist/index.js';

const NOW = new Date('2026-09-07T06:00:00Z');

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
  createdAt: NOW,
  reactionDueAt: new Date('2026-09-07T10:00:00Z'),
  resolutionDueAt: new Date('2026-09-08T06:00:00Z'),
  history: [],
  joinedBy: [],
  notAffected: [],
  attachments: [],
  reopenCount: 0,
  ...overrides,
});

const work: PlannedWork = {
  id: 'ann-1',
  title: 'Замена запорной арматуры',
  category: 'plumbing',
  audience: { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 },
  from: new Date('2026-09-07T06:00:00Z'),
  until: new Date('2026-09-07T11:00:00Z'),
};

const inspection: Inspection = {
  id: 'insp-1',
  buildingId: 'b1',
  kind: 'entrance',
  entrance: 1,
  items: [],
  requestIds: [],
  dueAt: new Date('2026-09-20T06:00:00Z'),
  createdAt: NOW,
};

describe('тексты уведомлений', () => {
  it('смена статуса называет заявку, её суть, категорию и адрес', () => {
    const text = formatStatusChange(request({ status: 'in_progress' }));

    assert.equal(
      text,
      'Заявка Д15-2609-0001 выполняется.\nНет горячей воды\nВодоснабжение и канализация, подъезд 1, стояк 2.',
    );
  });

  it('причина отказа договаривается до жильца, а не теряется в статусе', () => {
    const text = formatStatusChange(
      request({
        status: 'rejected',
        history: [
          { at: NOW, actorId: 'disp-1', role: 'dispatcher', status: 'rejected', comment: 'Зона ответственности собственника' },
        ],
      }),
    );

    assert.match(text, /Зона ответственности собственника$/);
  });

  it('наряд исполнителю называет срок днём и часом, а не числами через точку', () => {
    const text = formatAssignment(request());

    assert.match(text, /^Вам поручена заявка Д15-2609-0001\./);
    assert.match(text, /Срок: 8 сентября в 09:00\.$/);
  });

  it('пояс дома меняет срок в наряде', () => {
    assert.match(formatAssignment(request(), 'Asia/Vladivostok'), /Срок: 8 сентября в 16:00\./);
  });

  it('авария в уведомлении диспетчера стоит первым словом', () => {
    const text = formatNewRequest(request({ priority: 'emergency' }), 1);

    assert.match(text, /^АВАРИЯ\. Новая заявка: Нет горячей воды/);
    assert.doesNotMatch(formatNewRequest(request(), 1), /АВАРИЯ/);
  });

  it('число сообщивших появляется только когда их больше одного', () => {
    assert.doesNotMatch(formatNewRequest(request(), 1), /Сообщили/);
    assert.match(formatNewRequest(request(), 3), /\nСообщили: 3$/);
  });

  it('соседа спрашивают, а не пугают', () => {
    const text = formatNeighbourQuestion(request());

    assert.match(text, /^Сосед по стояку сообщает: нет горячей воды\./);
    assert.match(text, /У вас то же самое\?$/);
  });

  it('предупреждение соседям называет срок словами', () => {
    const text = formatNeighbourAlert(request(), request().resolutionDueAt);

    assert.match(text, /срок до 8 сентября в 09:00/);
    assert.doesNotMatch(text, /\d{2}\.\d{2}\.\d{4}/);
  });

  it('о просрочке жильцу говорят прямо, а путь в инспекцию открывают не всегда', () => {
    assert.match(formatOverdue(request(), 'reaction', false), /заявку до сих пор не приняли в работу/);
    assert.doesNotMatch(formatOverdue(request(), 'reaction', false), /жилинспекц/);
    assert.match(formatOverdue(request(), 'resolution', true), /Есть основание обратиться в жилищную инспекцию/);
  });

  it('напоминание о приёмке объясняет, что будет, если промолчать', () => {
    const text = formatAcceptanceReminder(request({ status: 'done' }), 24);

    assert.match(text, /через 24 часа заявка закроется сама/);
    assert.match(text, /верните её в работу/);
  });

  it('автозакрытие не выглядит отказом: старая заявка остаётся в истории', () => {
    assert.match(formatAutoConfirmed(request(), 48), /за 48 часов возражений не поступило/);
    assert.match(formatAutoConfirmed(request(), 48), /останется в истории объекта/);
  });

  it('горящий срок называет остаток минутами, пока их меньше часа', () => {
    const soon = formatDeadlineWarning(request(), 'reaction', new Date('2026-09-07T09:30:00Z'));
    const later = formatDeadlineWarning(request(), 'resolution', new Date('2026-09-08T03:00:00Z'));

    assert.match(soon, /Осталось 30 минут\.$/);
    assert.match(later, /Осталось 3 часа\.$/);
  });

  it('просроченный срок не превращается в отрицательный остаток', () => {
    const late = formatDeadlineWarning(request(), 'reaction', new Date('2026-09-07T12:00:00Z'));

    assert.match(late, /Осталось 0 минут\.$/);
  });

  it('нарушение норматива управляющей компании напоминает о праве жильца', () => {
    assert.match(formatBreachForStaff(request(), 'resolution'), /нарушен срок выполнения/);
    assert.match(formatBreachForStaff(request(), 'reaction'), /вправе обратиться в жилищную инспекцию/);
  });

  it('работы объявляются одинаково: что, кому и до какого часа', () => {
    assert.match(formatWorksSoon(work, NOW), /^Завтра плановые работы: водоснабжение и канализация\./);
    assert.match(formatWorksStarted(work, NOW), /Закончить планируем до 14:00\./);
    assert.match(formatWorksFinished(work), /Плановые работы завершены по графику/);
    assert.match(formatWorksFinished(work), /напишите, и оформлю заявку/);
  });

  it('обход мастеру называет срок и место', () => {
    assert.equal(
      formatInspection(inspection),
      'Осмотр подъезда: подъезд 1, до 20 сентября.\nПункты обхода в приложении.',
    );
  });

  it('обход по всему дому так и называется', () => {
    assert.match(formatInspection({ ...inspection, entrance: undefined }), /весь дом/);
  });

  it('вход гостя отмечается часом, а не полной датой', () => {
    assert.equal(formatGuestEntry('Домофон, подъезд 1', NOW), 'Гостевой код сработал: Домофон, подъезд 1, 09:00');
  });

  it('сообщение по заявке подписано автором', () => {
    assert.equal(
      formatMessage(request(), 'Управляющая компания', 'Мастер подъедет после обеда'),
      'Заявка Д15-2609-0001. Управляющая компания пишет:\nМастер подъедет после обеда',
    );
  });
});
