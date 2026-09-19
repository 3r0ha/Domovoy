import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CATEGORY_RULES,
  DomainError,
  MESSAGE_MAX_LENGTH,
  addMessage,
  allowedTransitions,
  applyTransition,
  audienceForTarget,
  buildDeepLink,
  compareByUrgency,
  computeDeadlines,
  createRequest,
  decodeTarget,
  provesPresence,
  describeAudience,
  describeTarget,
  encodeTarget,
  findTransition,
  formatRequestNumber,
  isConfirmedIncident,
  isOverdue,
  isSameTarget,
  joinRequest,
  MAX_TITLE_LENGTH,
  summarizeDescription,
  isReactionOverdue,
  isResolutionOverdue,
  missedDeadline,
  missedReaction,
  missedResolution,
  reactedAt,
  reportedDoneAt,
  requestNumberIn,
  selectAudience,
  settledAt,
  statusChanges,
  suggestCategory,
  suggestPriority,
  warningCrossedIn,
  WARNING_SHARE,
  type Apartment,
  type ServiceRequest,
} from '../dist/index.js';

const CREATED_AT = new Date('2026-09-03T10:00:00Z');

const makeRequest = (overrides: Partial<Parameters<typeof createRequest>[0]> = {}): ServiceRequest =>
  createRequest({
    id: 'req-1',
    buildingId: 'b1',
    buildingCode: 'Д15',
    sequence: 42,
    authorId: 'user-1',
    category: 'plumbing',
    target: { kind: 'apartment', apartmentId: 'apt-3' },
    description: 'Течёт кран на кухне',
    createdAt: CREATED_AT,
    ...overrides,
  });

describe('создание заявки', () => {
  it('присваивает номер, сроки и первое событие истории', () => {
    const request = makeRequest();

    assert.equal(request.number, 'Д15-2609-0042');
    assert.equal(request.status, 'new');
    assert.equal(request.priority, 'normal');
    assert.equal(request.history.length, 1);
    assert.equal(request.history[0]?.status, 'new');
    assert.ok(request.reactionDueAt > request.createdAt);
    assert.ok(request.resolutionDueAt > request.reactionDueAt);
  });

  it('заголовок делается сам: жилец пишет как говорит', () => {
    const request = makeRequest({
      description: 'Течёт кран на кухне. Вода капает постоянно, тазик набирается за час.',
    });

    assert.equal(request.title, 'Течёт кран на кухне');
  });

  it('длинное описание без точек обрезается по границе слова', () => {
    const request = makeRequest({
      description: 'В подъезде между третьим и четвёртым этажом перегорела лампа и мигает вторая у лифта',
    });

    assert.ok(request.title.length <= MAX_TITLE_LENGTH + 1, `заголовок: ${request.title}`);
    assert.match(request.title, /…$/);
    assert.doesNotMatch(request.title, /\s…$/, 'обрезаем по слову, а не по букве с пробелом');
  });

  it('заголовок можно задать руками: диспетчер знает лучше', () => {
    const request = makeRequest({ description: 'Нет воды', title: '  Стояк ГВС, подъезд 2  ' });

    assert.equal(request.title, 'Стояк ГВС, подъезд 2');
  });

  it('заданный руками заголовок меряется той же длиной, что и сделанный сам', () => {
    const request = makeRequest({
      description: 'Нет воды',
      title: 'Стояк горячего водоснабжения в подъезде номер два от первого до девятого этажа',
    });

    assert.ok(request.title.length <= MAX_TITLE_LENGTH + 1, `заголовок: ${request.title}`);
    assert.match(request.title, /…$/);
  });

  it('короткое описание становится заголовком целиком', () => {
    assert.equal(summarizeDescription('Не горит лампа'), 'Не горит лампа');
    assert.equal(summarizeDescription('  Лифт   не   едет!  '), 'Лифт не едет');
  });

  it('номер читается вслух и подсказывает дом и месяц', () => {
    assert.equal(formatRequestNumber('Д15', 7, new Date('2026-01-05T00:00:00Z')), 'Д15-2601-0007');
    assert.equal(formatRequestNumber('К3', 1234, new Date('2026-12-31T00:00:00Z')), 'К3-2612-1234');
  });

  it('номер заявки находится и посреди фразы', () => {
    assert.equal(requestNumberIn('Д15-2609-0001'), 'Д15-2609-0001', 'сообщение целиком');
    assert.equal(requestNumberIn('закрой заявку Д15-2609-0001, пожалуйста'), 'Д15-2609-0001');
    assert.equal(requestNumberIn('что там по Д15-2609-0001?'), 'Д15-2609-0001', 'номер в конце фразы');
  });

  it('на номер заявки похоже не всё подряд', () => {
    assert.equal(requestNumberIn('перенесите на 2026-09-19'), null, 'это дата');
    assert.equal(requestNumberIn('Не горит лампа в подъезде'), null);
  });

  it('пустое описание не принимается', () => {
    assert.throws(() => makeRequest({ description: '   ' }), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, 'description_required');
      return true;
    });
  });

  it('слишком длинное описание не принимается', () => {
    assert.throws(() => makeRequest({ description: 'а'.repeat(2001) }), /напишите короче/);
  });

  it('срочность категории применяется по умолчанию', () => {
    const elevator = makeRequest({ category: 'elevator', description: 'Лифт не едет' });

    assert.equal(elevator.priority, 'emergency');
  });
});

describe('сроки', () => {
  it('авария сжимает срок, плановая работа растягивает', () => {
    const normal = computeDeadlines('plumbing', 'normal', CREATED_AT);
    const emergency = computeDeadlines('plumbing', 'emergency', CREATED_AT);
    const planned = computeDeadlines('plumbing', 'planned', CREATED_AT);

    assert.ok(emergency.resolutionDueAt < normal.resolutionDueAt);
    assert.ok(planned.resolutionDueAt > normal.resolutionDueAt);
  });

  it('срок реакции считается от категории', () => {
    const { reactionDueAt } = computeDeadlines('elevator', 'normal', CREATED_AT);
    const expected = CREATED_AT.getTime() + CATEGORY_RULES.elevator.reactionMinutes * 60_000;

    assert.equal(reactionDueAt.getTime(), expected);
  });

  it('непринятая вовремя заявка считается просроченной', () => {
    const request = makeRequest();
    const late = new Date(request.reactionDueAt.getTime() + 60_000);

    assert.equal(isReactionOverdue(request, late), true);
    assert.equal(isOverdue(request, late), true);
  });

  it('ожидание ответа жильца в просрочку не засчитывается', () => {
    const request = applyTransition(
      applyTransition(makeRequest(), { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
      { to: 'needs_info', role: 'dispatcher', actorId: 'd1', at: CREATED_AT, comment: 'Уточните номер квартиры' },
    );

    const wayLater = new Date(request.resolutionDueAt.getTime() + 10 * 3600_000);

    assert.equal(isResolutionOverdue(request, wayLater), false, 'работа стоит не по вине управляющей компании');
  });

  it('закрытая заявка не может быть просрочена', () => {
    const done = applyTransition(
      applyTransition(
        applyTransition(makeRequest(), { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
        { to: 'in_progress', role: 'technician', actorId: 't1', at: CREATED_AT },
      ),
      { to: 'done', role: 'technician', actorId: 't1', at: CREATED_AT, comment: 'Заменил кран' },
    );

    assert.equal(isOverdue(done, new Date('2027-01-01T00:00:00Z')), false);
  });

  it('адрес читается человеком, если есть чем', () => {
    assert.equal(describeTarget({ kind: 'apartment', apartmentId: 'apt-3' }), 'квартира');
    assert.equal(describeTarget({ kind: 'apartment', apartmentId: 'apt-3', number: 12 }), 'квартира 12');

    assert.equal(
      describeTarget({ kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-1' }),
      'оборудование lift-1',
      'без справочника остаётся код',
    );
    assert.equal(
      describeTarget({ kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-1', title: 'Лифт, подъезд 1' }),
      'Лифт, подъезд 1',
    );
  });

  it('нарушенный норматив помнится и после закрытия заявки', () => {
    const request = makeRequest();
    const late = new Date(request.resolutionDueAt.getTime() + 3600_000);

    const closed = applyTransition(
      applyTransition(
        applyTransition(request, { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
        { to: 'in_progress', role: 'technician', actorId: 't1', at: CREATED_AT },
      ),
      { to: 'done', role: 'technician', actorId: 't1', at: late, comment: 'Заменил кран' },
    );

    assert.equal(isOverdue(closed, late), false);
    assert.equal(missedResolution(closed, late), true);
    assert.equal(missedDeadline(closed, late), true);
  });

  it('принятая с опозданием заявка нарушила срок реакции', () => {
    const request = makeRequest();
    const late = new Date(request.reactionDueAt.getTime() + 60_000);

    const accepted = applyTransition(request, { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: late });

    assert.equal(isReactionOverdue(accepted, late), false, 'заявка уже принята, сейчас не горит');
    assert.equal(missedReaction(accepted, late), true);
    assert.equal(reactedAt(accepted)?.getTime(), late.getTime());
  });

  it('повторная сдача работы считается по последнему разу', () => {
    const request = makeRequest();
    const inTime = new Date(request.resolutionDueAt.getTime() - 3600_000);
    const late = new Date(request.resolutionDueAt.getTime() + 3600_000);

    const reopened = applyTransition(
      applyTransition(
        applyTransition(
          applyTransition(request, { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
          { to: 'in_progress', role: 'technician', actorId: 't1', at: CREATED_AT },
        ),
        { to: 'done', role: 'technician', actorId: 't1', at: inTime, comment: 'Заменил кран' },
      ),
      { to: 'in_progress', role: 'resident', actorId: 'user-1', at: inTime, comment: 'Всё так же течёт' },
    );

    assert.equal(settledAt(reopened), undefined);

    const again = applyTransition(reopened, {
      to: 'done',
      role: 'technician',
      actorId: 't1',
      at: late,
      comment: 'Переделал',
    });

    assert.equal(settledAt(again)?.getTime(), late.getTime());
    assert.equal(missedResolution(again, late), true);
  });

  it('о подходящем сроке предупреждают до нарушения, а не после', () => {
    const request = makeRequest();
    const window = request.reactionDueAt.getTime() - CREATED_AT.getTime();
    const point = new Date(request.reactionDueAt.getTime() - window * WARNING_SHARE);

    assert.equal(warningCrossedIn(request, CREATED_AT, new Date(point.getTime() - 60_000)), null, 'ещё рано');
    assert.equal(warningCrossedIn(request, new Date(point.getTime() - 60_000), point), 'reaction');

    assert.equal(warningCrossedIn(request, point, new Date(point.getTime() + 60_000)), null);
  });

  it('принятая заявка горит сроком выполнения, а не реакции', () => {
    const accepted = applyTransition(makeRequest(), {
      to: 'accepted',
      role: 'dispatcher',
      actorId: 'd1',
      at: CREATED_AT,
    });

    const window = accepted.resolutionDueAt.getTime() - CREATED_AT.getTime();
    const point = new Date(accepted.resolutionDueAt.getTime() - window * WARNING_SHARE);

    assert.equal(warningCrossedIn(accepted, new Date(point.getTime() - 60_000), point), 'resolution');
  });

  it('ожидание ответа жильца сотрудника не будит', () => {
    const waiting = applyTransition(
      applyTransition(makeRequest(), { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
      { to: 'needs_info', role: 'dispatcher', actorId: 'd1', at: CREATED_AT, comment: 'Когда удобно?' },
    );

    const window = waiting.resolutionDueAt.getTime() - CREATED_AT.getTime();
    const point = new Date(waiting.resolutionDueAt.getTime() - window * WARNING_SHARE);

    assert.equal(warningCrossedIn(waiting, new Date(point.getTime() - 60_000), point), null);
  });

  it('закрытая заявка не притворяется самой срочной', () => {
    const now = new Date(CREATED_AT.getTime() + 30 * 24 * 3600_000);
    const open = makeRequest({ id: 'req-open', createdAt: now });

    const closed = applyTransition(
      applyTransition(makeRequest({ id: 'req-closed' }), {
        to: 'accepted',
        role: 'dispatcher',
        actorId: 'd1',
        at: CREATED_AT,
      }),
      { to: 'rejected', role: 'dispatcher', actorId: 'd1', at: CREATED_AT, comment: 'Не наше' },
    );

    const sorted = [closed, open].sort((left, right) => compareByUrgency(left, right, now));

    assert.equal(sorted[0]?.id, 'req-open');
  });

  it('очередь диспетчера ставит просроченное вперёд', () => {
    const now = new Date(CREATED_AT.getTime() + 60 * 60_000);
    const overdue = makeRequest({ id: 'req-late', category: 'plumbing' });
    const fresh = makeRequest({ id: 'req-fresh', category: 'cleaning', createdAt: now });

    const sorted = [fresh, overdue].sort((left, right) => compareByUrgency(left, right, now));

    assert.equal(sorted[0]?.id, 'req-late');
  });

  it('подтверждённая соседями авария идёт раньше частной жалобы', () => {
    const now = new Date(CREATED_AT.getTime() + 60 * 60_000);
    const single = makeRequest({ id: 'req-one', category: 'electricity', createdAt: now });

    const incident = ['res-2', 'res-3'].reduce(
      (request, resident) => joinRequest(request, resident, now),
      makeRequest({ id: 'req-many', category: 'plumbing', createdAt: now }),
    );

    assert.equal(isConfirmedIncident(incident), true);

    const sorted = [single, incident].sort((left, right) => compareByUrgency(left, right, now));

    assert.equal(sorted[0]?.id, 'req-many');
  });

  it('нарушенный срок всё равно важнее подтверждений', () => {
    const now = new Date(CREATED_AT.getTime() + 26 * 3600_000);
    const overdue = makeRequest({ id: 'req-late', category: 'plumbing' });

    const incident = ['res-2', 'res-3'].reduce(
      (request, resident) => joinRequest(request, resident, now),
      makeRequest({ id: 'req-many', category: 'plumbing', createdAt: now }),
    );

    const sorted = [incident, overdue].sort((left, right) => compareByUrgency(left, right, now));

    assert.equal(sorted[0]?.id, 'req-late');
  });

  it('сданная работа не возглавляет очередь смены', () => {
    const now = new Date(CREATED_AT.getTime() + 30 * 24 * 3600_000);
    const open = makeRequest({ id: 'req-open', createdAt: now });

    const done = ['accepted', 'in_progress', 'done'].reduce(
      (request, to) =>
        applyTransition(request, {
          to: to as never,
          role: 'dispatcher',
          actorId: 'd1',
          at: CREATED_AT,
          assigneeId: 'tech-1',
          comment: 'Заменил кран',
        }),
      makeRequest({ id: 'req-done' }),
    );

    const sorted = [done, open].sort((left, right) => compareByUrgency(left, right, now));

    assert.equal(sorted[0]?.id, 'req-open');
  });
});

describe('жизненный цикл заявки', () => {
  it('проходит обычный путь до выполнения', () => {
    let request = makeRequest();

    request = applyTransition(request, { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT });
    request = applyTransition(request, {
      to: 'in_progress',
      role: 'dispatcher',
      actorId: 'd1',
      at: CREATED_AT,
      assigneeId: 'tech-7',
    });
    request = applyTransition(request, {
      to: 'done',
      role: 'technician',
      actorId: 'tech-7',
      at: CREATED_AT,
      comment: 'Заменил кран',
    });

    assert.equal(request.status, 'done');
    assert.equal(request.assigneeId, 'tech-7');
    assert.equal(request.history.length, 4);
  });

  it('в работу заявка уходит с исполнителем, а мастер берёт её на себя', () => {
    const accepted = applyTransition(makeRequest(), {
      to: 'accepted',
      role: 'dispatcher',
      actorId: 'd1',
      at: CREATED_AT,
    });

    assert.throws(
      () => applyTransition(accepted, { to: 'in_progress', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'assignee_required');
        return true;
      },
    );

    const taken = applyTransition(accepted, {
      to: 'in_progress',
      role: 'technician',
      actorId: 'tech-7',
      at: CREATED_AT,
    });

    assert.equal(taken.assigneeId, 'tech-7', 'мастер записал наряд на себя');

    // Ответ жильца возвращает заявку в работу и исполнителя не требует.
    const asked = applyTransition(accepted, {
      to: 'needs_info',
      role: 'dispatcher',
      actorId: 'd1',
      at: CREATED_AT,
      comment: 'Когда вы дома?',
    });

    const answered = applyTransition(asked, {
      to: 'in_progress',
      role: 'resident',
      actorId: 'user-1',
      at: CREATED_AT,
      comment: 'После 18:00',
    });

    assert.equal(answered.assigneeId, undefined);
  });

  it('работа сдаётся с отметкой о сделанном', () => {
    const inProgress = applyTransition(
      applyTransition(makeRequest(), { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
      { to: 'in_progress', role: 'technician', actorId: 'tech-7', at: CREATED_AT },
    );

    assert.equal(findTransition('in_progress', 'done', 'technician')?.requiresComment, true);

    assert.throws(
      () => applyTransition(inProgress, { to: 'done', role: 'technician', actorId: 'tech-7', at: CREATED_AT }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'comment_required');
        assert.match(error.message, /что сделано/);
        return true;
      },
    );

    assert.throws(
      () =>
        applyTransition(inProgress, {
          to: 'done',
          role: 'technician',
          actorId: 'tech-7',
          at: CREATED_AT,
          comment: '   ',
        }),
      /что сделано/,
    );

    // Мастер сдаёт работу с телефона: длины от отметки не требуется.
    const done = applyTransition(inProgress, {
      to: 'done',
      role: 'technician',
      actorId: 'tech-7',
      at: CREATED_AT,
      comment: 'Заменил кран',
    });

    assert.equal(done.history.at(-1)?.comment, 'Заменил кран');
  });

  it('жилец не может принять свою заявку', () => {
    assert.throws(
      () => applyTransition(makeRequest(), { to: 'accepted', role: 'resident', actorId: 'user-1', at: CREATED_AT }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'role_not_allowed');
        return true;
      },
    );
  });

  it('отказ требует объяснения', () => {
    assert.throws(
      () => applyTransition(makeRequest(), { to: 'rejected', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'comment_required');
        return true;
      },
    );
  });

  it('невозможный переход отклоняется', () => {
    assert.throws(
      () => applyTransition(makeRequest(), { to: 'done', role: 'technician', actorId: 't1', at: CREATED_AT }),
      /нельзя перейти/,
    );
  });

  it('закрытую заявку больше не трогают', () => {
    const rejected = applyTransition(makeRequest(), {
      to: 'rejected',
      role: 'manager',
      actorId: 'm1',
      at: CREATED_AT,
      comment: 'Не относится к общему имуществу',
    });

    assert.throws(
      () => applyTransition(rejected, { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
      /уже закрыта/,
    );
  });

  it('событие назад во времени в историю не пишется', () => {
    const accepted = applyTransition(makeRequest(), {
      to: 'accepted',
      role: 'dispatcher',
      actorId: 'd1',
      at: new Date(CREATED_AT.getTime() + 3600_000),
    });

    assert.throws(
      () =>
        applyTransition(accepted, {
          to: 'in_progress',
          role: 'technician',
          actorId: 't1',
          at: CREATED_AT,
        }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'request_stale');

        return true;
      },
      'иначе время выполнения в отчёте уходит в минус',
    );
  });

  it('жилец сам возвращает заявку в работу, ответив на уточнение', () => {
    let request = applyTransition(makeRequest(), { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT });
    request = applyTransition(request, {
      to: 'needs_info',
      role: 'dispatcher',
      actorId: 'd1',
      at: CREATED_AT,
      comment: 'Когда удобно прийти?',
    });

    const answered = applyTransition(request, {
      to: 'in_progress',
      role: 'resident',
      actorId: 'user-1',
      at: CREATED_AT,
      comment: 'После 18:00',
    });

    assert.equal(answered.status, 'in_progress');
  });

  it('исходная заявка не меняется', () => {
    const request = makeRequest();
    applyTransition(request, { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT });

    assert.equal(request.status, 'new', 'история переходов не портится на месте');
    assert.equal(request.history.length, 1);
  });

  it('подсказывает доступные действия по роли', () => {
    assert.deepEqual(allowedTransitions('new', 'dispatcher'), ['accepted', 'rejected']);
    assert.deepEqual(allowedTransitions('new', 'resident'), ['withdrawn']);
    // Управляющий закрывает сданную работу за жильца, объяснив, откуда знает.
    assert.deepEqual(allowedTransitions('done', 'manager'), ['confirmed', 'in_progress']);
  });

  it('снимок результата остаётся при том переходе, к которому приложен', () => {
    let request = applyTransition(makeRequest(), {
      to: 'accepted',
      role: 'dispatcher',
      actorId: 'd1',
      at: CREATED_AT,
    });

    request = applyTransition(request, { to: 'in_progress', role: 'technician', actorId: 't1', at: CREATED_AT });
    request = applyTransition(request, {
      to: 'done',
      role: 'technician',
      actorId: 't1',
      at: CREATED_AT,
      comment: 'Заменил кран',
      attachments: [{ kind: 'photo', token: 'file:after' }],
    });

    assert.deepEqual(request.history.at(-1)?.attachments, [{ kind: 'photo', token: 'file:after' }]);
    assert.equal(request.history[0]?.attachments, undefined);
    assert.deepEqual(request.attachments, []);
  });

  it('жилец оценивает работу вместе с приёмкой', () => {
    let request = applyTransition(makeRequest(), {
      to: 'accepted',
      role: 'dispatcher',
      actorId: 'd1',
      at: CREATED_AT,
    });

    request = applyTransition(request, { to: 'in_progress', role: 'technician', actorId: 't1', at: CREATED_AT });
    request = applyTransition(request, {
      to: 'done',
      role: 'technician',
      actorId: 't1',
      at: CREATED_AT,
      comment: 'Заменил кран',
    });
    request = applyTransition(request, {
      to: 'confirmed',
      role: 'resident',
      actorId: 'user-1',
      at: CREATED_AT,
      rating: 5,
    });

    assert.equal(request.rating, 5);
  });

  it('оценка без приёмки не ставится', () => {
    assert.throws(
      () =>
        applyTransition(makeRequest(), {
          to: 'rejected',
          role: 'dispatcher',
          actorId: 'd1',
          at: CREATED_AT,
          comment: 'не наша зона',
          rating: 1,
        }),
      /вместе с приёмкой/,
    );
  });

  it('оценка вне шкалы отклоняется', () => {
    const done = applyTransition(
      applyTransition(
        applyTransition(makeRequest(), { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
        { to: 'in_progress', role: 'technician', actorId: 't1', at: CREATED_AT },
      ),
      { to: 'done', role: 'technician', actorId: 't1', at: CREATED_AT, comment: 'Заменил кран' },
    );

    for (const rating of [0, 6, 4.5]) {
      assert.throws(
        () => applyTransition(done, { to: 'confirmed', role: 'resident', actorId: 'u1', at: CREATED_AT, rating }),
        /целое число от 1 до 5/,
      );
    }
  });

  it('принять работу можно молча', () => {
    const done = applyTransition(
      applyTransition(
        applyTransition(makeRequest(), { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
        { to: 'in_progress', role: 'technician', actorId: 't1', at: CREATED_AT },
      ),
      { to: 'done', role: 'technician', actorId: 't1', at: CREATED_AT, comment: 'Заменил кран' },
    );

    const confirmed = applyTransition(done, {
      to: 'confirmed',
      role: 'resident',
      actorId: 'u1',
      at: CREATED_AT,
    });

    assert.equal(confirmed.rating, undefined);
  });

  it('пустой список вложений в истории не заводится', () => {
    const request = applyTransition(makeRequest(), {
      to: 'accepted',
      role: 'dispatcher',
      actorId: 'd1',
      at: CREATED_AT,
      attachments: [],
    });

    assert.equal('attachments' in (request.history.at(-1) ?? {}), false);
  });
});

describe('переписка по заявке', () => {
  const HOUR = 3600_000;

  it('сообщение состояния не меняет', () => {
    const accepted = applyTransition(makeRequest(), {
      to: 'accepted',
      role: 'dispatcher',
      actorId: 'd1',
      at: CREATED_AT,
    });

    const said = addMessage(accepted, {
      role: 'resident',
      actorId: 'u1',
      at: new Date(CREATED_AT.getTime() + HOUR),
      text: '  Когда приедете?  ',
    });

    assert.equal(said.status, 'accepted');
    assert.deepEqual(said.history.at(-1)?.kind, 'message');
    assert.equal(said.history.at(-1)?.comment, 'Когда приедете?');
  });

  it('пустое сообщение отвергается', () => {
    assert.throws(
      () => addMessage(makeRequest(), { role: 'resident', actorId: 'u1', at: CREATED_AT, text: '   ' }),
      DomainError,
    );
  });

  it('слишком длинное сообщение отвергается', () => {
    assert.throws(
      () =>
        addMessage(makeRequest(), {
          role: 'resident',
          actorId: 'u1',
          at: CREATED_AT,
          text: 'а'.repeat(MESSAGE_MAX_LENGTH + 1),
        }),
      DomainError,
    );
  });

  it('по закрытой заявке говорить поздно', () => {
    const rejected = applyTransition(makeRequest(), {
      to: 'rejected',
      role: 'dispatcher',
      actorId: 'd1',
      at: CREATED_AT,
      comment: 'Не наш дом',
    });

    assert.throws(
      () => addMessage(rejected, { role: 'resident', actorId: 'u1', at: CREATED_AT, text: 'Почему?' }),
      DomainError,
    );
  });

  it('разговор не выдаёт себя за смену состояния', () => {
    const done = applyTransition(
      applyTransition(
        applyTransition(makeRequest(), { to: 'accepted', role: 'dispatcher', actorId: 'd1', at: CREATED_AT }),
        { to: 'in_progress', role: 'technician', actorId: 't1', at: new Date(CREATED_AT.getTime() + HOUR) },
      ),
      {
        to: 'done',
        role: 'technician',
        actorId: 't1',
        at: new Date(CREATED_AT.getTime() + 2 * HOUR),
        comment: 'Заменил кран',
      },
    );

    const said = addMessage(done, {
      role: 'resident',
      actorId: 'u1',
      at: new Date(CREATED_AT.getTime() + 5 * HOUR),
      text: 'А подтёк остался',
    });

    assert.deepEqual(reportedDoneAt(said), new Date(CREATED_AT.getTime() + 2 * HOUR));
    assert.equal(statusChanges(said).length, done.history.length);
    assert.deepEqual(settledAt(said), new Date(CREATED_AT.getTime() + 2 * HOUR));
    assert.deepEqual(reactedAt(said), CREATED_AT);
  });
});

describe('адресация объявлений', () => {
  const apartments: Apartment[] = [
    { id: 'a1', buildingId: 'b1', number: 1, entrance: 1, riser: 1 },
    { id: 'a2', buildingId: 'b1', number: 2, entrance: 1, riser: 2 },
    { id: 'a3', buildingId: 'b1', number: 20, entrance: 2, riser: 1 },
    { id: 'a4', buildingId: 'b2', number: 5, entrance: 1, riser: 1 },
  ];

  it('стояк затрагивает только своих', () => {
    const selected = selectAudience(apartments, { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 1 });

    assert.deepEqual(selected.map((apartment) => apartment.id), ['a1']);
  });

  it('подъезд шире стояка, дом шире подъезда', () => {
    assert.equal(selectAudience(apartments, { kind: 'entrance', buildingId: 'b1', entrance: 1 }).length, 2);
    assert.equal(selectAudience(apartments, { kind: 'building', buildingId: 'b1' }).length, 3);
  });

  it('соседний дом не задет', () => {
    const selected = selectAudience(apartments, { kind: 'building', buildingId: 'b1' });

    assert.equal(selected.some((apartment) => apartment.buildingId === 'b2'), false);
  });

  it('заявка по стояку подсказывает, кого предупредить', () => {
    const audience = audienceForTarget({ kind: 'riser', buildingId: 'b1', entrance: 3, riser: 2 });

    assert.deepEqual(audience, { kind: 'riser', buildingId: 'b1', entrance: 3, riser: 2 });
    assert.equal(describeAudience(audience), 'подъезд 3, стояк 2');
  });

  it('заявка по квартире соседей не касается', () => {
    assert.equal(audienceForTarget({ kind: 'apartment', apartmentId: 'a1' }), null);
  });

  it('объект заявки описывается словами', () => {
    assert.equal(describeTarget({ kind: 'apartment', apartmentId: 'a1' }, 12), 'квартира 12');
    assert.equal(describeTarget({ kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-2' }), 'оборудование lift-2');
  });
});

describe('коды объектов для наклеек', () => {
  it('код объекта разбирается обратно без потерь', () => {
    const targets = [
      { kind: 'apartment', apartmentId: 'apt-3' },
      { kind: 'entrance', buildingId: 'b1', entrance: 2 },
      { kind: 'riser', buildingId: 'b1', entrance: 2, riser: 5 },
      { kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-2' },
      { kind: 'building', buildingId: 'b1' },
    ] as const;

    for (const target of targets) {
      assert.deepEqual(decodeTarget(encodeTarget(target)), target, `не сошлось для ${target.kind}`);
    }
  });

  it('ссылка для наклейки собирается по формату платформы', () => {
    const link = buildDeepLink('uk_bot', { kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-2' });

    assert.equal(link, 'https://max.ru/uk_bot?startapp=eqp_b1_lift-2');
  });

  it('нулевой номер подъезда разбирается так же, как остальные', () => {
    const ground = { kind: 'entrance', buildingId: 'b1', entrance: 0 } as const;

    assert.deepEqual(decodeTarget(encodeTarget(ground)), ground, 'наклейка напечатана, значит, читается');
  });

  it('чужой или испорченный код не разбирается', () => {
    assert.equal(decodeTarget('мусор'), null);
    assert.equal(decodeTarget('ent_b1'), null, 'нет номера подъезда');
    assert.equal(decodeTarget('ent_b1_ноль'), null);
    assert.equal(decodeTarget('rsr_b1_2'), null, 'нет номера стояка');
    assert.equal(decodeTarget('unknown_b1'), null);
    assert.equal(decodeTarget(''), null);
  });

  it('наклейка объекта доказывает, что мастер был у него', () => {
    const lift = { kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-2' } as const;

    assert.equal(provesPresence(lift, encodeTarget(lift)), true);
  });

  it('наклейка соседнего объекта доказательством не считается', () => {
    const lift = { kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-2' } as const;

    assert.equal(provesPresence(lift, 'eqp_b1_lift-1'), false);
    assert.equal(provesPresence(lift, 'ent_b1_1'), false, 'подъезд, не тот же объект, что лифт в нём');
    assert.equal(provesPresence(lift, 'мусор'), false);
  });

  it('один и тот же объект в разных домах, это разные объекты', () => {
    const pairs = [
      [
        { kind: 'entrance', buildingId: 'b1', entrance: 1 },
        { kind: 'entrance', buildingId: 'b2', entrance: 1 },
      ],
      [
        { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 },
        { kind: 'riser', buildingId: 'b2', entrance: 1, riser: 2 },
      ],
      [
        { kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-1' },
        { kind: 'equipment', buildingId: 'b2', equipmentId: 'lift-1' },
      ],
      [
        { kind: 'building', buildingId: 'b1' },
        { kind: 'building', buildingId: 'b2' },
      ],
    ] as const;

    for (const [left, right] of pairs) {
      assert.equal(isSameTarget(left, right), false, `${left.kind} сошёлся с чужим домом`);
      assert.equal(isSameTarget(left, left), true, `${left.kind} не сошёлся сам с собой`);
    }
  });

  it('квартира сверяется по своему коду, дом в нём уже есть', () => {
    assert.equal(
      isSameTarget({ kind: 'apartment', apartmentId: 'apt-3' }, { kind: 'apartment', apartmentId: 'apt-3' }),
      true,
    );
    assert.equal(
      isSameTarget({ kind: 'apartment', apartmentId: 'apt-3' }, { kind: 'apartment', apartmentId: 'apt-4' }),
      false,
    );
  });

  it('подъезд и дом целиком одним объектом не считаются', () => {
    assert.equal(
      isSameTarget({ kind: 'entrance', buildingId: 'b1', entrance: 1 }, { kind: 'building', buildingId: 'b1' }),
      false,
    );
    assert.equal(
      isSameTarget(
        { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 },
        { kind: 'entrance', buildingId: 'b1', entrance: 1 },
      ),
      false,
    );
  });

  it('идентификатор с подчёркиванием не кодируется', () => {
    assert.throws(
      () => encodeTarget({ kind: 'building', buildingId: 'дом_15' }),
      (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'invalid_identifier');
        return true;
      },
    );
  });
});

describe('подсказки по тексту', () => {
  it('узнаёт категорию по словам жильца', () => {
    assert.equal(suggestCategory('Не работает лифт в третьем подъезде'), 'elevator');
    assert.equal(suggestCategory('течёт кран на кухне'), 'plumbing');
    assert.equal(suggestCategory('Холодные батареи'), 'heating');
    assert.equal(suggestCategory('Нет света в подъезде'), 'electricity');
    assert.equal(suggestCategory('Не убирают мусор'), 'cleaning');
    assert.equal(suggestCategory('Сломана детская площадка'), 'yard');
  });

  it('незнакомый текст уходит в «другое»', () => {
    assert.equal(suggestCategory('Здравствуйте, есть вопрос'), 'other');
  });

  it('дым и газ, не «другое»: по ним выезжают, а не чинят', () => {
    assert.equal(suggestCategory('В подъезде пахнет дымом'), 'safety');
    assert.equal(suggestCategory('На лестнице запах газа'), 'safety');
    assert.ok(CATEGORY_RULES.safety.reactionMinutes < CATEGORY_RULES.other.reactionMinutes);
    assert.equal(CATEGORY_RULES.safety.defaultPriority, 'emergency');
  });

  it('чужое слово внутри ключевого категорию не меняет', () => {
    assert.equal(suggestCategory('Не работает домофон, трубка молчит'), 'other');
    assert.equal(suggestCategory('Прорвало трубу в подвале'), 'plumbing');
  });

  it('лестничная площадка, не двор', () => {
    assert.equal(suggestCategory('Не горит лампа на площадке между вторым и третьим этажом'), 'electricity');
    assert.equal(suggestCategory('Разбита лампа на детской площадке во дворе'), 'electricity');
    assert.equal(suggestCategory('Сломаны качели на детской площадке'), 'yard');
  });

  it('слова про аварию поднимают срочность', () => {
    assert.equal(suggestPriority('Прорыв трубы, заливает соседей', 'plumbing'), 'emergency');
    assert.equal(suggestPriority('В лифте застрял человек', 'elevator'), 'emergency');
    assert.equal(suggestPriority('Капает кран', 'plumbing'), 'normal');
  });
});
