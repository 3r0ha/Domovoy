import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  createCollectingNotifier,
  createMockPayments,
  dossierFor,
  setTariff,
  submitProblem,
  type AppDeps,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-18T10:00:00Z');

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const ivan: Resident = {
  id: 'res-2',
  maxUserId: 1002,
  displayName: 'Иван',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
};

const olga: Resident = {
  id: 'disp-1',
  maxUserId: 2001,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

const nina: Resident = {
  id: 'mgr-1',
  maxUserId: 2003,
  displayName: 'Нина',
  role: 'manager',
  buildingId: BUILDING_ID,
};

const sergey: Resident = {
  id: 'tech-1',
  maxUserId: 2002,
  displayName: 'Сергей',
  role: 'technician',
  buildingId: BUILDING_ID,
};

const setup = async (): Promise<AppDeps> => {
  let counter = 0;

  const deps: AppDeps = {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 1, area: 60 },
      ],
      residents: [maria, ivan, olga, sergey, nina],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier: createCollectingNotifier(),
    payments: createMockPayments({ now: () => NOW }),
  };

  await setTariff(deps, nina, { kind: 'maintenance', value: 40, since: new Date('2026-01-01T00:00:00Z') });

  return deps;
};

describe('что помощник знает о человеке', () => {
  it('в фактах стоит текущий момент: сроки не приходится считать', async () => {
    const facts = await dossierFor(await setup(), maria);

    assert.match(facts, /^Сейчас: /);
    assert.match(facts, /Дом: ул\. Ленина, 15\./);
    assert.match(facts, /Квартира: 1\./);
  });

  it('месяц квитанции в долг не попадает: иначе одно начисление считается дважды', async () => {
    const facts = await dossierFor(await setup(), maria);

    const period = /Период (\d{4}-\d{2})/.exec(facts)?.[1];

    assert.ok(period, 'в фактах есть месяц квитанции');

    const debt = /Долг:\n([\s\S]*?)(\n[А-Я]|$)/.exec(facts)?.[1] ?? '';

    assert.ok(debt.length > 0, 'долг за прошлые месяцы в фактах есть');
    assert.doesNotMatch(debt, new RegExp(period), 'месяц квитанции в долге не повторяется');
  });

  it('смене видно, кому поручить и сколько должников', async () => {
    const deps = await setup();

    await submitProblem(deps, { resident: maria, description: 'Не горит лампа в подъезде' });

    const facts = await dossierFor(deps, olga);

    assert.match(facts, /Кому можно поручить: /);
    assert.match(facts, /Сергей \(мастер, нарядов \d+\)/);
    assert.match(facts, /Долг дома /);
    assert.match(facts, /Должник: кв\. \d+, /);
  });

  it('очередь идёт в факты строками: на «что горит» отвечают ими', async () => {
    const deps = await setup();

    await submitProblem(deps, { resident: maria, description: 'Застряли в лифте' });

    const facts = await dossierFor(deps, olga);

    assert.match(facts, /Очередь: Д15-\d{4}-\d{4}, Застряли в лифте: /);
    assert.match(facts, /(осталось|просрочено) \d+ ч/);
    assert.match(facts, /исполнитель не назначен/);
  });

  it('чужой квартирной заявки и чужого имени в фактах жильца нет', async () => {
    const deps = await setup();

    await submitProblem(deps, { resident: ivan, description: 'Течёт кран на кухне', apartmentId: 'apt-2' });

    const facts = await dossierFor(deps, maria);

    assert.doesNotMatch(facts, /Течёт кран/);
    assert.doesNotMatch(facts, /Иван/);
  });
});
