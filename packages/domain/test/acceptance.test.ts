import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCEPTANCE_REMINDER_SHARE,
  AUTO_CONFIRM_AFTER_HOURS,
  acceptanceReminderCrossedIn,
  allowedTransitions,
  applyTransition,
  assessDeadlineRisk,
  assigneeLoad,
  buildComplaint,
  canEscalate,
  collectCategoryStats,
  createRequest,
  deadlineCrossedIn,
  findTransition,
  isAutoConfirmDue,
  isOverdue,
  type ServiceRequest,
} from '../dist/index.js';

const CREATED_AT = new Date('2026-09-03T10:00:00Z');
const HOUR = 3600_000;

const request = (overrides: Partial<Parameters<typeof createRequest>[0]> = {}): ServiceRequest =>
  createRequest({
    id: 'req-1',
    buildingId: 'b1',
    buildingCode: 'Д15',
    sequence: 1,
    authorId: 'res-1',
    category: 'plumbing',
    target: { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 },
    description: 'Нет горячей воды',
    createdAt: CREATED_AT,
    ...overrides,
  });

/** Принятая заявка: срок реакции соблюдён, дальше на кону только срок работ. */
const accepted = (value: ServiceRequest = request()): ServiceRequest =>
  applyTransition(value, { to: 'accepted', role: 'dispatcher', actorId: 'disp', at: CREATED_AT });

/** Проводит заявку до «выполнено»: приёмка начинается только оттуда. */
const untilDone = (value: ServiceRequest, doneAt = CREATED_AT): ServiceRequest =>
  applyTransition(
    applyTransition(
      applyTransition(value, { to: 'accepted', role: 'dispatcher', actorId: 'disp', at: CREATED_AT }),
      { to: 'in_progress', role: 'technician', actorId: 'tech', at: CREATED_AT },
    ),
    { to: 'done', role: 'technician', actorId: 'tech', at: doneAt, comment: 'Заменил смеситель' },
  );

describe('приёмка работы жильцом', () => {
  it('«выполнено», ещё не конец: закрывает заявку жилец', () => {
    const done = untilDone(request());

    assert.deepEqual(allowedTransitions('done', 'resident'), ['confirmed', 'in_progress']);
    // Жилец не всегда нажимает кнопку: он говорит о приёмке по телефону,
    // и смена закрывает заявку за него, объяснив, откуда знает.
    assert.deepEqual(allowedTransitions('done', 'dispatcher'), ['confirmed', 'in_progress']);
    assert.equal(findTransition('done', 'confirmed', 'dispatcher')?.requiresComment, true);
    assert.equal(findTransition('done', 'confirmed', 'resident')?.requiresComment, undefined);

    const confirmed = applyTransition(done, {
      to: 'confirmed',
      role: 'resident',
      actorId: 'res-1',
      at: CREATED_AT,
    });

    assert.equal(confirmed.status, 'confirmed');
    assert.throws(
      () => applyTransition(confirmed, { to: 'in_progress', role: 'resident', actorId: 'res-1', at: CREATED_AT }),
      /уже закрыта/,
    );
  });

  it('непринятая работа возвращается в работу и считается', () => {
    const done = untilDone(request());

    const reopened = applyTransition(done, {
      to: 'in_progress',
      role: 'resident',
      actorId: 'res-1',
      at: CREATED_AT,
      comment: 'Вода так и не появилась',
    });

    assert.equal(reopened.status, 'in_progress');
    assert.equal(reopened.reopenCount, 1);
    assert.equal(reopened.history.at(-1)?.comment, 'Вода так и не появилась');
  });

  it('возврат по звонку мастера в счётчик непринятых работ не идёт', () => {
    const returned = applyTransition(untilDone(request()), {
      to: 'in_progress',
      role: 'dispatcher',
      actorId: 'disp',
      at: CREATED_AT,
      comment: 'Мастер позвонил: задвижку надо менять целиком',
    });

    assert.equal(returned.status, 'in_progress');
    assert.equal(returned.reopenCount, 0, 'счётчик означает, что работу не принял жилец');
  });

  it('переоткрытие без объяснения не принимается', () => {
    assert.throws(
      () =>
        applyTransition(untilDone(request()), {
          to: 'in_progress',
          role: 'resident',
          actorId: 'res-1',
          at: CREATED_AT,
        }),
      /требует объяснения/,
    );
  });

  it('ожидание приёмки просрочкой не считается', () => {
    const done = untilDone(request());
    const later = new Date(CREATED_AT.getTime() + 100 * HOUR);

    assert.equal(isOverdue(done, later), false, 'работа сделана, ждём жильца');
  });

  it('молчание жильца трое суток закрывает заявку', () => {
    const done = untilDone(request());

    assert.equal(isAutoConfirmDue(done, new Date(CREATED_AT.getTime() + 71 * HOUR)), false);
    assert.equal(isAutoConfirmDue(done, new Date(CREATED_AT.getTime() + 73 * HOUR)), true);
    assert.equal(isAutoConfirmDue(request(), new Date(CREATED_AT.getTime() + 73 * HOUR)), false);
  });
});

describe('напоминание о приёмке', () => {
  const done = untilDone(request());
  const reminder = new Date(
    CREATED_AT.getTime() + AUTO_CONFIRM_AFTER_HOURS * ACCEPTANCE_REMINDER_SHARE * HOUR,
  );

  it('момент на стыке двух окон достаётся первому', () => {
    assert.equal(acceptanceReminderCrossedIn(done, new Date(reminder.getTime() - HOUR), reminder), true);
    assert.equal(
      acceptanceReminderCrossedIn(done, reminder, new Date(reminder.getTime() + HOUR)),
      false,
      'напоминание уже ушло, второй раз не надо',
    );
  });

  it('до середины срока и после закрытия напоминать нечего', () => {
    const early = new Date(CREATED_AT.getTime() + HOUR);

    assert.equal(acceptanceReminderCrossedIn(done, CREATED_AT, early), false);
    assert.equal(
      acceptanceReminderCrossedIn(request(), CREATED_AT, new Date(reminder.getTime() + HOUR)),
      false,
      'работа не сдана, приёмки не ждут',
    );
  });
});

describe('прогноз срыва срока', () => {
  const closed = (hours: number, id: string): ServiceRequest =>
    untilDone(request({ id }), new Date(CREATED_AT.getTime() + hours * HOUR));

  it('медиана считается по закрытым заявкам', () => {
    const stats = collectCategoryStats([closed(10, 'a'), closed(20, 'b'), closed(30, 'c')]);

    assert.equal(stats[0]?.category, 'plumbing');
    assert.equal(stats[0]?.medianResolutionMs, 20 * HOUR);
    assert.equal(stats[0]?.sampleSize, 3);
  });

  it('без истории прогноза не даём', () => {
    const assessment = assessDeadlineRisk(accepted(), [], new Date(CREATED_AT.getTime() + HOUR));

    assert.equal(assessment.risk, 'none');
    assert.match(assessment.reason, /мало данных/);
  });

  it('заявка, которая по опыту не успеет, помечается до наступления срока', () => {
    const stats = collectCategoryStats([closed(30, 'a'), closed(30, 'b'), closed(30, 'c')]);
    const now = new Date(CREATED_AT.getTime() + HOUR);
    const assessment = assessDeadlineRisk(accepted(), stats, now);

    assert.equal(isOverdue(accepted(), now), false, 'срок ещё не нарушен');
    assert.equal(assessment.risk, 'high');
    assert.match(assessment.reason, /не хватает ещё/);
  });

  it('уже просроченная не нуждается в прогнозе', () => {
    const assessment = assessDeadlineRisk(accepted(), [], new Date(CREATED_AT.getTime() + 100 * HOUR));

    assert.equal(assessment.risk, 'high');
    assert.equal(assessment.reason, 'срок уже нарушен');
  });

  it('пока ждём жильца, риск не считается', () => {
    const stats = collectCategoryStats([closed(30, 'a'), closed(30, 'b'), closed(30, 'c')]);

    const waiting = applyTransition(accepted(), {
      to: 'needs_info',
      role: 'dispatcher',
      actorId: 'disp',
      at: CREATED_AT,
      comment: 'Уточните, пожалуйста, номер квартиры',
    });

    const assessment = assessDeadlineRisk(waiting, stats, new Date(CREATED_AT.getTime() + 100 * HOUR));

    assert.equal(assessment.risk, 'none');
    assert.equal(assessment.reason, 'ждёт ответа жильца');
  });

  it('выполненную заявку прогноз не трогает', () => {
    const stats = collectCategoryStats([closed(30, 'a'), closed(30, 'b'), closed(30, 'c')]);
    const assessment = assessDeadlineRisk(untilDone(request()), stats, new Date(CREATED_AT.getTime() + 100 * HOUR));

    assert.equal(assessment.risk, 'none');
    assert.equal(assessment.reason, 'работа завершена');
  });

  it('заявка с тающим запасом помечается отдельно от горящей', () => {
    const stats = collectCategoryStats([closed(20, 'a'), closed(20, 'b'), closed(20, 'c')]);
    const assessment = assessDeadlineRisk(accepted(), stats, new Date(CREATED_AT.getTime() + HOUR));

    assert.equal(assessment.risk, 'watch');
    assert.equal(assessment.reason, 'запаса почти не осталось');
  });

  it('быстрая категория идёт с запасом', () => {
    const stats = collectCategoryStats([closed(2, 'a'), closed(2, 'b'), closed(2, 'c')]);
    const assessment = assessDeadlineRisk(accepted(), stats, new Date(CREATED_AT.getTime() + HOUR));

    assert.equal(assessment.risk, 'none');
    assert.equal(assessment.reason, 'идёт с запасом');
  });

  it('медиана из чётного числа заявок, среднее середины', () => {
    const stats = collectCategoryStats([closed(10, 'a'), closed(20, 'b'), closed(30, 'c'), closed(40, 'd')]);

    assert.equal(stats[0]?.medianResolutionMs, 25 * HOUR);
    assert.equal(stats[0]?.sampleSize, 4);
  });

  it('загрузка мастера считается по незакрытым заявкам', () => {
    const inProgress = applyTransition(
      applyTransition(request(), { to: 'accepted', role: 'dispatcher', actorId: 'disp', at: CREATED_AT }),
      { to: 'in_progress', role: 'technician', actorId: 'tech', at: CREATED_AT, assigneeId: 'tech-1' },
    );

    const load = assigneeLoad([inProgress, untilDone(request({ id: 'other' }))]);

    assert.equal(load.get('tech-1'), 1, 'выполненная на мастере не висит');
  });
});

describe('пересечение срока как событие', () => {
  const REACTION_DUE = new Date(CREATED_AT.getTime() + 30 * 60_000);

  it('срок реакции попадает ровно в своё окно', () => {
    const fresh = request();

    assert.equal(deadlineCrossedIn(fresh, CREATED_AT, new Date(REACTION_DUE.getTime() - 1)), null);
    assert.equal(deadlineCrossedIn(fresh, CREATED_AT, REACTION_DUE), 'reaction');
    assert.equal(
      deadlineCrossedIn(fresh, REACTION_DUE, new Date(REACTION_DUE.getTime() + HOUR)),
      null,
      'в следующем окне того же события уже нет',
    );
  });

  it('принятая заявка о сроке реакции не сообщает', () => {
    assert.equal(deadlineCrossedIn(accepted(), CREATED_AT, new Date(CREATED_AT.getTime() + HOUR)), null);
  });

  it('срок работ считается для принятой заявки', () => {
    const due = new Date(CREATED_AT.getTime() + 24 * HOUR);

    assert.equal(deadlineCrossedIn(accepted(), CREATED_AT, due), 'resolution');
  });

  it('пока ждём жильца или работа сдана, о сроке не напоминаем', () => {
    const waiting = applyTransition(accepted(), {
      to: 'needs_info',
      role: 'dispatcher',
      actorId: 'disp',
      at: CREATED_AT,
      comment: 'Уточните номер квартиры',
    });

    const far = new Date(CREATED_AT.getTime() + 100 * HOUR);

    assert.equal(deadlineCrossedIn(waiting, CREATED_AT, far), null);
    assert.equal(deadlineCrossedIn(untilDone(request()), CREATED_AT, far), null);
  });
});

describe('эскалация в жилинспекцию', () => {
  it('пока сроки соблюдаются, оснований нет', () => {
    const check = canEscalate(accepted(), new Date(CREATED_AT.getTime() + HOUR));

    assert.equal(check.possible, false);
    assert.equal(check.reason, 'сроки соблюдаются');
  });

  it('непринятая заявка, основание сразу', () => {
    const check = canEscalate(request(), new Date(CREATED_AT.getTime() + 2 * HOUR));

    assert.equal(check.possible, true);
    assert.match(check.reason, /срок реакции нарушен/);
  });

  it('часовое опоздание по работам поводом не считается', () => {
    const check = canEscalate(accepted(), new Date(CREATED_AT.getTime() + 25 * HOUR));

    assert.equal(check.possible, false);
    assert.match(check.reason, /в пределах разумного/);
  });

  it('двукратное превышение норматива, уже повод', () => {
    const check = canEscalate(accepted(), new Date(CREATED_AT.getTime() + 50 * HOUR));

    assert.equal(check.possible, true);
    assert.match(check.reason, /при назначенном сроке 24 ч/);
  });

  it('обращение собирается из истории заявки', () => {
    const text = buildComplaint({
      request: accepted(),
      address: 'ул. Ленина, 15',
      residentName: 'Мария Иванова',
      managementCompany: 'ООО «УК Ленинская»',
      now: new Date(CREATED_AT.getTime() + 50 * HOUR),
      actorName: (id) => (id === 'disp' ? 'диспетчер' : 'заявитель'),
    });

    assert.match(text, /Государственную жилищную инспекцию/);
    assert.match(text, /Д15-2609-0001/);
    assert.match(text, /ул\. Ленина, 15/);
    assert.match(text, /ООО «УК Ленинская»/);
    assert.match(text, /зарегистрирована \(заявитель\)/);
    assert.match(text, /принята в работу \(диспетчер\)/);
    assert.match(text, /при назначенном сроке 24 ч/);
  });

  it('закрытая заявка поводом не является', () => {
    const confirmed = applyTransition(untilDone(request()), {
      to: 'confirmed',
      role: 'resident',
      actorId: 'res-1',
      at: CREATED_AT,
    });

    assert.equal(canEscalate(confirmed, new Date(CREATED_AT.getTime() + 500 * HOUR)).possible, false);
  });
});
