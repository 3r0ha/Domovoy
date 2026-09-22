import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  InMemoryRepository,
  askAssistant,
  classifyIntent,
  clarifyTarget,
  createServiceRequest,
  submitProblem,
  understandRequest,
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

const setup = (reasoner?: Reasoner): AppDeps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15', managementCompany: 'УК «Ленинская»' }],
      apartments: [
        { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 },
        { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 2, riser: 1, area: 50 },
      ],
      residents: [maria],
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

/** Ответ модели приходит из-за границы продукта: поля в нём бывают любыми. */
const answering = (fields: Record<string, unknown>): Reasoner => ({
  understand: () => Promise.resolve(fields),
});

describe('неровный ответ модели о поломке', () => {
  it('разметка, кавычки и чужой регистр в полях читаются', async () => {
    const read = await understandRequest(
      'Течёт труба',
      answering({
        category: '**Plumbing**',
        priority: '«EMERGENCY»',
        place: '"apartment"',
        title: '«Течёт труба»',
      }),
    );

    assert.equal(read.category, 'plumbing');
    assert.equal(read.priority, 'emergency');
    assert.equal(read.place, 'apartment');
    assert.equal(read.title, 'Течёт труба');
  });

  it('имя поля перед значением значения не портит', async () => {
    const read = await understandRequest('Не работает лифт', answering({ category: 'category: elevator' }));

    assert.equal(read.category, 'elevator');
  });

  it('переведённые значения полей понимаются', async () => {
    const read = await understandRequest(
      'В подъезде разбито стекло',
      answering({ priority: 'аварийная', place: 'подъезд' }),
    );

    assert.equal(read.priority, 'emergency');
    assert.equal(read.place, 'entrance');
  });

  it('«нет» строкой это тот же отказ, что и false', async () => {
    const read = await understandRequest('Труба', answering({ enough: 'false', question: 'Что с трубой?' }));

    assert.equal(read.unclear, true);
    assert.equal(read.question, 'Что с трубой?');
  });

  it('ответ не строкой сценарий не роняет', async () => {
    const read = await understandRequest('Не работает лифт', answering({ category: 7, title: { a: 1 }, question: [] }));

    assert.equal(read.category, 'elevator');
    assert.equal(read.title, undefined);
    assert.equal(read.question, undefined);
  });

  it('код оборудования с названием рядом ведёт к настоящему объекту', async () => {
    const deps = setup({
      understand: () => Promise.resolve({ category: 'elevator', equipment: 'lift-2 (Лифт, подъезд 2)' }),
    });

    const result = await submitProblem(deps, { resident: maria, description: 'Застрял лифт во втором подъезде' });

    assert.deepEqual(result.kind === 'created' ? result.request.target : undefined, {
      kind: 'equipment',
      buildingId: BUILDING_ID,
      equipmentId: 'lift-2',
      title: 'Лифт, подъезд 2',
    });
  });

  it('молчание модели заявку не задерживает', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      route: () => Promise.resolve(undefined),
      intent: () => Promise.resolve(undefined),
    });

    const result = await submitProblem(deps, { resident: maria, description: 'Течёт кран на кухне' });

    assert.equal(result.kind, 'created');
    assert.equal(result.kind === 'created' ? result.request.category : undefined, 'plumbing');
  });

  it('отказ службы оставляет разбор по ключевым словам', async () => {
    const deps = setup({
      understand: () => Promise.reject(new Error('служба недоступна')),
      route: () => Promise.reject(new Error('служба недоступна')),
      intent: () => Promise.reject(new Error('служба недоступна')),
    });

    const result = await submitProblem(deps, { resident: maria, description: 'Не работает лифт' });

    assert.equal(result.kind, 'created');
    assert.equal(result.kind === 'created' ? result.request.category : undefined, 'elevator');
  });
});

describe('намерение из неровного ответа', () => {
  it('разметка и перевод значения не мешают', async () => {
    const marked = await classifyIntent('сколько я должна', {
      understand: () => Promise.resolve(undefined),
      intent: () => Promise.resolve({ intent: '**question**', topic: '«bill»' }),
    });

    assert.deepEqual(marked, { intent: 'question', topic: 'bill' });

    const translated = await classifyIntent('сколько я должна', {
      understand: () => Promise.resolve(undefined),
      intent: () => Promise.resolve({ intent: 'вопрос', topic: 'квитанция' }),
    });

    assert.deepEqual(translated, { intent: 'question', topic: 'bill' });
  });
});

describe('одно слово вместо обращения', () => {
  it('название раздела уводит из заявок, а не в меню', async () => {
    const deps = setup();

    for (const said of ['язык', 'счета', 'татарча', 'ru', 'English']) {
      const result = await submitProblem(deps, { resident: maria, description: said });

      assert.equal(result.kind, 'answered', `«${said}» стало заявкой`);
    }
  });

  it('названная вещь без беды остаётся обращением', async () => {
    const deps = setup();

    const result = await submitProblem(deps, { resident: maria, description: 'труба' });

    assert.equal(result.kind, 'created');
  });

  it('названная вещь с моделью превращается в вопрос, а не в заявку', async () => {
    const deps = setup({
      understand: () => Promise.resolve({ enough: false, question: 'Что случилось с трубой?' }),
      route: () => Promise.resolve({ kind: 'breakdown' }),
    });

    const result = await submitProblem(deps, { resident: maria, description: 'труба' });

    assert.equal(result.kind, 'unclear');
    assert.equal(result.kind === 'unclear' ? result.question : '', 'Что случилось с трубой?');
  });

  it('раздел из ответа модели сверяется с разделами роли, а не берётся на веру', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      route: () => Promise.resolve({ kind: 'elsewhere', screen: 'магазин' }),
      assist: () => Promise.resolve({ answer: 'Язык меняется в разделе «Язык продукта».', screen: 'language' }),
      onTopic: () => Promise.resolve(true),
    });

    const result = await submitProblem(deps, { resident: maria, description: 'язык' });

    assert.equal(result.kind, 'answered', 'раздел назван неверно, а просьба ушла в заявку');
  });
});

describe('просьба на чужом языке', () => {
  it('ответ идёт на языке вопроса', async () => {
    const seen: { language?: string } = {};

    const deps = setup({
      understand: () => Promise.resolve(undefined),
      onTopic: () => Promise.resolve(true),
      assist: (input) => {
        seen.language = input.language;

        return Promise.resolve({ answer: 'Open the door in the «Home» section.', screen: 'home', language: 'EN' });
      },
    });

    const answer = await askAssistant(deps, maria, 'I want to open the door');

    assert.equal(seen.language, 'en', 'модель просили ответить не на языке вопроса');
    assert.equal(answer.screen, 'home');
    assert.equal(answer.offerLanguage, 'en');
  });

  it('язык называет модель, когда слова его не выдали', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      onTopic: () => Promise.resolve(true),
      assist: () => Promise.resolve({ answer: 'Eshikni «Uy» boʻlimida ochasiz.', screen: 'home', language: '«uz»' }),
    });

    const answer = await askAssistant(deps, maria, 'eshikni och iltimos');

    assert.equal(answer.offerLanguage, 'uz');
    assert.equal(answer.by, 'model');
  });

  it('просьба на чужом языке посторонней не считается', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      route: () => Promise.resolve({ kind: 'elsewhere', screen: 'home' }),
      onTopic: () => Promise.resolve(true),
      assist: () => Promise.resolve({ answer: 'Open the door in the «Home» section.', screen: 'home' }),
    });

    const result = await submitProblem(deps, { resident: maria, description: 'I want to open the door' });

    assert.equal(result.kind, 'answered');
    assert.deepEqual(await deps.repository.listRequests({ authorId: maria.id }), []);
  });
});

describe('неровный ответ помощника', () => {
  it('разметка и кавычки из ответа снимаются, а раздел узнаётся', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      onTopic: () => Promise.resolve(true),
      assist: () =>
        Promise.resolve({ answer: '**Откройте раздел «Показания и квитанция»**', screen: '«Meters»' }),
    });

    const answer = await askAssistant(deps, maria, 'где передать показания');

    assert.equal(answer.answer, 'Откройте раздел «Показания и квитанция»');
    assert.equal(answer.screen, 'meters');
    assert.equal(answer.by, 'model');
  });

  it('ответ не строкой оставляет подбор по словам', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      onTopic: () => Promise.resolve(true),
      assist: () => Promise.resolve({ answer: 42 as never, screen: 'meters' }),
    });

    const answer = await askAssistant(deps, maria, 'где передать показания');

    assert.equal(answer.by, 'keywords');
    assert.equal(answer.screen, 'meters');
  });

  it('молчание модели оставляет человека с ответом', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      onTopic: () => Promise.resolve(undefined),
      assist: () => Promise.resolve(undefined),
    });

    const answer = await askAssistant(deps, maria, 'где передать показания');

    assert.equal(answer.by, 'keywords');
    assert.equal(answer.screen, 'meters');
    assert.ok(answer.answer.length > 0);
  });

  it('таймаут службы ответ не задерживает', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      onTopic: () => Promise.reject(new Error('превышено время ожидания')),
      assist: () => Promise.reject(new Error('превышено время ожидания')),
    });

    const answer = await askAssistant(deps, maria, 'как открыть дверь подъезда');

    assert.equal(answer.by, 'keywords');
    assert.equal(answer.screen, 'home');
  });
});

describe('проверка сказанного', () => {
  it('узнанное продуктом слово модель отпиской не объявит', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      meaningful: () => Promise.resolve(false),
    });

    for (const said of ['капитальный ремонт', 'татарча', 'счета']) {
      const result = await submitProblem(deps, { resident: maria, description: said });

      assert.equal(result.kind, 'answered', `«${said}» отбили как отписку`);
    }
  });

  it('молчание модели о смысле обращение не задерживает', async () => {
    const deps = setup({
      understand: () => Promise.resolve(undefined),
      meaningful: () => Promise.resolve(undefined),
    });

    const result = await submitProblem(deps, { resident: maria, description: 'засор' });

    assert.equal(result.kind, 'created');
  });
});

describe('уточняющий вопрос об адресе', () => {
  it('идёт на языке жильца, а подписи кнопок берутся у дома', async () => {
    const seen: { language?: string; candidates?: string[] } = {};

    const deps = setup({
      understand: () => Promise.resolve(undefined),
      clarify: (input) => {
        seen.language = input.language;
        seen.candidates = input.candidates;

        // Подписи модель отдаёт в кавычках и с разметкой, а выбирает из списка.
        return Promise.resolve({
          question: '«Кайсы подъездда?»',
          choices: ['**Лифт, подъезд 2**', 'Выдуманный объект'],
        });
      },
    });

    const tatar: Resident = { ...maria, language: 'tt' };
    const request = await createServiceRequest(deps, { resident: tatar, description: 'Лифт не работает' });
    const asked = await clarifyTarget(deps, tatar, request);

    assert.equal(seen.language, 'tt');
    assert.ok((seen.candidates ?? []).includes('Лифт, подъезд 2'));
    assert.equal(asked?.question, 'Кайсы подъездда?');
    assert.deepEqual(
      asked?.options.map((option) => option.label),
      ['Лифт, подъезд 2'],
      'выдуманный объект стал кнопкой',
    );
  });
});
