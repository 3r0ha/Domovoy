import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  aimBroadcast,
  broadcastTargets,
  createCollectingNotifier,
  createMockPayments,
  listAudit,
  sendBroadcast,
  setNotice,
  setTariff,
  startPoll,
  submitReading,
  vote,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-22T10:00:00Z');

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
  owned: [{ apartmentId: 'apt-1', share: 1, basis: 'company' }],
};

const ivan: Resident = {
  id: 'res-2',
  maxUserId: 1002,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
  owned: [{ apartmentId: 'apt-2', share: 1, basis: 'company' }],
};

/** Жилец без MAX: он числится в доме, но сообщение до него не дойдёт. */
const pavel: Resident = {
  id: 'res-3',
  displayName: 'Павел',
  role: 'resident',
  apartmentId: 'apt-3',
  buildingId: BUILDING_ID,
};

const olga: Resident = {
  id: 'staff-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const nina: Resident = {
  id: 'mgr-1',
  maxUserId: 7007,
  displayName: 'Нина',
  role: 'manager',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> };

const setup = async (): Promise<Deps> => {
  let counter = 0;

  const deps: Deps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2, area: 60 },
        { id: 'apt-3', buildingId: BUILDING_ID, number: 3, entrance: 2, riser: 1, area: 70 },
      ],
      residents: [maria, ivan, pavel, olga, nina],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
    payments: createMockPayments({ now: () => NOW }),
  };

  return deps;
};

const gotBy = (deps: Deps, resident: Resident): string[] =>
  deps.notifier.sent.filter((item) => item.maxUserId === resident.maxUserId).map((item) => item.text);

describe('рассылка управляющей организации', () => {
  it('весь дом: считает и тех, до кого сообщение не дойдёт', async () => {
    const deps = await setup();

    const aim = await aimBroadcast(deps, olga, { kind: 'building' });

    assert.equal(aim.description, 'весь дом');
    assert.equal(aim.apartments, 3);
    assert.equal(aim.people, 3);
    assert.equal(aim.recipients, 2, 'у Павла нет MAX');
  });

  it('подъезд и стояк сужают адресат', async () => {
    const deps = await setup();

    const entrance = await aimBroadcast(deps, olga, { kind: 'entrance', entrance: 1 });
    const riser = await aimBroadcast(deps, olga, { kind: 'riser', entrance: 1, riser: 2 });

    assert.equal(entrance.description, 'подъезд 1');
    assert.equal(entrance.recipients, 2);
    assert.equal(riser.description, 'подъезд 1, стояк 2');
    assert.equal(riser.recipients, 1);
  });

  it('сообщение уходит в личную переписку от имени компании', async () => {
    const deps = await setup();

    const result = await sendBroadcast(deps, {
      actor: olga,
      scope: { kind: 'riser', entrance: 1, riser: 2 },
      text: '  Завтра с 9:00 до 13:00 нет горячей воды  ',
    });

    assert.equal(result.sent, 1);
    assert.equal(gotBy(deps, maria).length, 0);
    assert.deepEqual(gotBy(deps, ivan), [
      'Сообщение управляющей организации\n\nЗавтра с 9:00 до 13:00 нет горячей воды',
    ]);
  });

  it('перечисленные номера квартир', async () => {
    const deps = await setup();

    const result = await sendBroadcast(deps, {
      actor: olga,
      scope: { kind: 'apartments', numbers: [3, 1] },
      text: 'Проверьте счётчик',
    });

    assert.equal(result.description, 'квартиры 1, 3');
    assert.equal(result.apartments, 2);
    assert.equal(result.sent, 1, 'из двух квартир MAX только у Марии');
    assert.equal(gotBy(deps, maria).length, 1);
  });

  it('квартир с такими номерами в доме нет', async () => {
    const deps = await setup();

    await assert.rejects(
      sendBroadcast(deps, { actor: olga, scope: { kind: 'apartments', numbers: [99] }, text: 'Текст' }),
      /Таких квартир в доме нет/,
    );
  });

  it('отключённые объявления дома рассылку не пропускают', async () => {
    const deps = await setup();

    await setNotice(deps, maria, 'news', false);

    const aim = await aimBroadcast(deps, olga, { kind: 'building' });

    assert.equal(aim.people, 3);
    assert.equal(aim.recipients, 1);

    await sendBroadcast(deps, { actor: olga, scope: { kind: 'building' }, text: 'Собрание во дворе' });

    assert.equal(gotBy(deps, maria).length, 0);
    assert.equal(gotBy(deps, ivan).length, 1);
  });

  it('должникам пишут, даже если объявления дома отключены', async () => {
    const deps = await setup();

    await setTariff(deps, nina, { kind: 'maintenance', value: 40, since: new Date('2026-01-01T00:00:00Z') });
    await setNotice(deps, maria, 'news', false);

    const result = await sendBroadcast(deps, {
      actor: nina,
      scope: { kind: 'debtors' },
      text: 'Просим погасить задолженность',
    });

    assert.equal(result.description, 'должники дома');
    assert.equal(result.sent, 2, 'Мария и Иван, у Павла нет MAX');
    assert.equal(gotBy(deps, maria).length, 1);
  });

  it('не подавшие показания', async () => {
    const deps = await setup();

    await deps.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await deps.repository.saveMeter({ id: 'cold-2', apartmentId: 'apt-2', kind: 'cold_water', serial: 'ХВС-2' });

    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 15 });

    const aim = await aimBroadcast(deps, olga, { kind: 'meters' });

    assert.equal(aim.description, 'не подали показания');
    assert.equal(aim.people, 1);
    assert.equal(aim.recipients, 1);

    await sendBroadcast(deps, { actor: olga, scope: { kind: 'meters' }, text: 'Осталось два дня' });

    assert.equal(gotBy(deps, maria).length, 0);
    assert.equal(gotBy(deps, ivan).length, 1);
  });

  it('не проголосовавшие на открытом собрании', async () => {
    const deps = await setup();

    const poll = await startPoll(deps, {
      resident: nina,
      kind: 'simple',
      title: 'Ремонт подъездов',
      question: 'Утвердить смету',
      days: 14,
    });

    deps.notifier.sent.length = 0;
    await vote(deps, { resident: maria, pollId: poll.id, choice: 'for' });

    const aim = await aimBroadcast(deps, olga, { kind: 'poll', pollId: poll.id });

    assert.equal(aim.description, 'не проголосовали: Ремонт подъездов');
    assert.equal(aim.apartments, 2);
    assert.equal(aim.recipients, 1, 'из непроголосовавших MAX только у Ивана');
  });

  it('смена дома: отправитель своё же сообщение не получает', async () => {
    const deps = await setup();

    const result = await sendBroadcast(deps, {
      actor: olga,
      scope: { kind: 'staff' },
      text: 'Планёрка в 9:00',
    });

    assert.equal(result.description, 'смена дома');
    assert.equal(result.sent, 1);
    assert.equal(gotBy(deps, olga).length, 0);
    assert.equal(gotBy(deps, nina).length, 1);
  });

  it('жилец рассылку не отправляет', async () => {
    const deps = await setup();

    await assert.rejects(
      sendBroadcast(deps, { actor: maria, scope: { kind: 'building' }, text: 'Всем привет' }),
      /отправляет управляющая организация/,
    );
  });

  it('пустой текст не уходит', async () => {
    const deps = await setup();

    await assert.rejects(
      sendBroadcast(deps, { actor: olga, scope: { kind: 'building' }, text: '   ' }),
      /Текст рассылки пустой/,
    );
  });

  it('если получателей нет, отправку останавливают', async () => {
    const deps = await setup();

    await assert.rejects(
      sendBroadcast(deps, { actor: olga, scope: { kind: 'riser', entrance: 2, riser: 1 }, text: 'Текст' }),
      /никто не подходит/,
    );
  });

  it('отправка попадает в журнал действий', async () => {
    const deps = await setup();

    await sendBroadcast(deps, { actor: nina, scope: { kind: 'entrance', entrance: 1 }, text: 'Завтра уборка' });

    const journal = await listAudit(deps, nina);
    const entry = journal.find((item) => item.action === 'broadcast_sent');

    assert.equal(entry?.subject, 'подъезд 1');
    assert.equal(entry?.details, 'Завтра уборка');
  });

  it('из чего выбирают адресат', async () => {
    const deps = await setup();

    await startPoll(deps, {
      resident: nina,
      kind: 'simple',
      title: 'Ремонт подъездов',
      question: 'Утвердить смету',
      days: 14,
    });

    const targets = await broadcastTargets(deps, olga);

    assert.equal(targets.flats, 3);
    assert.equal(targets.staff, 2);
    assert.deepEqual(
      targets.entrances.map((entrance) => [entrance.entrance, entrance.flats]),
      [
        [1, 2],
        [2, 1],
      ],
    );
    assert.deepEqual(
      targets.entrances[0]?.risers.map((riser) => riser.riser),
      [1, 2],
    );
    assert.deepEqual(
      targets.polls.map((poll) => poll.title),
      ['Ремонт подъездов'],
    );
  });
});
