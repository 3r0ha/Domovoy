import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError, type PlannedWork, type ServiceRequest } from '@domovoy/domain';
import { dictionaryFor, translator, type Dictionary } from '@domovoy/i18n';

import {
  InMemoryRepository,
  askAssistant,
  errorTextFor,
  formatStatusChange,
  formatWorksFinished,
  languageOfText,
  speakDefault,
  type AppDeps,
  type AssistInput,
  type Reasoner,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-22T10:00:00Z');

/** Узбекский словарь размером с проверку: остального нет, и оно падает в русский. */
const UZBEK: Dictionary = {
  'app.notice.status': '{номер}-ariza {состояние}.\n{суть}\n{место}.',
  'app.notice.statusOf.in_progress': 'bajarilmoqda',
  'app.category.plumbing': 'Suv ta’minoti va kanalizatsiya',
  'app.notice.worksFinished': 'Rejali ishlar tugadi: {название}, {адресаты}.',
  'app.error.too_many_requests': 'Bir soatda juda koʻp ariza. Keyingi soatda davom etamiz',
};

/** Русский словарь настоящий: на него падает всё, чего в узбекском нет. */
const RUSSIAN = dictionaryFor('ru');

const uzbek = translator('uz', { dictionaries: { ru: RUSSIAN, uz: UZBEK } });

const request: ServiceRequest = {
  id: 'req-1',
  number: 'Д15-2609-0001',
  buildingId: BUILDING_ID,
  authorId: 'res-1',
  category: 'plumbing',
  priority: 'normal',
  target: { kind: 'riser', buildingId: BUILDING_ID, entrance: 1, riser: 2 },
  title: 'Нет горячей воды',
  description: 'Нет горячей воды со вчерашнего вечера',
  status: 'in_progress',
  createdAt: NOW,
  reactionDueAt: NOW,
  resolutionDueAt: NOW,
  history: [],
  attachments: [],
  joinedBy: [],
  notAffected: [],
  reopenCount: 0,
};

const work: PlannedWork = {
  id: 'ann-1',
  title: 'Замена задвижки',
  category: 'plumbing',
  audience: { kind: 'building', buildingId: BUILDING_ID },
  from: NOW,
  until: new Date('2026-09-22T14:00:00Z'),
};

describe('уведомления на языке жильца', () => {
  it('берут строку из словаря языка, а не переводят русскую', () => {
    const text = formatWorksFinished(uzbek, work);

    assert.equal(text, 'Rejali ishlar tugadi: Замена задвижки, весь дом.');
  });

  it('переводят и название категории внутри уведомления', () => {
    const text = formatStatusChange(uzbek, request);

    assert.match(text, /^Д15-2609-0001-ariza bajarilmoqda\./);
    assert.match(text, /Suv ta’minoti va kanalizatsiya, подъезд 1, стояк 2\./);
  });

  it('без своей строки остаётся русская: человек видит текст, а не ключ', () => {
    const text = formatWorksFinished(translator('uz', { dictionaries: { ru: RUSSIAN } }), work);

    assert.match(text, /^Плановые работы завершены по графику/);
  });
});

describe('отказ словами человека', () => {
  it('переводится по коду', () => {
    const error = new DomainError('too_many_requests', 'Слишком много заявок за час. Продолжим в следующем часе');

    assert.equal(errorTextFor(uzbek, error), 'Bir soatda juda koʻp ariza. Keyingi soatda davom etamiz');
    assert.equal(errorTextFor(speakDefault(), error), 'Слишком много заявок за час. Продолжим в следующем часе');
  });

  it('без ключа отдаёт сообщение ошибки как есть', () => {
    const error = new DomainError('bad_works', 'Работы заданы неверно');

    assert.equal(errorTextFor(uzbek, error), 'Работы заданы неверно');
  });

  it('чужую ошибку не выдаёт за отказ продукта', () => {
    assert.equal(errorTextFor(uzbek, new Error('сеть недоступна')), 'сеть недоступна');
  });
});

describe('помощник и язык человека', () => {
  const uzbekResident: Resident = {
    id: 'res-1',
    maxUserId: 1001,
    displayName: 'Ulugʻbek',
    role: 'resident',
    apartmentId: 'apt-1',
    buildingId: BUILDING_ID,
    language: 'uz',
  };

  const setup = (asked: AssistInput[]): AppDeps => {
    const reasoner: Reasoner = {
      async understand() {
        return undefined;
      },
      async assist(input) {
        asked.push(input);
        return { answer: 'Hisoblagich koʻrsatkichlarini «Hisoblagichlar» boʻlimida topshiring.' };
      },
    };

    return {
      repository: new InMemoryRepository({
        buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
        apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
        residents: [uzbekResident],
      }),
      now: () => NOW,
      createId: () => 'id-1',
      defaultBuildingId: BUILDING_ID,
      reasoner,
    };
  };

  it('просит модель отвечать на языке человека', async () => {
    const asked: AssistInput[] = [];

    await askAssistant(setup(asked), uzbekResident, 'Hisoblagichlarni qayerda topshiraman?');

    const input = asked[0];

    assert.ok(input, 'модель не спросили');
    assert.equal(input.language, 'uz');
    assert.ok(
      input.knowledge?.some((line) => line.includes('Oʻzbekcha')),
      'языка нет в самом запросе к модели',
    );
    assert.ok(
      input.knowledge?.some((line) => line.includes('на котором задан вопрос')),
      'модель не просят держаться языка вопроса',
    );
  });

  it('русскому называет русский: на нём продукт и отвечает, если язык вопроса непонятен', async () => {
    const asked: AssistInput[] = [];

    await askAssistant(setup(asked), { ...uzbekResident, language: 'ru' }, 'Где передать показания счётчиков?');

    assert.equal(asked[0]?.language, 'ru');
    assert.ok(asked[0]?.knowledge?.some((line) => line.includes('Русский')));
  });
});

describe('язык вопроса', () => {
  const setup = (): AppDeps => ({
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }],
      residents: [],
    }),
    now: () => NOW,
    createId: () => 'id-1',
    defaultBuildingId: BUILDING_ID,
  });

  const russian: Resident = {
    id: 'res-1',
    maxUserId: 1001,
    displayName: 'Мария',
    role: 'resident',
    apartmentId: 'apt-1',
    buildingId: BUILDING_ID,
    language: 'ru',
  };

  it('узнаётся по буквам и по частым словам', () => {
    assert.equal(languageOfText('Hisoblagichlarni qayerda toʻlayman?'), 'uz');
    assert.equal(languageOfText('Где передать показания?'), 'ru');
    assert.equal(languageOfText('How do I pay the bill?'), 'en');
    assert.equal(languageOfText('Ինչպես վճարել'), 'hy');
    assert.equal(languageOfText('როგორ გადავიხადო'), 'ka');
    assert.equal(languageOfText('如何支付账单'), 'zh');
    assert.equal(languageOfText('Cum plătesc factura'), 'ro');
    assert.equal(languageOfText('12345'), undefined, 'по цифрам язык не угадывается');
  });

  it('вопрос на чужом языке предлагает перейти на него', async () => {
    const answer = await askAssistant(setup(), russian, 'Hisoblagichlarni qayerda toʻlayman?');

    assert.equal(answer.offerLanguage, 'uz');
    assert.equal(answer.offerTitle, 'Oʻzbekcha tilida gaplashish', 'подпись кнопки на том языке, на который зовут');
    assert.match(answer.answer, /Oʻzbekcha/, 'о переходе на язык в ответе не сказано');
  });

  it('тот же вопрос на своём языке предложения не содержит', async () => {
    const answer = await askAssistant(setup(), { ...russian, language: 'uz' }, 'Hisoblagichlarni qayerda toʻlayman?');

    assert.equal(answer.offerLanguage, undefined);
    assert.equal(answer.offerTitle, undefined);
  });

  it('незнакомый язык вопроса ничего не предлагает', async () => {
    const answer = await askAssistant(setup(), russian, 'Wie bezahle ich die Rechnung?');

    assert.equal(answer.offerLanguage, undefined);
  });

  it('просьба сменить язык ведёт к выбору языка на любом из наших языков', async () => {
    const deps = setup();

    for (const said of ['сменить язык', 'change language', 'tilni oʻzgartirish', 'ენის შეცვლა']) {
      const answer = await askAssistant(deps, russian, said);

      assert.equal(answer.screen, 'language', `«${said}» не ведёт к выбору языка`);
      assert.equal(answer.command, '/lang');
    }
  });
});
