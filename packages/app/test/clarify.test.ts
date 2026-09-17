import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  askAssistant,
  clarifyTarget,
  createServiceRequest,
  retargetRequest,
  transitionRequest,
  type AppDeps,
  type Reasoner,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

/** У Марии две квартиры в одном доме: адрес обращения из слов не следует. */
const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  apartmentIds: ['apt-1', 'apt-5'],
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
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2, area: 50 },
        { id: 'apt-5', buildingId: BUILDING_ID, number: 5, entrance: 2, riser: 1, area: 60 },
      ],
      residents: [maria, ivan, dispatcher],
      equipment: [{ buildingId: BUILDING_ID, code: 'lift-2', title: 'Лифт, подъезд 2', kind: 'lift' }],
    }),
    now: () => new Date('2026-09-22T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    ...(reasoner ? { reasoner } : {}),
  };
};

describe('уточняющий вопрос об адресе', () => {
  it('у человека с двумя квартирами продукт спрашивает, где случилось', async () => {
    const deps = setup();
    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });

    const asked = await clarifyTarget(deps, maria, request);

    assert.match(asked?.question ?? '', /Где/i);
    assert.deepEqual(
      asked?.options.map((option) => option.label),
      ['Квартира 1', 'Квартира 5', 'Подъезд 1', 'Подъезд 2'],
    );
  });

  it('про домофон спрашивают даже у того, у кого одна квартира', async () => {
    const deps = setup();

    await deps.repository.saveEquipment({
      buildingId: BUILDING_ID,
      code: 'domofon-1',
      title: 'Домофон, подъезд 1',
      kind: 'intercom',
    });

    const request = await createServiceRequest(deps, { resident: ivan, description: 'Сломался домофон' });
    const asked = await clarifyTarget(deps, ivan, request);

    assert.equal(asked?.options[0]?.label, 'Домофон, подъезд 1', 'названный объект не первый');
  });

  it('названный самим человеком объект не переспрашивают', async () => {
    const deps = setup();

    const request = await createServiceRequest(deps, {
      resident: maria,
      description: 'Не работает лифт',
      startParam: `eqp_${BUILDING_ID}_lift-2`,
    });

    assert.equal(await clarifyTarget(deps, maria, request), undefined);
  });

  it('вторая квартира в другом доме адрес не запутывает', async () => {
    const deps = setup();
    const elsewhere: Resident = { ...ivan, id: 'res-3', maxUserId: 1003, apartmentIds: ['apt-2', 'apt-9'] };

    await deps.repository.saveApartment({ id: 'apt-9', buildingId: 'b2', number: 9, entrance: 1, riser: 1 });
    await deps.repository.saveResident(elsewhere);

    const request = await createServiceRequest(deps, { resident: elsewhere, description: 'Течёт кран' });

    assert.equal(await clarifyTarget(deps, elsewhere, request), undefined);
  });

  it('одной квартире вопрос не задаётся: адрес и так известен', async () => {
    const deps = setup();
    const request = await createServiceRequest(deps, { resident: ivan, description: 'Течёт кран' });

    assert.equal(await clarifyTarget(deps, ivan, request), undefined);
  });

  it('вопрос и кнопки предлагает модель, но только из объектов дома', async () => {
    const seen: { candidates?: string[] } = {};

    const deps = setup({
      understand: () => Promise.resolve(undefined),
      clarify: (input) => {
        seen.candidates = input.candidates;

        return Promise.resolve({
          question: 'В какой квартире течёт?',
          choices: ['Квартира 5', 'Лифт, подъезд 2', 'Квартира 99'],
        });
      },
    });

    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });
    const asked = await clarifyTarget(deps, maria, request);

    assert.equal(asked?.question, 'В какой квартире течёт?');
    assert.deepEqual(
      asked?.options.map((option) => option.label),
      ['Квартира 5', 'Лифт, подъезд 2'],
      'выдуманная квартира кнопкой не стала',
    );
    assert.equal(seen.candidates?.includes('Лифт, подъезд 2'), true);
  });

  it('нажатая кнопка ставит заявке настоящий адрес и остаётся в истории', async () => {
    const deps = setup();
    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });
    const asked = await clarifyTarget(deps, maria, request);
    const chosen = asked?.options.find((option) => option.label === 'Квартира 5');

    const updated = await retargetRequest(deps, {
      resident: maria,
      requestId: request.id,
      startParam: chosen?.startParam ?? '',
    });

    assert.deepEqual(updated.target, { kind: 'apartment', apartmentId: 'apt-5' });
    assert.match(updated.history.at(-1)?.comment ?? '', /Адрес уточнён/);
  });

  it('смену спрашивают о квартире и дают назвать любую в доме', async () => {
    const deps = setup();

    const request = await createServiceRequest(deps, {
      resident: dispatcher,
      description: 'Прорвало кран, звонили с домашнего',
      house: true,
    });

    const asked = await clarifyTarget(deps, dispatcher, request);

    assert.equal(asked?.anyApartment, true, 'смене не дали выбрать квартиру');
    assert.match(asked?.question ?? '', /квартир/i);

    const updated = await retargetRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      startParam: 'apt_apt-2',
    });

    assert.deepEqual(updated.target, { kind: 'apartment', apartmentId: 'apt-2' });
  });

  it('жилец уточняет адрес только своими квартирами', async () => {
    const deps = setup();
    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });

    await assert.rejects(
      retargetRequest(deps, { resident: maria, requestId: request.id, startParam: 'apt_apt-2' }),
      /чужая квартира/i,
    );
  });

  it('чужую заявку и объект чужого дома уточнить нельзя', async () => {
    const deps = setup();
    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });

    await assert.rejects(
      retargetRequest(deps, { resident: ivan, requestId: request.id, startParam: 'apt_apt-2' }),
      /тот, кто подал обращение/,
    );

    await assert.rejects(
      retargetRequest(deps, { resident: maria, requestId: request.id, startParam: 'ent_b2_1' }),
      /из другого дома/,
    );
  });

  it('взятую в работу заявку жилец уже не переадресует', async () => {
    const deps = setup();
    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран' });

    await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to: 'accepted' });
    await transitionRequest(deps, { resident: dispatcher, requestId: request.id, to: 'in_progress' });

    await assert.rejects(
      retargetRequest(deps, { resident: maria, requestId: request.id, startParam: 'apt_apt-5' }),
      /уже в работе/,
    );
  });
});

describe('помощник отвечает только по делу', () => {
  it('посторонняя просьба до подсказки не доходит', async () => {
    let assisted = 0;

    const deps = setup({
      understand: () => Promise.resolve(undefined),
      onTopic: () => Promise.resolve(false),
      assist: () => {
        assisted += 1;

        return Promise.resolve({ answer: 'Вот код на питоне' });
      },
    });

    const answer = await askAssistant(deps, maria, 'напиши калькулятор на питоне');

    assert.equal(answer.offTopic, true);
    assert.match(answer.answer, /только с домом/i);
    assert.equal(answer.screen, 'support', 'живого человека предложить забыли');
    assert.equal(assisted, 0, 'посторонний вопрос всё равно ушёл в подсказку');
  });

  it('вопрос о доме проходит дальше', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      onTopic: () => Promise.resolve(true),
      assist: () => Promise.resolve({ answer: 'Откройте «Оплата».', screen: 'meters' }),
    });

    const answer = await askAssistant(deps, maria, 'где оплатить');

    assert.equal(answer.offTopic, undefined);
    assert.equal(answer.screen, 'meters');
  });

  it('модель получает устройство продукта и только свои факты человека', async () => {
    const seen: { knowledge?: string[]; facts?: string } = {};

    const deps = setup({
      understand: () => Promise.resolve(undefined),
      onTopic: () => Promise.resolve(true),
      assist: (input) => {
        seen.knowledge = input.knowledge;
        seen.facts = input.facts;

        return Promise.resolve({ answer: 'Это в разделе «Заявки».', screen: 'list' });
      },
    });

    await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });
    await createServiceRequest(deps, { resident: ivan, description: 'Не закрывается моя дверь' });

    await askAssistant(deps, maria, 'что с моей заявкой');

    assert.equal((seen.knowledge?.length ?? 0) > 5, true, 'устройство продукта модели не отдали');
    assert.match(seen.facts ?? '', /Мария/);
    assert.match(seen.facts ?? '', /Течёт кран/, 'своей заявки в фактах нет');
    assert.doesNotMatch(seen.facts ?? '', /Не закрывается моя дверь/, 'чужая квартирная заявка попала в факты');
    assert.doesNotMatch(seen.facts ?? '', /Иван/, 'в фактах оказался чужой человек');
    assert.doesNotMatch(seen.facts ?? '', /Ольга/);
  });

  it('смене помощник знает её дела: очередь, просрочку и вопросы жильцов', async () => {
    const seen: { facts?: string } = {};

    const deps = setup({
      understand: () => Promise.resolve(undefined),
      onTopic: () => Promise.resolve(true),
      assist: (input) => {
        seen.facts = input.facts;

        return Promise.resolve({ answer: 'Смотрите очередь.', screen: 'queue' });
      },
    });

    await createServiceRequest(deps, { resident: ivan, description: 'Не горит лампа в подъезде' });
    await askAssistant(deps, dispatcher, 'что сейчас по дому');

    assert.match(seen.facts ?? '', /Дела смены/, 'дел смены в фактах нет');
    assert.match(seen.facts ?? '', /Сейчас: открыто/, 'очередь в факты не попала');
  });

  it('помощник знает о доме то же, что человек видит на экране', async () => {
    const seen: { facts?: string } = {};

    const deps = setup({
      understand: () => Promise.resolve(undefined),
      onTopic: () => Promise.resolve(true),
      assist: (input) => {
        seen.facts = input.facts;

        return Promise.resolve({ answer: 'Уже чиним.', screen: 'list' });
      },
    });

    const outage = await createServiceRequest(deps, {
      resident: ivan,
      description: 'Нет горячей воды во всём доме',
      category: 'plumbing',
      startParam: `bld_${BUILDING_ID}`,
    });

    await askAssistant(deps, maria, 'почему нет воды');

    assert.match(seen.facts ?? '', new RegExp(outage.number), 'об открытой заявке дома помощник не знает');
    assert.match(seen.facts ?? '', /Контакты дома/, 'контактов дома в фактах нет');
  });
});
