import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  askSupport,
  saysSomething,
  submitProblem,
  takeVisit,
  setReception,
  type AppDeps,
  type Reasoner,
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

const nina: Resident = {
  id: 'mgr-1',
  maxUserId: 2003,
  displayName: 'Нина',
  role: 'manager',
  buildingId: BUILDING_ID,
};

const setup = (reasoner?: Reasoner): AppDeps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
      residents: [maria, nina],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    ...(reasoner ? { reasoner } : {}),
  };
};

describe('сказанное человеком', () => {
  it('знак и число словами не считаются', () => {
    assert.equal(saysSomething('6'), false);
    assert.equal(saysSomething('-'), false);
    assert.equal(saysSomething('   '), false);
    assert.equal(saysSomething('123456'), false);
    assert.equal(saysSomething('течёт кран'), true);
    assert.equal(saysSomething('Нет света'), true);
  });

  it('заявка из одного знака не заводится', async () => {
    const deps = setup();

    await assert.rejects(submitProblem(deps, { resident: maria, description: '6' }), /Напишите словами/);
    await assert.rejects(submitProblem(deps, { resident: maria, description: '-' }), /Напишите словами/);

    assert.equal((await deps.repository.listRequests({})).length, 0);
  });

  it('фотография заменяет слова: со снимком короткая подпись проходит', async () => {
    const deps = setup();

    const created = await submitProblem(deps, {
      resident: maria,
      description: 'Фото',
      attachments: [{ kind: 'photo', token: 'photo-1' }],
    });

    assert.equal(created.kind, 'created');
  });

  it('вопрос в поддержку из прочерка не принимается', async () => {
    const deps = setup();

    await assert.rejects(askSupport(deps, { resident: maria, text: '?' }), /Напишите вопрос/);
  });

  it('на приём без темы не записывают', async () => {
    const deps = setup();

    await setReception(deps, {
      staff: nina,
      windows: [{ weekday: 5, from: '10:00', to: '18:00' }],
    });

    await assert.rejects(
      takeVisit(deps, { resident: maria, at: new Date('2026-09-25T11:00:00Z'), topic: '-' }),
      /Напишите, с чем придёте/,
    );
  });

  it('модель отсеивает отписку, которая выглядит словами', async () => {
    const asked: string[] = [];

    const deps = setup({
      understand: () => Promise.resolve(undefined),
      meaningful: (input) => {
        asked.push(input.text);
        return Promise.resolve(false);
      },
    });

    await assert.rejects(submitProblem(deps, { resident: maria, description: 'асдф' }), /Напишите словами/);

    assert.deepEqual(asked, ['асдф']);
  });

  it('длинный рассказ до модели не доходит: он и так по делу', async () => {
    let asked = 0;

    const deps = setup({
      understand: () => Promise.resolve(undefined),
      meaningful: () => {
        asked += 1;
        return Promise.resolve(false);
      },
    });

    const created = await submitProblem(deps, {
      resident: maria,
      description: 'Со вчерашнего вечера в ванной капает с потолка, уже намокла стена у двери',
    });

    assert.equal(created.kind, 'created');
    assert.equal(asked, 0);
  });
});
