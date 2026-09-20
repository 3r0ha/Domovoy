import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Language } from '@domovoy/i18n';

import {
  InMemoryRepository,
  answerSupport,
  asRequest,
  askSupport,
  commentRequest,
  createCollectingNotifier,
  isRussianText,
  submitProblem,
  translationNote,
  withOriginal,
  type AppDeps,
  type Resident,
  type TextTranslator,
} from '../dist/index.js';

const BUILDING_ID = 'b1';
const NOW = new Date('2026-09-20T10:00:00Z');

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 },
  { id: 'apt-2', buildingId: BUILDING_ID, number: 2, entrance: 1, riser: 2 },
];

/** Жилец, который пишет по-узбекски: продукт говорит с ним на его языке. */
const anvar: Resident = {
  id: 'res-anvar',
  maxUserId: 1001,
  displayName: 'Анвар',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
  language: 'uz',
};

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1002,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
  language: 'ru',
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

interface Call {
  text: string;
  to: Language;
  from?: Language;
}

/** Служба перевода в тестах: запоминает обращения и отвечает подставным переводом. */
const fakeTranslator = (
  answer: (text: string, to: Language) => string | undefined = (text, to) => `[${to}] ${text}`,
): { calls: Call[]; translate: TextTranslator } => {
  const calls: Call[] = [];

  return {
    calls,
    translate: {
      model: true,
      async translate(text, to, from) {
        calls.push({ text, to, ...(from ? { from } : {}) });

        return answer(text, to);
      },
    },
  };
};

const setup = (translate?: TextTranslator): AppDeps & { notifier: ReturnType<typeof createCollectingNotifier> } => {
  let counter = 0;
  const notifier = createCollectingNotifier();

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: APARTMENTS,
      residents: [anvar, maria, dispatcher],
    }),
    now: () => NOW,
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    notifier,
    ...(translate ? { translate } : {}),
  };
};

describe('язык написанного своими словами', () => {
  it('русский текст узнаётся, а чужие буквы выдают другой язык', () => {
    assert.equal(isRussianText('В подъезде не горит свет'), true);
    assert.equal(isRussianText('Подъезд 2, кв. 15'), true);
    assert.equal(isRussianText('Podyezdda chiroq yonmayapti'), false);
    assert.equal(isRussianText('Ҳовлида чироқ йўқ'), false);
    assert.equal(isRussianText('电梯坏了'), false);
  });

  it('пометка о переводе написана по-русски: смена работает на русском', () => {
    assert.equal(translationNote('uz'), 'Перевод с узбекского');
    assert.match(withOriginal('Не горит свет', { text: 'Chiroq yo‘q', language: 'uz' }), /Перевод с узбекского/u);
    assert.match(withOriginal('Не горит свет', { text: 'Chiroq yo‘q', language: 'uz' }), /Chiroq yo‘q/u);
    assert.equal(withOriginal('Не горит свет', undefined), 'Не горит свет');
  });
});

describe('обращение не по-русски', () => {
  it('до смены доходит по-русски, а оригинал остаётся при заявке', async () => {
    const { calls, translate } = fakeTranslator(() => 'В подъезде не горит свет');
    const deps = setup(translate);

    const result = asRequest(
      await submitProblem(deps, { resident: anvar, description: 'Podyezdda chiroq yonmayapti' }),
    );

    assert.equal(calls.length, 1, 'перевод спрашивают один раз');
    assert.equal(calls[0]?.to, 'ru');
    assert.equal(calls[0]?.from, 'uz');

    assert.equal(result.request.description, 'В подъезде не горит свет');
    assert.deepEqual(result.request.original, {
      text: 'Podyezdda chiroq yonmayapti',
      language: 'uz',
    });
  });

  it('смена видит перевод, пометку о нём и сам оригинал', async () => {
    const { translate } = fakeTranslator(() => 'В подъезде не горит свет');
    const deps = setup(translate);

    await submitProblem(deps, { resident: anvar, description: 'Podyezdda chiroq yonmayapti' });

    const toStaff = deps.notifier.sent.find((message) => message.maxUserId === dispatcher.maxUserId);

    assert.match(toStaff?.text ?? '', /В подъезде не горит свет/u);
    assert.match(toStaff?.text ?? '', /Перевод с узбекского/u);
    assert.match(toStaff?.text ?? '', /Podyezdda chiroq yonmayapti/u);
  });

  it('отказ службы перевода оставляет исходный текст и заявку не роняет', async () => {
    const { calls, translate } = fakeTranslator(() => {
      throw new Error('служба недоступна');
    });
    const deps = setup(translate);

    const result = asRequest(
      await submitProblem(deps, { resident: anvar, description: 'Podyezdda chiroq yonmayapti' }),
    );

    assert.equal(calls.length, 1);
    assert.equal(result.kind, 'created');
    assert.equal(result.request.description, 'Podyezdda chiroq yonmayapti');
    assert.equal(result.request.original, undefined, 'переводить оказалось нечем, оригинал один');
  });

  it('пустой ответ службы перевода тоже не отменяет заявку', async () => {
    const { translate } = fakeTranslator(() => undefined);
    const deps = setup(translate);

    const result = asRequest(
      await submitProblem(deps, { resident: anvar, description: 'Podyezdda chiroq yonmayapti' }),
    );

    assert.equal(result.request.description, 'Podyezdda chiroq yonmayapti');
    assert.equal(result.request.original, undefined);
  });

  it('русскому жильцу модель не нужна', async () => {
    const { calls, translate } = fakeTranslator();
    const deps = setup(translate);

    const result = asRequest(await submitProblem(deps, { resident: maria, description: 'Течёт кран на кухне' }));

    assert.equal(calls.length, 0, 'лишних обращений к модели нет');
    assert.equal(result.request.description, 'Течёт кран на кухне');
    assert.equal(result.request.original, undefined);
  });

  it('русский текст от нерусского жильца переводить незачем', async () => {
    const { calls, translate } = fakeTranslator();
    const deps = setup(translate);

    await submitProblem(deps, { resident: anvar, description: 'Течёт кран на кухне' });

    assert.equal(calls.length, 0);
  });

  it('без службы перевода продукт работает как раньше', async () => {
    const deps = setup();

    const result = asRequest(
      await submitProblem(deps, { resident: anvar, description: 'Podyezdda chiroq yonmayapti' }),
    );

    assert.equal(result.request.description, 'Podyezdda chiroq yonmayapti');
    assert.equal(result.request.original, undefined);
  });
});

describe('переписка по заявке', () => {
  it('ответ смены доходит до жильца на его языке', async () => {
    const { translate } = fakeTranslator((text, to) => (to === 'ru' ? 'В подъезде не горит свет' : `[uz] ${text}`));
    const deps = setup(translate);

    const result = asRequest(
      await submitProblem(deps, { resident: anvar, description: 'Podyezdda chiroq yonmayapti' }),
    );

    deps.notifier.sent.length = 0;

    await commentRequest(deps, {
      resident: dispatcher,
      requestId: result.request.id,
      text: 'Мастер придёт сегодня до 18:00.',
    });

    const toResident = deps.notifier.sent.find((message) => message.maxUserId === anvar.maxUserId);

    assert.match(toResident?.text ?? '', /\[uz\] Мастер придёт сегодня до 18:00\./u);
  });

  it('сообщение жильца доходит до смены по-русски, с пометкой и оригиналом', async () => {
    const { translate } = fakeTranslator((text, to) => (to === 'ru' ? `по-русски: ${text}` : `[${to}] ${text}`));
    const deps = setup(translate);

    const result = asRequest(await submitProblem(deps, { resident: anvar, description: 'Течёт кран на кухне' }));

    deps.notifier.sent.length = 0;

    const saved = await commentRequest(deps, {
      resident: anvar,
      requestId: result.request.id,
      text: 'Hali ham oqmoqda',
    });

    const message = saved.history.at(-1);

    assert.equal(message?.comment, 'по-русски: Hali ham oqmoqda');
    assert.deepEqual(message?.original, { text: 'Hali ham oqmoqda', language: 'uz' });

    const toStaff = deps.notifier.sent.find((sent) => sent.maxUserId === dispatcher.maxUserId);

    assert.match(toStaff?.text ?? '', /по-русски: Hali ham oqmoqda/u);
    assert.match(toStaff?.text ?? '', /Перевод с узбекского/u);
    assert.match(toStaff?.text ?? '', /Hali ham oqmoqda/u);
  });
});

describe('поддержка', () => {
  it('вопрос доходит до смены по-русски, ответ возвращается на языке жильца', async () => {
    const { translate } = fakeTranslator((text, to) =>
      to === 'ru' ? 'Когда включат отопление?' : `[${to}] ${text}`,
    );
    const deps = setup(translate);

    const ticket = await askSupport(deps, { resident: anvar, text: 'Isitish qachon yoqiladi?' });

    assert.equal(ticket.messages[0]?.text, 'Когда включат отопление?');
    assert.deepEqual(ticket.messages[0]?.original, { text: 'Isitish qachon yoqiladi?', language: 'uz' });

    const toStaff = deps.notifier.sent.find((sent) => sent.maxUserId === dispatcher.maxUserId);

    assert.match(toStaff?.text ?? '', /Перевод с узбекского/u);

    deps.notifier.sent.length = 0;

    await answerSupport(deps, { staff: dispatcher, ticketId: ticket.id, text: 'Тепло подадим 25 сентября.' });

    const toResident = deps.notifier.sent.find((sent) => sent.maxUserId === anvar.maxUserId);

    assert.match(toResident?.text ?? '', /\[uz\] Тепло подадим 25 сентября\./u);
  });
});
