import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  answerHandoff,
  createCollectingNotifier,
  createMockHandoffs,
  createServiceRequest,
  handoffsOf,
  listAudit,
  passRequest,
  responsibilityOf,
  waitingHandoffs,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const stranger: Resident = { ...dispatcher, id: 'disp-2', maxUserId: 2002, buildingId: 'b2' };

const PARTNERS = [
  { kind: 'resource' as const, title: 'Водоканал', categories: ['plumbing' as const], channel: 'email' },
  { kind: 'municipal' as const, title: 'Администрация района', categories: ['yard' as const] },
];

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> };

const setup = (options: { withGateway?: boolean } = {}): Deps => {
  let counter = 0;
  const gateway = createMockHandoffs({ channel: 'gis_zhkh' });

  return {
    repository: new InMemoryRepository({
      buildings: [
        { id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', partners: PARTNERS },
        { id: 'b2', code: 'Д1', address: 'ул. Мира, 1', companyId: 'ук-вторая' },
      ],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
      residents: [maria, dispatcher, stranger],
    }),
    now: () => new Date('2026-09-22T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
    ...(options.withGateway ? { handoffs: gateway } : {}),
  };
};

const leak = (deps: Deps) =>
  createServiceRequest(deps, {
    resident: maria,
    description: 'Течёт труба в подвале, вода идёт из стояка',
    startParam: `rsr_${BUILDING_ID}_1_1`,
  });

describe('зона ответственности по заявке', () => {
  it('называет ответственного и организации, которым можно передать', async () => {
    const deps = setup();
    const request = await leak(deps);

    const view = await responsibilityOf(deps, request);

    assert.equal(view.responsibility.kind, 'management');
    assert.deepEqual(
      view.targets.map((target) => target.organization),
      ['Водоканал'],
    );
    assert.match(view.targets[0]?.basis ?? '', /Правил № 354/);
  });
});

describe('передача обращения смежной организации', () => {
  it('записывает передачу, называет срок ответа и говорит об этом жильцу', async () => {
    const deps = setup();
    const request = await leak(deps);

    const handoff = await passRequest(deps, { staff: dispatcher, requestId: request.id, to: 'resource' });

    assert.equal(handoff.organization, 'Водоканал');
    assert.equal(handoff.status, 'sent');
    assert.equal(handoff.channel, 'email', 'канал берётся из карточки дома');
    assert.equal(handoff.dueAt.toISOString(), '2026-09-22T12:00:00.000Z');

    const said = deps.notifier.sent.find((message) => message.maxUserId === maria.maxUserId);

    assert.match(said?.text ?? '', /передано в Водоканал/);
    assert.match(said?.text ?? '', /Правил № 354/);
    assert.match(said?.text ?? '', /остаётся на контроле/);
  });

  it('с настроенным каналом уходит номер во внешней системе', async () => {
    const deps = setup({ withGateway: true });
    const request = await leak(deps);

    const handoff = await passRequest(deps, { staff: dispatcher, requestId: request.id, to: 'resource' });

    assert.equal(handoff.channel, 'gis_zhkh');
    assert.equal(handoff.status, 'accepted');
    assert.match(handoff.externalId ?? '', /^(РСО|ПОДР|МУН|ГЖИ)-/);

    const said = deps.notifier.sent.find((message) => message.maxUserId === maria.maxUserId);

    assert.match(said?.text ?? '', /Номер во внешней системе/);
  });

  it('дважды в одну организацию не передаётся, пока ответа нет', async () => {
    const deps = setup();
    const request = await leak(deps);

    await passRequest(deps, { staff: dispatcher, requestId: request.id, to: 'resource' });

    await assert.rejects(
      passRequest(deps, { staff: dispatcher, requestId: request.id, to: 'resource' }),
      /уже передано/,
    );
  });

  it('организации, которой в доме нет, обращение не передаётся', async () => {
    const deps = setup();
    const request = await leak(deps);

    await assert.rejects(passRequest(deps, { staff: dispatcher, requestId: request.id, to: 'inspection' }), /нет организации/);
  });

  it('жилец и чужая организация передать не могут', async () => {
    const deps = setup();
    const request = await leak(deps);

    await assert.rejects(passRequest(deps, { staff: maria, requestId: request.id, to: 'resource' }), /вправе управляющая/);
    await assert.rejects(
      passRequest(deps, { staff: stranger, requestId: request.id, to: 'resource' }),
      /другая управляющая организация/,
    );
  });

  it('передача попадает в журнал действий', async () => {
    const deps = setup();
    const request = await leak(deps);
    const manager: Resident = { ...dispatcher, id: 'mgr-1', maxUserId: 2003, role: 'manager' };

    await deps.repository.saveResident(manager);
    await passRequest(deps, { staff: dispatcher, requestId: request.id, to: 'resource' });

    const [entry] = await listAudit(deps, manager);

    assert.equal(entry?.action, 'request_passed');
    assert.match(entry?.details ?? '', /Водоканал/);
    assert.equal(entry?.subject, request.number);
  });
});

describe('ответ смежной организации', () => {
  it('ответ доходит до жильца и снимает обращение с ожидания', async () => {
    const deps = setup();
    const request = await leak(deps);
    const handoff = await passRequest(deps, { staff: dispatcher, requestId: request.id, to: 'resource' });

    const answered = await answerHandoff(deps, {
      handoffId: handoff.id,
      status: 'answered',
      answer: 'Задвижка на вводе заменена 22 сентября',
      staff: dispatcher,
    });

    assert.equal(answered.status, 'answered');
    assert.equal(answered.answeredAt?.toISOString(), '2026-09-22T10:00:00.000Z');

    const said = deps.notifier.sent.filter((message) => message.maxUserId === maria.maxUserId).at(-1);

    assert.match(said?.text ?? '', /Водоканал ответила/);
    assert.match(said?.text ?? '', /Задвижка на вводе/);

    assert.deepEqual(await waitingHandoffs(deps, dispatcher), []);
    assert.equal((await handoffsOf(deps, request.id, dispatcher)).length, 1);
  });

  it('недоставленное обращение видно жильцу как недоставленное', async () => {
    const deps = setup();
    const request = await leak(deps);
    const handoff = await passRequest(deps, { staff: dispatcher, requestId: request.id, to: 'resource' });

    await answerHandoff(deps, { handoffId: handoff.id, status: 'failed', staff: dispatcher });

    const said = deps.notifier.sent.filter((message) => message.maxUserId === maria.maxUserId).at(-1);

    assert.match(said?.text ?? '', /не доставлено/);
  });

  it('ожидающие обращения видит только своя смена', async () => {
    const deps = setup();
    const request = await leak(deps);

    await passRequest(deps, { staff: dispatcher, requestId: request.id, to: 'resource' });

    assert.equal((await waitingHandoffs(deps, dispatcher)).length, 1);
    await assert.rejects(waitingHandoffs(deps, maria), /вправе управляющая/);
    await assert.rejects(waitingHandoffs(deps, stranger, BUILDING_ID), /другая управляющая организация/);
  });
});
