import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FORGOTTEN_NAME,
  InMemoryRepository,
  commentRequest,
  createCollectingNotifier,
  createMockPayments,
  createServiceRequest,
  exportPersonalData,
  forgetResident,
  formatPersonalData,
  listRequestsFor,
  saveContact,
  setNotice,
  startPoll,
  submitReading,
  transitionRequest,
  vote,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-22T10:00:00Z');

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'staff-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

type Deps = AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> };

const setup = async (): Promise<Deps> => {
  let counter = 0;

  const deps: Deps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 7, entrance: 1, riser: 1, area: 50 }],
      residents: [maria, dispatcher],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
    payments: createMockPayments({ now: () => NOW }),
  };

  await deps.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

  return deps;
};

describe('выгрузка своих данных', () => {
  it('собирает заявки, показания и голоса', async () => {
    const deps = await setup();

    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    await commentRequest(deps, { resident: maria, requestId: request.id, text: 'У соседей вода есть' });

    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 120 });

    const poll = await startPoll(deps, {
      resident: dispatcher,
      kind: 'simple',
      title: 'Шлагбаум',
      question: 'Установить шлагбаум',
      days: 7,
    });

    await vote(deps, { resident: maria, pollId: poll.id, choice: 'for' });

    const data = await exportPersonalData(deps, maria);

    assert.equal(data.displayName, 'Мария');
    assert.equal(data.address, 'ул. Ленина, 15');
    assert.equal(data.apartment, 7);
    assert.equal(data.requests.length, 1);
    assert.equal(data.requests[0]?.number, request.number);
    assert.deepEqual(
      data.requests[0]?.comments.map((comment) => comment.text),
      ['У соседей вода есть'],
    );
    assert.deepEqual(data.readings, [{ meter: 'ХВС-1', value: 120, unit: 'м³', at: NOW }]);
    assert.deepEqual(data.votes, [{ poll: 'Шлагбаум', choice: 'for', at: NOW }]);
  });

  it('чужого в выгрузку не попадает', async () => {
    const deps = await setup();

    await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });

    const data = await exportPersonalData(deps, dispatcher);

    assert.deepEqual(data.requests, []);
    assert.deepEqual(data.readings, []);
  });

  it('читается человеком, а не программой', async () => {
    const deps = await setup();

    await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });
    await submitReading(deps, { resident: maria, meterId: 'cold-1', value: 120 });
    await saveContact(deps, maria, '+79991234567');
    await setNotice(deps, (await deps.repository.findResident(maria.id))!, 'news', false);

    const person = (await deps.repository.findResident(maria.id))!;
    const text = formatPersonalData(await exportPersonalData(deps, person), 'Europe/Moscow');

    assert.match(text, /Мария/);
    assert.match(text, /ул\. Ленина, 15, кв\. 7/);
    assert.match(text, /Заявки \(1\)/);
    assert.match(text, /Показания \(1\)/);
    assert.doesNotMatch(text, /Голоса/);
    assert.match(text, /Телефон: \+79991234567/);
    assert.match(text, /Отключено: Объявления дома/);
    assert.match(text, /22 сентября 2026/);
  });

  it('платежи по квартире, тоже сведения о человеке', async () => {
    const deps = await setup();

    await deps.payments!.pay({ apartmentId: 'apt-1', period: '2026-08', amount: 1620 });

    const data = await exportPersonalData(deps, maria);
    const text = formatPersonalData(data, 'Europe/Moscow');

    assert.deepEqual(
      data.payments.map((payment) => payment.period),
      ['2026-08'],
    );
    assert.match(text, /Платежи \(1\)/);
    assert.match(text, /август 2026 · 1\s620,00 ₽/);
  });

  it('без единой записи говорит это одной фразой', async () => {
    const deps = await setup();

    const text = formatPersonalData(await exportPersonalData(deps, maria), 'Europe/Moscow');

    assert.match(text, /Заявок, показаний, голосов и платежей за вами не числится\./);
  });
});

describe('удаление профиля', () => {
  it('снимает связь с человеком, а историю дома оставляет', async () => {
    const deps = await setup();

    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });

    await forgetResident(deps, maria);

    const forgotten = await deps.repository.findResident(maria.id);

    assert.equal(forgotten?.displayName, FORGOTTEN_NAME);
    assert.equal(forgotten?.maxUserId, undefined);
    assert.equal(forgotten?.apartmentId, undefined);
    assert.equal(forgotten?.forgottenAt?.getTime(), NOW.getTime());
    assert.equal((await deps.repository.findRequest(request.id))?.number, request.number);
  });

  it('стирает телефон и настройки уведомлений', async () => {
    const deps = await setup();

    await saveContact(deps, maria, '+79991234567');
    await setNotice(deps, (await deps.repository.findResident(maria.id))!, 'news', false);
    await forgetResident(deps, (await deps.repository.findResident(maria.id))!);

    const forgotten = await deps.repository.findResident(maria.id);

    assert.equal(forgotten?.phone, undefined);
    assert.equal(forgotten?.mutes, undefined);
  });

  it('вход по прежнему аккаунту профиля не находит', async () => {
    const deps = await setup();

    await forgetResident(deps, maria);

    assert.equal(await deps.repository.findResidentByMaxUserId(1001), undefined);
  });

  it('обезличенному профилю не пишут', async () => {
    const deps = await setup();

    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });

    await forgetResident(deps, maria);
    deps.notifier.sent.length = 0;

    await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to: 'accepted' });

    assert.deepEqual(deps.notifier.sent, []);
  });

  it('чужие заявки удалённому не показываются', async () => {
    const deps = await setup();

    await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });
    await forgetResident(deps, maria);

    const returning: Resident = { ...maria, id: 'res-new', displayName: 'Мария' };

    assert.deepEqual(await listRequestsFor(deps, returning, 'mine'), []);
  });

  it('профиль сотрудника так не снимают', async () => {
    const deps = await setup();

    await assert.rejects(forgetResident(deps, dispatcher), /управляющая компания/);
  });
});
