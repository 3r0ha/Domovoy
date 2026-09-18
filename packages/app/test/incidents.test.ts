import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CATEGORY_RULES, describeTarget, reportersCount, spreadOf } from '@domovoy/domain';

import {
  asRequest,
  InMemoryRepository,
  JOIN_LOCK_PREFIX,
  answerAlert,
  assessQueue,
  canKnockUpstairs,
  knockUpstairs,
  closeAcceptedBySilence,
  createCollectingNotifier,
  describeFromAttachments,
  escalationFor,
  getRequestFor,
  listRequestsFor,
  objectPassport,
  publishAnnouncement,
  remindAboutAcceptance,
  remindAboutOverdue,
  remindAboutWorks,
  submitProblem,
  surveyOf,
  transitionRequest,
  unheardVoice,
  warnAboutDeadlines,
  type AppDeps,
  type Resident,
  type Transcriber,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const START = new Date('2026-09-03T10:00:00Z');
const HOUR = 3600_000;

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
  { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2 },
  { id: 'apt-3', buildingId: BUILDING_ID, number: 3, entrance: 1, riser: 1 },
  { id: 'apt-20', buildingId: BUILDING_ID, number: 20, entrance: 2, riser: 1 },
];

const resident = (id: string, apartmentId: string, maxUserId: number): Resident => ({
  id,
  maxUserId,
  displayName: `Житель ${id}`,
  role: 'resident',
  apartmentId,
  buildingId: BUILDING_ID,
});

const maria = resident('res-maria', 'apt-1', 1001);
const pavel = resident('res-pavel', 'apt-3', 1003);
const sonya = resident('res-sonya', 'apt-2', 1002);
const alien = resident('res-alien', 'apt-20', 1020);

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга, диспетчер',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const technician: Resident = {
  id: 'tech-1',
  maxUserId: 6006,
  displayName: 'Сергей, мастер',
  role: 'technician',
  buildingId: BUILDING_ID,
};

const manager: Resident = {
  id: 'man-1',
  maxUserId: 7007,
  displayName: 'Ирина, управляющая',
  role: 'manager',
  buildingId: 'b-other',
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier>; advance: (ms: number) => void };

const setup = (staff: Resident[] = [dispatcher, technician]): Deps => {
  let counter = 0;
  let clock = START.getTime();
  const notifier = createCollectingNotifier();

  return {
    repository: new InMemoryRepository({
      buildings: [
        { id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', managementCompany: 'ООО «УК Ленинская»' },
      ],
      apartments: APARTMENTS,
      residents: [maria, pavel, sonya, alien, ...staff],
    }),
    now: () => new Date(clock),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier,
    advance: (ms: number) => {
      clock += ms;
    },
  };
};

describe('склейка обращений', () => {
  it('сосед по стояку подтверждает аварию, а не заводит вторую заявку', async () => {
    const deps = setup();

    const first = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    deps.advance(HOUR);
    const second = asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды со вчера' }));

    assert.equal(first.kind, 'created');
    assert.equal(second.kind, 'joined');
    assert.equal(second.request.id, first.request.id);
    assert.equal(second.reporters, 2);
    assert.equal((await deps.repository.listRequests({})).length, 1, 'в очереди одна заявка, а не две');
  });

  it('обращения одного дома проходят по очереди, а не одновременно', async () => {
    const deps = setup();

    const [first, second] = await Promise.all([
      submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }),
      submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }),
    ]);

    assert.deepEqual([first?.kind, second?.kind].sort(), ['created', 'joined']);
    assert.equal((await deps.repository.listRequests({})).length, 1);
  });

  it('между репликами очередь держит блокировка', async () => {
    const taken: string[] = [];
    let held = 0;

    const deps: Deps = {
      ...setup(),
      lock: async (key, run) => {
        taken.push(key);
        held += 1;

        assert.equal(held, 1, 'в критическую секцию зашли вдвоём');

        try {
          return await run();
        } finally {
          held -= 1;
        }
      },
    };

    await Promise.all([
      submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }),
      submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }),
    ]);

    assert.deepEqual(taken, [`${JOIN_LOCK_PREFIX}${BUILDING_ID}`, `${JOIN_LOCK_PREFIX}${BUILDING_ID}`]);
  });

  it('второе обращение поднимает заявку с квартиры на стояк', async () => {
    const deps = setup();

    const first = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    assert.deepEqual(first.request.target, { kind: 'apartment', apartmentId: 'apt-1', number: 1 });

    const second = asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));

    assert.deepEqual(second.request.target, {
      kind: 'riser',
      buildingId: BUILDING_ID,
      entrance: 1,
      riser: 1,
    });
  });

  it('сосед с другого стояка заводит свою заявку', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    const other = asRequest(await submitProblem(deps, { resident: sonya, description: 'Нет горячей воды' }));

    assert.equal(other.kind, 'created');
    assert.equal((await deps.repository.listRequests({})).length, 2);
  });

  it('квартирная категория не склеивается даже у соседей по стояку', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Не убрана площадка' }));
    const second = asRequest(await submitProblem(deps, { resident: pavel, description: 'Не убрана площадка' }));

    assert.equal(second.kind, 'created');
  });

  it('присоединившийся видит заявку в своём списке и получает уведомления', async () => {
    const deps = setup();

    const first = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));

    const mine = await listRequestsFor(deps, pavel, 'mine');
    assert.deepEqual(mine.map((request) => request.id), [first.request.id]);

    await assert.doesNotReject(getRequestFor(deps, pavel, first.request.id));

    deps.notifier.sent.length = 0;
    await transitionRequest(deps, { resident: dispatcher, requestId: first.request.id, to: 'accepted' });

    assert.deepEqual(
      deps.notifier.sent.map((item) => item.maxUserId).sort(),
      [maria.maxUserId, pavel.maxUserId].sort(),
    );
  });

  it('соседей предупреждают, как только аварию приняли в работу', async () => {
    const deps = setup();

    const created = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Нет горячей воды',
      startParam: 'rsr_b1_1_1',
    }));

    deps.notifier.sent.length = 0;
    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });

    const warned = deps.notifier.sent.filter((item) => /Авария: /.test(item.text));

    assert.deepEqual(
      warned.map((item) => item.maxUserId),
      [pavel.maxUserId],
    );
    assert.match(warned[0]?.text ?? '', /срок до/i);
    assert.match(warned[0]?.text ?? '', /Об изменениях напишу сам/);
    assert.equal(warned[0]?.askAbout, created.request.id);
  });

  it('обращение одной квартиры спрашивает стояк, а не объявляет ему аварию', async () => {
    const deps = setup();

    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    deps.notifier.sent.length = 0;
    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });

    const asked = deps.notifier.sent.filter((item) => item.askAbout === created.request.id);

    assert.deepEqual(
      asked.map((item) => item.maxUserId),
      [pavel.maxUserId],
    );
    assert.match(asked[0]?.text ?? '', /Сосед по стояку сообщает/);
    assert.doesNotMatch(asked[0]?.text ?? '', /Авария: /);
  });

  it('карта опроса показывает квартиры стояка, а не только ответивших', async () => {
    const deps = setup();

    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    await answerAlert(deps, { resident: pavel, requestId: created.request.id, affected: false });

    const survey = await surveyOf(deps, (await deps.repository.findRequest(created.request.id))!);

    assert.deepEqual(survey, [
      { number: 1, state: 'affected' },
      { number: 3, state: 'fine' },
    ]);
  });

  it('ответ соседа «у меня тоже» делает его участником заявки', async () => {
    const deps = setup();

    const created = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Нет горячей воды',
      startParam: 'rsr_b1_1_1',
    }));

    const { request: answered } = await answerAlert(deps, {
      resident: pavel,
      requestId: created.request.id,
      affected: true,
    });

    assert.equal(reportersCount(answered), 2);
    assert.equal(spreadOf(answered).verdict, 'shared', 'у соседа то же самое, причина общая');

    deps.notifier.sent.length = 0;
    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });

    assert.ok(
      deps.notifier.sent.some((item) => item.maxUserId === pavel.maxUserId),
      'подтвердивший сосед должен узнавать о ходе работы',
    );
  });

  it('ответ «у меня работает» сужает аварию до квартиры', async () => {
    const deps = setup();

    const created = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Нет горячей воды',
      startParam: 'ent_b1_1',
    }));

    await answerAlert(deps, { resident: pavel, requestId: created.request.id, affected: false });
    const { request: narrowed } = await answerAlert(deps, {
      resident: sonya,
      requestId: created.request.id,
      affected: false,
    });

    assert.deepEqual(spreadOf(narrowed), { affected: 1, fine: 2, verdict: 'local' });
    assert.equal(reportersCount(narrowed), 1);
  });

  it('по закрытой заявке опрос уже ничего не значит', async () => {
    const deps = setup();

    const created = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Нет горячей воды',
      startParam: 'rsr_b1_1_1',
    }));

    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.request.id,
      to: 'rejected',
      comment: 'Не наш дом',
    });

    await assert.rejects(
      answerAlert(deps, { resident: pavel, requestId: created.request.id, affected: true }),
      /закрыта/,
    );
  });

  it('автора и подтвердивших повторно не предупреждают', async () => {
    const deps = setup();

    const created = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Нет горячей воды',
      startParam: 'rsr_b1_1_1',
    }));
    asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));

    deps.notifier.sent.length = 0;
    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });

    assert.equal(deps.notifier.sent.some((item) => /Авария: /.test(item.text)), false);
  });

  it('заявка по квартире соседей не беспокоит', async () => {
    const deps = setup();

    const created = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Не убрана площадка',
      apartmentId: 'apt-1',
    }));

    deps.notifier.sent.length = 0;
    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });

    assert.equal(deps.notifier.sent.some((item) => /Авария: /.test(item.text)), false);
  });

  it('предупреждение уходит один раз, а не на каждый переход', async () => {
    const deps = setup();

    const created = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Нет горячей воды',
      startParam: 'rsr_b1_1_1',
    }));

    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });
    deps.notifier.sent.length = 0;

    for (const to of ['in_progress', 'done'] as const) {
      await transitionRequest(deps, {
        resident: technician,
        requestId: created.request.id,
        to,
        ...(to === 'done' ? { comment: 'Пустили воду' } : {}),
      });
    }

    assert.equal(deps.notifier.sent.some((item) => /Авария: /.test(item.text)), false);
  });

  it('сотрудники узнают о новой заявке', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Застряли в лифте', startParam: 'eqp_b1_lift-1' }));

    const toStaff = deps.notifier.sent.filter((item) => /Новая заявка/.test(item.text));

    assert.deepEqual(
      toStaff.map((item) => item.maxUserId),
      [dispatcher.maxUserId],
      'новую заявку принимает диспетчер, мастеру приходит назначение',
    );
    assert.match(toStaff[0]?.text ?? '', /^АВАРИЯ\. /, 'срочность видна в первом слове');
  });

  it('диспетчер получает кнопки прямо в уведомлении о новой заявке', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Течёт кран', apartmentId: 'apt-1' }));

    const toDispatcher = deps.notifier.sent.find((item) => item.maxUserId === dispatcher.maxUserId);
    const toTechnician = deps.notifier.sent.find((item) => item.maxUserId === technician.maxUserId);

    assert.deepEqual(
      toDispatcher?.actions?.map((action) => action.to),
      ['accepted', 'rejected'],
    );

    assert.equal(toTechnician?.actions, undefined);
  });

  it('принять работу предлагают жильцу, а не тому, кто её выполнял', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Течёт кран', apartmentId: 'apt-1' }));
    const id = created.request.id;

    await transitionRequest(deps, { resident: dispatcher, requestId: id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: id,
      to: 'in_progress',
      assigneeId: technician.id,
    });

    deps.notifier.sent.length = 0;
    await transitionRequest(deps, { resident: technician, requestId: id, to: 'done', comment: 'Заменил кран' });

    const toAuthor = deps.notifier.sent.find((item) => item.maxUserId === maria.maxUserId);

    assert.deepEqual(
      toAuthor?.actions?.map((action) => ({ to: action.to, ask: action.requiresComment })),
      [
        { to: 'confirmed', ask: false },
        { to: 'in_progress', ask: true },
      ],
      'возврат работы требует объяснения, приёмка, нет',
    );
  });

  it('каждое подтверждение сотрудникам не пересылается', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    deps.notifier.sent.length = 0;

    asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));

    assert.equal(deps.notifier.sent.some((item) => /Новая заявка/.test(item.text)), false);
  });

  it('о подтверждённой аварии сотрудникам сообщают отдельно', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды', startParam: 'rsr_b1_1_1' }));
    asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));
    deps.notifier.sent.length = 0;

    asRequest(await submitProblem(deps, { resident: sonya, description: 'Нет горячей воды', startParam: 'rsr_b1_1_1' }));

    const toStaff = deps.notifier.sent.filter((item) => /Новая заявка/.test(item.text));

    assert.equal(toStaff.length, 1, 'принять заявку может диспетчер');
    assert.match(toStaff[0]?.text ?? '', /Сообщили: 3/);
  });

  it('одновременные обращения не создают две заявки', async () => {
    const deps = setup();

    const [first, second] = await Promise.all([
      submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }),
      submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }),
    ]);

    assert.equal((await deps.repository.listRequests({})).length, 1);
    assert.deepEqual([first.kind, second.kind].sort(), ['created', 'joined']);
  });

  it('ошибка одного обращения не блокирует следующие', async () => {
    const deps = setup();

    await assert.rejects(
      submitProblem(deps, {
        resident: { ...maria, apartmentId: undefined, buildingId: undefined },
        description: 'Что-то сломалось',
      }),
    );

    const after = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    assert.equal(after.kind, 'created');
  });

  it('чужая заявка по-прежнему не видна', async () => {
    const deps = setup();

    const first = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    await assert.rejects(getRequestFor(deps, alien, first.request.id), /не ваша/);
  });
});

describe('заявка по телефонному звонку', () => {
  it('диспетчер заводит её от квартиры, и жилец видит её у себя', async () => {
    const deps = setup();

    deps.notifier.sent.length = 0;

    const result = asRequest(await submitProblem(deps, {
      resident: dispatcher,
      description: 'Течёт кран на кухне, звонили из квартиры',
      apartmentId: 'apt-2',
    }));

    if (result.kind !== 'created') throw new Error('заявка не завелась');

    assert.equal(result.request.target.kind === 'apartment' && result.request.target.apartmentId, 'apt-2');

    const mine = await listRequestsFor(deps, sonya, 'mine');

    assert.deepEqual(
      mine.map((request) => request.number),
      [result.request.number],
      'жилец этой квартиры видит заявку у себя',
    );

    assert.match(
      deps.notifier.sent.find((message) => message.maxUserId === sonya.maxUserId)?.text ?? '',
      /заявку по вашей квартире/,
    );

    assert.deepEqual(await listRequestsFor(deps, maria, 'mine'), [], 'соседям чужая квартира не показывается');
  });

  it('жилец чужую квартиру в заявке не назовёт', async () => {
    const deps = setup();

    await assert.rejects(
      submitProblem(deps, { resident: maria, description: 'У соседа течёт', apartmentId: 'apt-2' }),
      /управляющая компания этого дома/,
    );
  });
});

describe('домовой стучится к соседу сверху', () => {
  /** Залив в квартире: адрес заявки, сама квартира, а не стояк. */
  const flooded = async (deps: Deps) =>
    asRequest(
      await submitProblem(deps, { resident: maria, description: 'Течёт с потолка в ванной', startParam: 'apt_apt-1' }),
    );

  it('вопрос уходит одному соседу сверху и не называет ни имени, ни квартиры', async () => {
    const deps = setup();
    const created = await flooded(deps);

    assert.equal(await canKnockUpstairs(deps, created.request), true);

    deps.notifier.sent.length = 0;
    const knocked = await knockUpstairs(deps, { resident: maria, requestId: created.request.id });

    assert.deepEqual(
      deps.notifier.sent.map((message) => message.maxUserId),
      [pavel.maxUserId],
      'по стояку выше, квартира 3, соседний стояк это не касается',
    );
    assert.match(deps.notifier.sent[0]?.text ?? '', /Домовой стучится/);
    assert.doesNotMatch(deps.notifier.sent[0]?.text ?? '', /Житель|квартир/i);
    assert.equal(deps.notifier.sent[0]?.askAbout, created.request.id);
    assert.notEqual(knocked.knockedAt, undefined);
  });

  it('стучат один раз', async () => {
    const deps = setup();
    const created = await flooded(deps);

    await knockUpstairs(deps, { resident: maria, requestId: created.request.id });

    assert.equal(await canKnockUpstairs(deps, (await deps.repository.findRequest(created.request.id))!), false);
    await assert.rejects(
      knockUpstairs(deps, { resident: maria, requestId: created.request.id }),
      /уже постучали/,
    );
  });

  it('сосед сверху отвечает и становится участником заявки', async () => {
    const deps = setup();
    const created = await flooded(deps);

    await knockUpstairs(deps, { resident: maria, requestId: created.request.id });

    const { request: answered } = await answerAlert(deps, {
      resident: pavel,
      requestId: created.request.id,
      affected: true,
    });

    assert.equal(reportersCount(answered), 2);
  });

  it('ответить сверху можно и там, где стояк ни при чём', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, {
      resident: maria,
      category: 'cleaning',
      description: 'Мусор на площадке у двери',
      startParam: 'apt_apt-1',
    }));

    await assert.rejects(
      answerAlert(deps, { resident: pavel, requestId: created.request.id, affected: true }),
      /вас не спрашивали/,
    );

    await knockUpstairs(deps, { resident: maria, requestId: created.request.id });

    const { counted } = await answerAlert(deps, {
      resident: pavel,
      requestId: created.request.id,
      affected: true,
    });

    assert.equal(counted, true, 'спросили лично, значит и ответ принимают');
  });

  it('над верхней квартирой стучать некому', async () => {
    const deps = setup();
    const top = asRequest(await submitProblem(deps, {
      resident: pavel,
      description: 'Течёт с потолка в ванной',
      startParam: 'apt_apt-3',
    }));

    assert.equal(await canKnockUpstairs(deps, top.request), false);
    await assert.rejects(
      knockUpstairs(deps, { resident: pavel, requestId: top.request.id }),
      /соседей нет/,
    );
  });

  it('стучит тот, у кого течёт, а не любой сосед', async () => {
    const deps = setup();
    const created = await flooded(deps);

    await assert.rejects(
      knockUpstairs(deps, { resident: sonya, requestId: created.request.id }),
      /кто подал заявку/,
    );

    await assert.doesNotReject(knockUpstairs(deps, { resident: dispatcher, requestId: created.request.id }));
  });
});

describe('паспорт объекта', () => {
  it('показывает историю и открытые заявки по объекту', async () => {
    const deps = setup();

    const first = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Застряли в лифте',
      startParam: 'eqp_b1_lift-1',
    }));

    await transitionRequest(deps, { resident: dispatcher, requestId: first.request.id, to: 'accepted' });

    const passport = await objectPassport(deps, 'eqp_b1_lift-1');

    assert.equal(passport?.target, 'оборудование lift-1');
    assert.equal(passport?.totalRequests, 1);
    assert.equal(passport?.open.length, 1, 'жилец видит, что о поломке уже сообщили');
    assert.equal(passport?.lastRepairAt, undefined);
  });

  it('после приёмки работы появляется дата последнего ремонта', async () => {
    const deps = setup();

    const created = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Застряли в лифте',
      startParam: 'eqp_b1_lift-1',
    }));

    for (const to of ['accepted', 'in_progress', 'done'] as const) {
      await transitionRequest(deps, {
        resident: to === 'done' ? technician : dispatcher,
        requestId: created.request.id,
        to,
        ...(to === 'in_progress' ? { assigneeId: technician.id } : {}),
        ...(to === 'done' ? { comment: 'Заменил кран' } : {}),
      });
    }

    deps.advance(HOUR);
    await transitionRequest(deps, { resident: maria, requestId: created.request.id, to: 'confirmed' });

    const passport = await objectPassport(deps, 'eqp_b1_lift-1');

    assert.equal(passport?.open.length, 0);
    assert.equal(passport?.lastRepairAt?.getTime(), START.getTime() + HOUR);
  });

  it('на чужой объект паспорта нет', async () => {
    const deps = setup();

    assert.equal(await objectPassport(deps, 'ерунда'), null);
  });

  it('история одного объекта не смешивается с историей соседнего', async () => {
    const deps = setup();

    const cases = [
      { startParam: 'eqp_b1_lift-1', description: 'Лифт не едет' },
      { startParam: 'eqp_b1_lift-2', description: 'Второй лифт скрипит' },
      { startParam: 'rsr_b1_1_1', description: 'Нет горячей воды' },
      { startParam: 'rsr_b1_1_2', description: 'Нет воды на соседнем стояке' },
      { startParam: 'ent_b1_1', description: 'Не горит лампа' },
      { startParam: 'ent_b1_2', description: 'Не закрывается дверь' },
      { startParam: 'bld_b1', description: 'Мусор во дворе' },
    ];

    for (const item of cases) {
      asRequest(await submitProblem(deps, { resident: maria, description: item.description, startParam: item.startParam }));
      deps.advance(60_000);
    }

    for (const item of cases) {
      const passport = await objectPassport(deps, item.startParam);

      assert.equal(passport?.totalRequests, 1, `лишние заявки в паспорте «${item.startParam}»`);
      assert.equal(passport?.open[0]?.description, item.description);
    }
  });

  it('паспорт квартиры показывает только её заявки', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Течёт кран', apartmentId: 'apt-1' }));
    asRequest(await submitProblem(deps, { resident: sonya, description: 'Течёт кран', apartmentId: 'apt-2' }));

    const passport = await objectPassport(deps, 'apt_apt-1');

    assert.equal(passport?.totalRequests, 1);
    assert.equal(passport?.target, 'квартира 1');
  });
});

describe('приёмка и автозакрытие', () => {
  const untilDone = async (deps: Deps): Promise<string> => {
    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    for (const to of ['accepted', 'in_progress', 'done'] as const) {
      await transitionRequest(deps, {
        resident: to === 'done' ? technician : dispatcher,
        requestId: created.request.id,
        to,
        ...(to === 'in_progress' ? { assigneeId: technician.id } : {}),
        ...(to === 'done' ? { comment: 'Заменил кран' } : {}),
      });
    }

    return created.request.id;
  };

  it('непринятая работа возвращается мастеру', async () => {
    const deps = setup();
    const id = await untilDone(deps);

    const reopened = await transitionRequest(deps, {
      resident: maria,
      requestId: id,
      to: 'in_progress',
      comment: 'Вода так и не появилась',
    });

    assert.equal(reopened.status, 'in_progress');
    assert.equal(reopened.reopenCount, 1);
  });

  it('через трое суток молчания заявка закрывается сама', async () => {
    const deps = setup();
    const id = await untilDone(deps);

    assert.deepEqual(await closeAcceptedBySilence(deps), []);

    deps.advance(73 * HOUR);
    const closed = await closeAcceptedBySilence(deps);

    assert.deepEqual(closed.map((request) => request.id), [id]);
    assert.equal(closed[0]?.status, 'confirmed');
  });

  it('перед автозакрытием жильцу напоминают о приёмке', async () => {
    const deps = setup();
    await untilDone(deps);

    const since = deps.now();

    assert.deepEqual(await remindAboutAcceptance(deps, since), [], 'сразу после сдачи напоминать не о чем');

    deps.advance(37 * HOUR);
    deps.notifier.sent.length = 0;

    const reminded = await remindAboutAcceptance(deps, since);

    assert.equal(reminded.length, 1);

    const [message] = deps.notifier.sent;

    assert.equal(message?.maxUserId, maria.maxUserId);
    assert.match(message?.text ?? '', /работа отмечена выполненной/);
    assert.match(message?.text ?? '', /через 35 часов заявка закроется сама/);
    assert.deepEqual(
      message?.actions?.map((action) => action.to).sort(),
      ['confirmed', 'in_progress'],
    );
  });

  it('напоминание о приёмке уходит один раз', async () => {
    const deps = setup();
    await untilDone(deps);

    let since = deps.now();
    deps.advance(37 * HOUR);
    await remindAboutAcceptance(deps, since);

    since = deps.now();
    deps.advance(HOUR);

    assert.deepEqual(await remindAboutAcceptance(deps, since), []);
  });

  it('о закрытии молчанием сообщают всем, кто сообщал о проблеме', async () => {
    const deps = setup();
    const id = await untilDone(deps);

    asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));

    deps.advance(73 * HOUR);
    deps.notifier.sent.length = 0;

    await closeAcceptedBySilence(deps);

    const closing = deps.notifier.sent.filter((item) => /закрыта: за 72 часа возражений/.test(item.text));

    assert.deepEqual(
      closing.map((item) => item.maxUserId).sort(),
      [maria.maxUserId, pavel.maxUserId].sort(),
    );
    assert.match(closing[0]?.text ?? '', /создайте новую заявку/);
    assert.ok(id);
  });
});

describe('сообщение о нарушенном сроке', () => {
  it('уходит, как только срок реакции пройден', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    const since = deps.now();
    deps.advance(2 * HOUR);
    deps.notifier.sent.length = 0;

    const reminded = await remindAboutOverdue(deps, since);

    assert.deepEqual(reminded.map((item) => item.id), [created.request.id]);

    const toAuthor = deps.notifier.sent.filter((item) => item.maxUserId === maria.maxUserId);

    assert.match(toAuthor[0]?.text ?? '', /до сих пор не приняли в работу/);
    assert.equal(toAuthor[0]?.complaintFor, created.request.id, 'основание есть, предлагаем обращение кнопкой');
  });

  it('повторно об одном и том же не сообщает', async () => {
    const deps = setup();
    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    const since = deps.now();
    deps.advance(2 * HOUR);
    await remindAboutOverdue(deps, since);

    const checkedUntil = deps.now();
    deps.advance(2 * HOUR);
    deps.notifier.sent.length = 0;

    assert.deepEqual(await remindAboutOverdue(deps, checkedUntil), []);
    assert.deepEqual(deps.notifier.sent, []);
  });

  it('дом без закреплённой смены не остаётся без ответа', async () => {
    const deps = setup([manager]);
    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    const since = deps.now();
    deps.advance(2 * HOUR);
    deps.notifier.sent.length = 0;

    await remindAboutOverdue(deps, since);

    assert.equal(
      deps.notifier.sent.some((item) => item.maxUserId === manager.maxUserId),
      true,
      'управляющая узнала о сгоревшем сроке',
    );
  });

  it('пока срок соблюдается, никого не беспокоит', async () => {
    const deps = setup();
    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    const since = deps.now();
    deps.advance(60_000);

    assert.deepEqual(await remindAboutOverdue(deps, since), []);
  });

  it('получают все, кто сообщал об аварии', async () => {
    const deps = setup();
    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));

    const since = deps.now();
    deps.advance(2 * HOUR);
    deps.notifier.sent.length = 0;

    await remindAboutOverdue(deps, since);

    const residents = deps.notifier.sent.filter((item) => /Заявка /.test(item.text));

    assert.deepEqual(
      residents.map((item) => item.maxUserId).sort(),
      [maria.maxUserId, pavel.maxUserId].sort(),
    );
  });

  it('о подходящем сроке смену предупреждают заранее', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    deps.notifier.sent.length = 0;

    const since = deps.now();
    deps.advance(25 * 60_000);

    const warned = await warnAboutDeadlines(deps, since);

    assert.equal(warned.length, 1);
    assert.deepEqual(
      deps.notifier.sent.map((item) => item.maxUserId).sort(),
      [dispatcher.maxUserId, technician.maxUserId].sort(),
    );
    assert.match(deps.notifier.sent[0]?.text ?? '', /Срок горит/);
    assert.match(deps.notifier.sent[0]?.text ?? '', /Осталось \d+ мин/);
  });

  it('предупреждение уходит один раз, а не каждую проверку', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    let since = deps.now();
    deps.advance(25 * 60_000);
    await warnAboutDeadlines(deps, since);

    since = deps.now();
    deps.advance(60_000);

    assert.deepEqual(await warnAboutDeadlines(deps, since), []);
  });

  it('предупреждение получает назначенный исполнитель, а не вся смена', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.request.id,
      to: 'in_progress',
      assigneeId: technician.id,
    });

    deps.notifier.sent.length = 0;

    const since = deps.now();
    deps.advance(19 * HOUR);

    await warnAboutDeadlines(deps, since);

    assert.deepEqual(
      deps.notifier.sent.map((item) => item.maxUserId),
      [technician.maxUserId],
    );
  });

  it('о нарушенном сроке узнаёт и управляющая компания', async () => {
    const deps = setup();
    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    const since = deps.now();
    deps.advance(2 * HOUR);
    deps.notifier.sent.length = 0;

    await remindAboutOverdue(deps, since);

    const toStaff = deps.notifier.sent.filter((item) => /Норматив нарушен/.test(item.text));

    assert.deepEqual(
      toStaff.map((item) => item.maxUserId).sort(),
      [dispatcher.maxUserId, technician.maxUserId].sort(),
      'о нарушенном сроке знает вся смена',
    );
  });

  it('о нарушении сообщают назначенному исполнителю, а не всей смене', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.request.id,
      to: 'in_progress',
      assigneeId: technician.id,
    });

    const since = deps.now();
    deps.advance(25 * HOUR);
    deps.notifier.sent.length = 0;

    await remindAboutOverdue(deps, since);

    const toStaff = deps.notifier.sent.filter((item) => /Норматив нарушен/.test(item.text));

    assert.deepEqual(
      toStaff.map((item) => item.maxUserId),
      [technician.maxUserId],
    );
  });

  it('нарушенный срок работ без основания для жалобы обращение не предлагает', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });

    const since = deps.now();
    deps.advance(25 * HOUR);
    deps.notifier.sent.length = 0;

    await remindAboutOverdue(deps, since);

    const text = deps.notifier.sent[0]?.text ?? '';

    assert.match(text, /работы не выполнены в нормативный срок/);
    assert.match(text, /Сообщим об изменениях/);
    assert.equal(/жилищную инспекцию/.test(text), false);
  });

  it('заявку, ждущую ответа жильца, просроченной не объявляет', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    await transitionRequest(deps, { resident: dispatcher, requestId: created.request.id, to: 'accepted' });
    await transitionRequest(deps, {
      resident: dispatcher,
      requestId: created.request.id,
      to: 'needs_info',
      comment: 'Уточните номер квартиры',
    });

    const since = deps.now();
    deps.advance(100 * HOUR);

    assert.deepEqual(await remindAboutOverdue(deps, since), []);
  });
});

describe('прогноз в очереди', () => {
  it('считает риск по истории закрытых заявок', async () => {
    const deps = setup();

    for (const author of [maria, sonya, alien]) {
      const created = asRequest(await submitProblem(deps, { resident: author, description: 'Нет горячей воды' }));

      for (const to of ['accepted', 'in_progress'] as const) {
        await transitionRequest(deps, {
          resident: dispatcher,
          requestId: created.request.id,
          to,
          ...(to === 'in_progress' ? { assigneeId: technician.id } : {}),
        });
      }

      deps.advance(30 * HOUR);
      await transitionRequest(deps, {
        resident: technician,
        requestId: created.request.id,
        to: 'done',
        comment: 'Пустили воду',
      });
      await transitionRequest(deps, { resident: author, requestId: created.request.id, to: 'confirmed' });
      deps.advance(-30 * HOUR);
    }

    const fresh = asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));
    await transitionRequest(deps, { resident: dispatcher, requestId: fresh.request.id, to: 'accepted' });

    const [assessed] = await assessQueue(deps, [
      (await deps.repository.findRequest(fresh.request.id))!,
    ]);

    assert.equal(assessed?.assessment.risk, 'high');
    assert.match(assessed?.assessment.reason ?? '', /не хватает ещё/);
  });
});

describe('эскалация в жилинспекцию', () => {
  it('пока сроки соблюдаются, обращение не составляется', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    const offer = await escalationFor(deps, maria, created.request.id);

    assert.equal(offer.possible, false);
    assert.equal(offer.complaint, undefined);
  });

  it('непринятая вовремя заявка даёт готовый текст с именами участников', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    deps.advance(2 * HOUR);
    const offer = await escalationFor(deps, maria, created.request.id);

    assert.equal(offer.possible, true);
    assert.match(offer.complaint ?? '', /ул\. Ленина, 15/);
    assert.match(offer.complaint ?? '', /Житель res-maria/);
    assert.match(offer.complaint ?? '', /срок ответа нарушен/);

    assert.match(offer.complaint ?? '', /ООО «УК Ленинская»/);
  });

  it('без известной управляющей организации строка не выдумывается', async () => {
    const deps = setup();
    await deps.repository.saveBuilding({ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' });

    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    deps.advance(2 * HOUR);

    const offer = await escalationFor(deps, maria, created.request.id);

    assert.equal(offer.possible, true);
    assert.equal(/Управляющая организация/.test(offer.complaint ?? ''), false);
  });

  it('в шапке стоит адрес заявителя с номером квартиры', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    deps.advance(2 * HOUR);

    const offer = await escalationFor(deps, maria, created.request.id);

    assert.match(offer.complaint ?? '', /Адрес: ул\. Ленина, 15, кв\. 1/);
  });

  it('заявителю без привязанной квартиры номер не выдумывается', async () => {
    const deps = setup();
    const nomad: Resident = {
      id: 'res-nomad',
      maxUserId: 4004,
      displayName: 'Гость',
      role: 'resident',
      buildingId: BUILDING_ID,
    };

    await deps.repository.saveResident(nomad);

    const created = asRequest(await submitProblem(deps, {
      resident: nomad,
      description: 'Не работает лифт',
      startParam: 'eqp_b1_lift-1',
    }));

    deps.advance(2 * HOUR);

    const offer = await escalationFor(deps, nomad, created.request.id);

    assert.match(offer.complaint ?? '', /Адрес: ул\. Ленина, 15\n/);
  });

  it('подтвердивший сосед тоже может обратиться', async () => {
    const deps = setup();
    const created = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));

    deps.advance(2 * HOUR);

    await assert.doesNotReject(escalationFor(deps, pavel, created.request.id));
    await assert.rejects(escalationFor(deps, alien, created.request.id), /только заявитель/);
  });
});

describe('описание из вложений', () => {
  const transcriber: Transcriber = {
    transcribe: async () => 'у нас в подъезде не работает лифт',
  };

  it('голосовое превращается в описание заявки', async () => {
    const result = await describeFromAttachments(
      undefined,
      [{ kind: 'voice', token: 'voice-1' }],
      transcriber,
    );

    assert.equal(result.description, 'у нас в подъезде не работает лифт');
    assert.equal(result.attachments[0]?.transcript, 'у нас в подъезде не работает лифт');
  });

  it('текст жильца важнее расшифровки', async () => {
    const result = await describeFromAttachments('Не работает лифт', [{ kind: 'voice', token: 'v' }], transcriber);

    assert.equal(result.description, 'Не работает лифт');
  });

  it('без расшифровки заявка всё равно заводится', async () => {
    const failing: Transcriber = { transcribe: () => Promise.reject(new Error('сервис недоступен')) };

    const result = await describeFromAttachments(undefined, [{ kind: 'photo', token: 'p1' }], failing);

    assert.match(result.description, /с фотографией \(1 шт\.\)/);
  });

  it('без текста и без вложений описание всё равно осмысленное', async () => {
    const result = await describeFromAttachments(undefined, []);

    assert.equal(result.description, 'Обращение без описания');
    assert.deepEqual(result.attachments, []);
  });

  it('уже расшифрованное голосовое повторно не распознаётся', async () => {
    let calls = 0;
    const counting: Transcriber = {
      transcribe: async () => {
        calls += 1;
        return 'новая расшифровка';
      },
    };

    const result = await describeFromAttachments(
      undefined,
      [{ kind: 'voice', token: 'v', transcript: 'уже расшифровано' }],
      counting,
    );

    assert.equal(calls, 0, 'распознавание платное: дважды за одно и то же не платим');
    assert.equal(result.description, 'уже расшифровано');
  });

  it('без службы распознавания голосовое остаётся вложением', async () => {
    const result = await describeFromAttachments(undefined, [{ kind: 'voice', token: 'v' }]);

    assert.match(result.description, /Голосовое/);
    assert.equal(result.attachments[0]?.transcript, undefined);
    assert.equal(unheardVoice(result.attachments), true);
  });

  it('заявка из голосового доходит до очереди диспетчера', async () => {
    const deps = setup();
    const { description, attachments } = await describeFromAttachments(
      undefined,
      [{ kind: 'voice', token: 'voice-1' }],
      transcriber,
    );

    const created = asRequest(await submitProblem(deps, {
      resident: maria,
      description,
      attachments,
      startParam: 'ent_b1_1',
    }));

    assert.equal(created.request.category, 'elevator', 'категория подсказана расшифровкой');
    assert.equal(created.request.attachments[0]?.kind, 'voice');
  });
});

describe('ночная смена', () => {
  /** Полночь по Москве: сервер при этом живёт по UTC. */
  const atNight = (): Deps => {
    const deps = setup();
    let clock = new Date('2026-09-03T00:30:00Z').getTime();

    return {
      ...deps,
      now: () => new Date(clock),
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };

  it('ночью заявка будит дежурного, а не всю смену', async () => {
    const deps = atNight();

    await deps.repository.saveResident({ ...technician, onDuty: true });

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    assert.deepEqual(
      deps.notifier.sent.filter((item) => /Новая заявка/.test(item.text)).map((item) => item.maxUserId),
      [technician.maxUserId],
    );
  });

  it('днём заявку принимает тот, кто может её принять', async () => {
    const deps = setup();

    await deps.repository.saveResident({ ...technician, onDuty: true });

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    assert.deepEqual(
      deps.notifier.sent
        .filter((item) => /Новая заявка/.test(item.text))
        .map((item) => item.maxUserId),
      [dispatcher.maxUserId],
    );
  });

  it('когда принять заявку некому, будят и мастеров', async () => {
    const deps = setup();

    await deps.repository.saveResident({ ...dispatcher, buildingId: 'b9', servesBuildingIds: ['b9'] });

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    assert.deepEqual(
      deps.notifier.sent
        .filter((item) => /Новая заявка/.test(item.text))
        .map((item) => item.maxUserId),
      [technician.maxUserId],
    );
  });

  it('если дежурных не назначили, ночью будят всех', async () => {
    const deps = atNight();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    assert.equal(deps.notifier.sent.filter((item) => /Новая заявка/.test(item.text)).length, 1);
  });
});

describe('человеческий адрес объекта', () => {
  it('паспорт оборудования называет его так же, как заявка', async () => {
    const deps = setup();

    await deps.repository.saveEquipment({ buildingId: BUILDING_ID, code: 'lift-1', title: 'Лифт, подъезд 1' });

    const created = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Лифт застрял между этажами',
      startParam: 'eqp_b1_lift-1',
    }));

    assert.equal(created.kind, 'created');
    assert.equal(describeTarget(created.request.target), 'Лифт, подъезд 1');

    const passport = await objectPassport(deps, 'eqp_b1_lift-1');

    assert.equal(passport?.target, 'Лифт, подъезд 1');
  });

  it('наклейка, напечатанная раньше справочника, оставляет код', async () => {
    const deps = setup();

    const passport = await objectPassport(deps, 'eqp_b1_lift-9');

    assert.equal(passport?.target, 'оборудование lift-9');
  });
});

describe('плановые работы вместо заявки', () => {
  /** Объявляет отключение по стояку Марии, идущее прямо сейчас. */
  const announceWorks = async (deps: Deps, overrides: Record<string, unknown> = {}) =>
    publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Замена задвижки',
      body: 'Отключение горячей воды на время работ',
      entrance: 1,
      riser: 1,
      works: {
        category: 'plumbing',
        from: new Date(deps.now().getTime() - HOUR),
        until: new Date(deps.now().getTime() + 4 * HOUR),
      },
      ...overrides,
    });

  it('обращение во время объявленных работ получает срок, а не номер заявки', async () => {
    const deps = setup();

    await announceWorks(deps);

    const result = await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' });

    assert.equal(result.kind, 'planned');
    assert.match(result.kind === 'planned' ? result.explanation : '', /плановые работы до/);

    assert.deepEqual(await listRequestsFor(deps, dispatcher, 'queue'), []);
  });

  it('жилец может настоять, тогда заявка заводится', async () => {
    const deps = setup();

    await announceWorks(deps);

    const insisted = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Нет воды, и в подвале хлещет',
      anyway: true,
    }));

    assert.equal(insisted.kind, 'created');
    assert.equal((await listRequestsFor(deps, dispatcher, 'queue')).length, 1);
  });

  it('соседний стояк работами не объясняется', async () => {
    const deps = setup();

    await announceWorks(deps);

    const result = asRequest(await submitProblem(deps, { resident: sonya, description: 'Нет горячей воды' }));

    assert.equal(result.kind, 'created');
  });

  it('другая часть хозяйства работами не объясняется', async () => {
    const deps = setup();

    await announceWorks(deps);

    const result = asRequest(await submitProblem(deps, { resident: maria, description: 'Не работает лифт' }));

    assert.equal(result.kind, 'created');
    assert.equal(result.request.category, 'elevator');
  });

  it('кончившиеся работы ничего не объясняют', async () => {
    const deps = setup();

    await announceWorks(deps);
    deps.advance(5 * HOUR);

    const result = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    assert.equal(result.kind, 'created');
  });

  it('обычное объявление заявку не подменяет', async () => {
    const deps = setup();

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Собрание собственников',
      body: 'В четверг в 19:00 во дворе',
      entrance: 1,
      riser: 1,
    });

    const result = asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    assert.equal(result.kind, 'created');
  });

  it('о начале и об окончании работ жильцам сообщают', async () => {
    const deps = setup();

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Замена задвижки',
      body: 'Отключение горячей воды',
      entrance: 1,
      riser: 1,
      works: {
        category: 'plumbing',
        from: new Date(deps.now().getTime() + 2 * HOUR),
        until: new Date(deps.now().getTime() + 6 * HOUR),
      },
    });

    deps.notifier.sent.length = 0;

    let since = deps.now();
    deps.advance(HOUR);

    assert.deepEqual(await remindAboutWorks(deps, BUILDING_ID, since), [], 'работы ещё не начались');

    since = deps.now();
    deps.advance(2 * HOUR);

    const started = await remindAboutWorks(deps, BUILDING_ID, since);

    assert.deepEqual(started.map((item) => item.event), ['started']);
    assert.deepEqual(
      deps.notifier.sent.map((item) => item.maxUserId).sort(),
      [maria.maxUserId, pavel.maxUserId].sort(),
      'сообщение ушло квартирам этого стояка',
    );
    assert.match(deps.notifier.sent[0]?.text ?? '', /Начались плановые работы/);
    assert.match(deps.notifier.sent[0]?.text ?? '', /Закончить планируем до \d{2}:\d{2}/);

    deps.notifier.sent.length = 0;
    since = deps.now();
    deps.advance(4 * HOUR);

    const finished = await remindAboutWorks(deps, BUILDING_ID, since);

    assert.deepEqual(finished.map((item) => item.event), ['finished']);
    assert.match(deps.notifier.sent[0]?.text ?? '', /завершены по графику/);
    assert.match(deps.notifier.sent[0]?.text ?? '', /оформлю заявку/);
  });

  it('о завтрашних работах предупреждают за сутки', async () => {
    const deps = setup();
    const DAY = 24 * HOUR;

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Замена задвижки',
      body: 'Отключение горячей воды',
      entrance: 1,
      riser: 1,
      works: {
        category: 'plumbing',
        from: new Date(deps.now().getTime() + 3 * DAY),
        until: new Date(deps.now().getTime() + 3 * DAY + 4 * HOUR),
      },
    });

    deps.notifier.sent.length = 0;

    let since = deps.now();
    deps.advance(DAY);

    assert.deepEqual(await remindAboutWorks(deps, BUILDING_ID, since), [], 'до предупреждения ещё двое суток');

    since = deps.now();
    deps.advance(DAY + HOUR);

    const soon = await remindAboutWorks(deps, BUILDING_ID, since);

    assert.deepEqual(soon.map((item) => item.event), ['soon']);
    assert.match(deps.notifier.sent[0]?.text ?? '', /Завтра плановые работы/);
    assert.match(deps.notifier.sent[0]?.text ?? '', /подъезд 1, стояк 1, до /);
  });

  it('объявление за час до отключения предупреждением задним числом не сыплет', async () => {
    const deps = setup();

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Авария на вводе',
      body: 'Отключение горячей воды',
      entrance: 1,
      riser: 1,
      works: {
        category: 'plumbing',
        from: new Date(deps.now().getTime() + HOUR),
        until: new Date(deps.now().getTime() + 4 * HOUR),
      },
    });

    deps.notifier.sent.length = 0;

    const since = deps.now();
    deps.advance(2 * HOUR);

    assert.deepEqual(
      (await remindAboutWorks(deps, BUILDING_ID, since)).map((item) => item.event),
      ['started'],
    );
  });

  it('соседнему стояку о чужих работах не сообщают', async () => {
    const deps = setup();

    await publishAnnouncement(deps, {
      resident: dispatcher,
      title: 'Замена задвижки',
      body: 'Отключение горячей воды',
      entrance: 1,
      riser: 1,
      works: {
        category: 'plumbing',
        from: new Date(deps.now().getTime() + HOUR),
        until: new Date(deps.now().getTime() + 4 * HOUR),
      },
    });

    deps.notifier.sent.length = 0;

    const since = deps.now();
    deps.advance(2 * HOUR);

    await remindAboutWorks(deps, BUILDING_ID, since);

    assert.equal(
      deps.notifier.sent.some((item) => item.maxUserId === sonya.maxUserId),
      false,
    );
  });

  it('обычное объявление о ходе работ не сообщает', async () => {
    const deps = setup();

    await publishAnnouncement(deps, { resident: dispatcher, title: 'Собрание', body: 'В четверг' });

    const since = deps.now();
    deps.advance(2 * HOUR);

    assert.deepEqual(await remindAboutWorks(deps, BUILDING_ID, since), []);
  });

  it('во время работ обращения не копятся в одну заявку через склейку', async () => {
    const deps = setup();

    await announceWorks(deps);

    const first = await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' });
    const second = await submitProblem(deps, { resident: pavel, description: 'И у нас нет воды' });

    assert.equal(first.kind, 'planned');
    assert.equal(second.kind, 'planned');
  });

  it('заявка, заведённая настоянием, дальше склеивает соседей как обычно', async () => {
    const deps = setup();

    await announceWorks(deps);

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет воды и течёт с потолка', anyway: true }));

    const neighbour = asRequest(await submitProblem(deps, { resident: pavel, description: 'У нас тоже течёт' }));

    assert.equal(neighbour.kind, 'joined');
    assert.equal(neighbour.reporters, 2);
  });

  it('жилец может отказаться от склейки: у него другая проблема', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    const own = asRequest(await submitProblem(deps, {
      resident: pavel,
      description: 'Течёт кран на кухне, к стояку это не относится',
      anyway: true,
    }));

    assert.equal(own.kind, 'created');
    assert.equal(own.reporters, 1);
    assert.equal((await listRequestsFor(deps, dispatcher, 'queue')).length, 2, 'заявки разные, и работы тоже');
  });
});

describe('аварийный режим дома', () => {
  /** Три обращения по одному стояку: столько нужно, чтобы авария считалась подтверждённой. */
  const confirm = async (deps: Deps): Promise<void> => {
    const third = resident('res-third', 'apt-4', 1004);

    await deps.repository.saveApartment({ id: 'apt-4', buildingId: BUILDING_ID, number: 4, entrance: 1, riser: 1 });
    await deps.repository.saveResident(third);

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды' }));
    asRequest(await submitProblem(deps, { resident: third, description: 'Нет горячей воды' }));
  };

  it('подтверждённую аварию продукт объявляет сам', async () => {
    const deps = setup();

    await confirm(deps);

    const [announcement] = await deps.repository.listAnnouncements(BUILDING_ID);

    assert.match(announcement?.title ?? '', /^Авария: водоснабжение и канализация$/);
    assert.match(announcement?.body ?? '', /Знаем и чиним, заявка Д15-/);
    assert.match(announcement?.body ?? '', /Заводить свою заявку не нужно/);
  });

  it('объявляет один раз, сколько бы соседей ни подтвердило', async () => {
    const deps = setup();

    await confirm(deps);

    const fourth = resident('res-fourth', 'apt-5', 1005);

    await deps.repository.saveApartment({ id: 'apt-5', buildingId: BUILDING_ID, number: 5, entrance: 1, riser: 1 });
    await deps.repository.saveResident(fourth);
    asRequest(await submitProblem(deps, { resident: fourth, description: 'Нет горячей воды' }));

    assert.equal((await deps.repository.listAnnouncements(BUILDING_ID)).length, 1);
  });

  it('одно обращение аварией не считается и дом не будит', async () => {
    const deps = setup();

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));

    assert.deepEqual(await deps.repository.listAnnouncements(BUILDING_ID), []);
  });

  it('когда авария устранена, продукт сообщает и об этом', async () => {
    const deps = setup();

    await confirm(deps);

    const [request] = await listRequestsFor(deps, dispatcher, 'queue');

    for (const to of ['accepted', 'in_progress', 'done'] as const) {
      await transitionRequest(deps, {
        resident: dispatcher,
        requestId: request!.id,
        to,
        ...(to === 'in_progress' ? { assigneeId: technician.id } : {}),
        ...(to === 'done' ? { comment: 'Устранено' } : {}),
      });
    }

    await transitionRequest(deps, { resident: maria, requestId: request!.id, to: 'confirmed' });

    const titles = (await deps.repository.listAnnouncements(BUILDING_ID)).map((item) => item.title);

    assert.equal(titles.filter((title) => title.startsWith('Устранено')).length, 1);
  });

  it('о заявке, которую не объявляли, ничего не сообщают', async () => {
    const deps = setup();

    const own = asRequest(await submitProblem(deps, { resident: maria, description: 'Скрипит дверца шкафа' }));

    if (own.kind !== 'created') throw new Error('ожидалась новая заявка');

    for (const to of ['accepted', 'in_progress', 'done'] as const) {
      await transitionRequest(deps, {
        resident: dispatcher,
        requestId: own.request.id,
        to,
        ...(to === 'in_progress' ? { assigneeId: technician.id } : {}),
        ...(to === 'done' ? { comment: 'Подтянул петли' } : {}),
      });
    }

    await transitionRequest(deps, { resident: maria, requestId: own.request.id, to: 'confirmed' });

    assert.deepEqual(await deps.repository.listAnnouncements(BUILDING_ID), []);
  });
});

describe('разбор обращения при подаче', () => {
  it('категория от модели меняет срок, а сам срок модель не назначает', async () => {
    const deps: Deps = {
      ...setup(),
      reasoner: { understand: () => Promise.resolve({ category: 'plumbing', title: 'Течь под ванной' }) },
    };

    const submitted = asRequest(await submitProblem(deps, { resident: maria, description: 'Из-под ванны капает' }));

    if (submitted.kind !== 'created') throw new Error('ожидалась новая заявка');

    const hours = (submitted.request.resolutionDueAt.getTime() - submitted.request.createdAt.getTime()) / HOUR;

    assert.equal(submitted.request.category, 'plumbing');
    assert.equal(submitted.request.title, 'Течь под ванной');
    assert.equal(hours, CATEGORY_RULES.plumbing.resolutionHours);
  });

  it('выбор жильца важнее разбора', async () => {
    const deps: Deps = {
      ...setup(),
      reasoner: { understand: () => Promise.resolve({ category: 'cleaning' }) },
    };

    const submitted = asRequest(await submitProblem(deps, {
      resident: maria,
      description: 'Из-под ванны капает',
      category: 'plumbing',
    }));

    if (submitted.kind !== 'created') throw new Error('ожидалась новая заявка');

    assert.equal(submitted.request.category, 'plumbing');
  });

  it('вопрос приходит с уже заведённой заявкой', async () => {
    const deps: Deps = {
      ...setup(),
      reasoner: { understand: () => Promise.resolve({ question: 'На каком этаже?' }) },
    };

    const submitted = asRequest(await submitProblem(deps, { resident: maria, description: 'Не горит лампа' }));

    assert.equal(submitted.kind, 'created');
    assert.equal(submitted.kind === 'created' ? submitted.question : undefined, 'На каком этаже?');
  });

  it('присоединившемуся вопрос не задают: заявка уже описана', async () => {
    const deps: Deps = {
      ...setup(),
      reasoner: { understand: () => Promise.resolve({ question: 'На каком этаже?' }) },
    };

    asRequest(await submitProblem(deps, { resident: maria, description: 'Нет горячей воды' }));
    deps.advance(HOUR);
    const second = asRequest(await submitProblem(deps, { resident: pavel, description: 'Нет горячей воды со вчера' }));

    assert.equal(second.kind, 'joined');
    assert.equal(second.kind === 'joined' ? second.question : 'нет', undefined);
  });

  it('просьбу про другой раздел разбор уводит из заявок', async () => {
    const seen: { sections?: string[] } = {};

    const deps: Deps = {
      ...setup(),
      reasoner: {
        understand: () => Promise.resolve(undefined),
        route: (input) => {
          seen.sections = input.sections.map((item) => item.screen);

          return Promise.resolve({ kind: 'elsewhere', screen: 'support' });
        },
        assist: () => Promise.resolve({ answer: 'Живого оператора нет, ответит смена.', screen: 'support' }),
        onTopic: () => Promise.resolve(true),
      },
    };

    const result = await submitProblem(deps, { resident: maria, description: 'позовите оператора' });

    assert.equal(result.kind, 'answered');
    assert.match(result.kind === 'answered' ? result.answer : '', /оператор/i);
    assert.equal(seen.sections?.includes('support'), true, 'разделы роли модели не отдали');
    assert.deepEqual(await deps.repository.listRequests({ authorId: maria.id }), []);
  });

  it('поломку разбор оставляет заявкой, даже если слова совпали с разделом', async () => {
    const deps: Deps = {
      ...setup(),
      reasoner: {
        understand: () => Promise.resolve(undefined),
        route: () => Promise.resolve({ kind: 'breakdown' }),
      },
    };

    const submitted = asRequest(await submitProblem(deps, { resident: maria, description: 'Не закрывается дверь' }));

    assert.equal(submitted.kind, 'created');
  });

  it('без модели короткая просьба уходит из заявок, а поломка остаётся', async () => {
    const deps = setup();

    assert.equal((await submitProblem(deps, { resident: maria, description: 'оператор' })).kind, 'answered');
    assert.equal(
      asRequest(await submitProblem(deps, { resident: maria, description: 'Не закрывается дверь' })).kind,
      'created',
    );
  });

  it('упавшая модель подачу не ломает', async () => {
    const deps: Deps = {
      ...setup(),
      reasoner: { understand: () => Promise.reject(new Error('служба недоступна')) },
    };

    const submitted = asRequest(await submitProblem(deps, { resident: maria, description: 'Не работает лифт' }));

    if (submitted.kind !== 'created') throw new Error('ожидалась новая заявка');

    assert.equal(submitted.request.category, 'elevator');
  });
});
