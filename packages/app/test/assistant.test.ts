import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  askAssistant,
  capabilitiesFor,
  createServiceRequest,
  findCapability,
  submitProblem,
  type AppDeps,
  type Reasoner,
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

const setup = (reasoner?: Reasoner): AppDeps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', managementCompany: 'УК «Ленинская»' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
      residents: [maria, dispatcher],
      equipment: [
        { buildingId: BUILDING_ID, code: 'lift-2', title: 'Лифт, подъезд 2', kind: 'lift' },
        { buildingId: BUILDING_ID, code: 'domofon-1', title: 'Домофон, подъезд 1', kind: 'intercom' },
      ],
    }),
    now: () => new Date('2026-09-22T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    ...(reasoner ? { reasoner } : {}),
  };
};

describe('помощник по приложению', () => {
  it('без модели отвечает подбором по словам и даёт переход', async () => {
    const deps = setup();

    const answer = await askAssistant(deps, maria, 'Где передать показания счётчиков?');

    assert.equal(answer.by, 'keywords');
    assert.equal(answer.screen, 'meters');
    assert.equal(answer.command, '/meters');
    assert.match(answer.answer, /Показания/);
  });

  it('непонятный вопрос не оставляет человека без подсказки', async () => {
    const deps = setup();

    const answer = await askAssistant(deps, maria, 'ыыы');

    assert.match(answer.answer, /сообщить о поломке/i);
    assert.equal(answer.screen, 'list');
  });

  it('модель отвечает своими словами, а переход берётся только из доступных разделов', async () => {
    const asked: { facts?: string; sections?: number } = {};

    const deps = setup({
      understand: () => Promise.resolve(undefined),
      assist: (input) => {
        asked.facts = input.facts;
        asked.sections = input.sections.length;

        return Promise.resolve({ answer: 'Нажмите «Оплата», там показания и квитанция.', screen: 'meters' });
      },
    });

    const answer = await askAssistant(deps, maria, 'как передать показания');

    assert.equal(answer.by, 'model');
    assert.equal(answer.screen, 'meters');
    assert.match(answer.answer, /Оплата/);
    assert.match(asked.facts ?? '', /ул\. Ленина, 15/);
    assert.match(asked.facts ?? '', /Квартира: 1/);
    assert.equal(asked.sections, capabilitiesFor('resident').length);
  });

  it('выдуманный моделью раздел кнопкой не становится', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      assist: () => Promise.resolve({ answer: 'Откройте раздел «Магазин».', screen: 'shop' }),
    });

    const answer = await askAssistant(deps, maria, 'где купить лампочку');

    assert.equal(answer.screen, undefined);
    assert.equal(answer.by, 'model');
  });

  it('жильцу не предлагается раздел смены', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      assist: () => Promise.resolve({ answer: 'Посмотрите очередь дома.', screen: 'queue' }),
    });

    assert.equal((await askAssistant(deps, maria, 'что в очереди')).screen, undefined);
    assert.equal(findCapability('очередь дома', 'resident'), undefined);
    assert.equal(findCapability('очередь дома', 'dispatcher')?.screen, 'queue');
  });

  it('отказ модели оставляет ответ по словам', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      assist: () => Promise.reject(new Error('служба недоступна')),
    });

    const answer = await askAssistant(deps, maria, 'как открыть дверь подъезда');

    assert.equal(answer.by, 'keywords');
    assert.equal(answer.screen, 'home');
  });
});

describe('заголовок от модели', () => {
  it('пересказ своими словами принимается', async () => {
    const deps = setup({
      understand: () => Promise.resolve({ category: 'plumbing', title: 'Течь под ванной' }),
    });

    const result = await submitProblem(deps, { resident: maria, description: 'Из-под ванны капает' });

    assert.equal(result.kind === 'created' ? result.request.title : '', 'Течь под ванной');
  });

  it('дописанные моделью подробности заголовком не становятся', async () => {
    const deps = setup({
      understand: () =>
        Promise.resolve({ category: 'elevator', title: 'Застряли в лифте между третьим и четвёртым этажом' }),
    });

    const result = await submitProblem(deps, { resident: maria, description: 'Застрял лифт между этажами' });

    assert.equal(result.kind === 'created' ? result.request.title : '', 'Застрял лифт между этажами');
  });

  it('чужой номер подъезда в заголовке отбрасывается', async () => {
    const deps = setup({
      understand: () => Promise.resolve({ category: 'elevator', title: 'Лифт в подъезде 3 не работает' }),
    });

    const result = await submitProblem(deps, { resident: maria, description: 'Лифт не работает' });

    assert.equal(result.kind === 'created' ? result.request.title : '', 'Лифт не работает');
  });
});

describe('разбор обращения с домом', () => {
  it('модель получает оборудование дома и относит обращение к нему', async () => {
    const seen: { prompt?: string; equipment?: string[] } = {};

    const deps = setup({
      understand: (description, house) => {
        seen.prompt = description;
        seen.equipment = house?.equipment?.map((item) => item.code);

        return Promise.resolve({ category: 'elevator', priority: 'emergency', equipment: 'lift-2' });
      },
    });

    const result = await submitProblem(deps, { resident: maria, description: 'Застрял лифт во втором подъезде' });

    assert.equal(result.kind, 'created');
    assert.deepEqual(seen.equipment, ['lift-2', 'domofon-1']);
    assert.deepEqual(result.kind === 'created' ? result.request.target : undefined, {
      kind: 'equipment',
      buildingId: BUILDING_ID,
      equipmentId: 'lift-2',
      title: 'Лифт, подъезд 2',
    });
  });

  it('выдуманное моделью оборудование адресом не становится', async () => {
    const deps = setup({
      understand: () => Promise.resolve({ category: 'elevator', equipment: 'lift-99' }),
    });

    const result = await submitProblem(deps, { resident: maria, description: 'Не работает лифт' });

    assert.deepEqual(result.kind === 'created' ? result.request.target : undefined, {
      kind: 'apartment',
      apartmentId: 'apt-1',
      number: 1,
    });
  });

  it('указанный человеком объект модель не переписывает', async () => {
    const deps = setup({
      understand: () => Promise.resolve({ category: 'elevator', equipment: 'lift-2' }),
    });

    const result = await createServiceRequest(deps, {
      resident: maria,
      description: 'Не работает домофон',
      startParam: `eqp_${BUILDING_ID}_domofon-1`,
    });

    assert.deepEqual(result.target, {
      kind: 'equipment',
      buildingId: BUILDING_ID,
      equipmentId: 'domofon-1',
      title: 'Домофон, подъезд 1',
    });
  });
});
