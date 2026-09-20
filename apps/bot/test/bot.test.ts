import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import {
  InMemoryRepository,
  announceIncident,
  announceResolved,
  createMockHub,
  createMockPayments,
  createServiceRequest,
  receptionFor,
  takeVisit,
  publishAnnouncement,
  startPoll,
  transitionRequest,
  updateBuilding,
  type AppDeps,
  type Device,
  type MeterVision,
  type Resident,
  type Transcriber,
} from '@domovoy/app';
import { DomainError, LEGAL_VERSION, apartmentKeyParam, encodeTarget } from '@domovoy/domain';
import { type MockPlatform, type SentMessage, startMockPlatform } from '@maxkit/platform-mock';
import { MemoryMarkerStore, type MarkerStore } from '@maxkit/runtime';

import { createDomovoyBot } from '../dist/index.js';
import { RU } from '../dist/i18n.js';
import { menuFor } from '../dist/menu.js';

const MINI_APP = 'https://domovoy.homes/app';

/** Диспетчер для проверок «дел словами»: он ведёт заявку до сдачи работы. */
const DISPATCHER_FOR_WORDS: Resident = {
  id: 'disp-for-words',
  maxUserId: 5033,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: 'b1',
};

/** Заявка доведена до сдачи работы: дальше её принимает жилец. */
const untilDoneBy = async (deps: AppDeps, staff: Resident, id: string): Promise<void> => {
  await transitionRequest(deps, { resident: staff, requestId: id, to: 'accepted' });
  await transitionRequest(deps, { resident: staff, requestId: id, to: 'in_progress', assigneeId: staff.id });
  await transitionRequest(deps, { resident: staff, requestId: id, to: 'done', comment: 'Лампа заменена' });
};

const TOKEN = 'domovoy-bot-token';
const BUILDING_ID = 'b1';

/** Код первой квартиры из квитанции. */
const FLAT_CODE = 'ACEFHK34';

const APARTMENTS = [
  { id: 'apt-1', buildingId: BUILDING_ID, code: FLAT_CODE, number: 1, entrance: 1, riser: 1, area: 40 },
  { id: 'apt-2', buildingId: BUILDING_ID, code: 'LMNPRT47', number: 2, entrance: 1, riser: 2 },
  { id: 'apt-3', buildingId: BUILDING_ID, code: 'UVWXY349', number: 3, entrance: 1, riser: 1 },
];

const RESIDENT_WITH_FLAT: Resident = {
  id: 'res-1',
  maxUserId: 3003,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

/** Сосед из второй квартиры: он привязан, поэтому по наклейке сразу к делу. */
const NEIGHBOUR_WITH_FLAT: Resident = {
  id: 'res-2',
  maxUserId: 4004,
  displayName: 'Пётр',
  role: 'resident',
  apartmentId: 'apt-2',
  buildingId: BUILDING_ID,
};

/** Жилец без квартиры, документы уже принял: продукт ждёт от него только код. */
const UNBOUND_RESIDENT: Resident = {
  id: 'res-unbound',
  maxUserId: 3011,
  displayName: 'Пётр',
  role: 'resident',
};

describe('чат-бот управляющей компании', () => {
  let platform: MockPlatform;

  before(async () => {
    platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 100 });
  });

  after(async () => {
    await platform.stop();
  });

  beforeEach(() => {
    platform.reset();
  });

  /** Боты, запущенные тестом. */
  const running = new Set<{ stop: () => Promise<void> }>();

  afterEach(async () => {
    for (const bot of running) await bot.stop();
    running.clear();

    // Метка разметки служебная: дойдя до человека, она осталась бы в тексте.
    const leaked = platform.outgoing.find((message) => message.text.includes('⁠'));

    assert.equal(leaked, undefined, `метка разметки ушла человеку: ${leaked?.text ?? ''}`);
  });

  /**
   * Текст без знаков разметки: жирное человек видит начертанием, а проверять
   * сообщения удобнее по словам, а не по звёздочкам вокруг них.
   */
  const said = (text: string): string => text.replace(/\*\*/gu, '');

  /** Кнопка дела: её метка живёт одно предложение, поэтому читается из экрана. */
  const doingButton = (recipient: number, at = 0): string => {
    const keyboard = JSON.stringify(
      platform.outgoing.findLast((message) => message.chatId === recipient)?.attachments ?? [],
    );

    const found = [...keyboard.matchAll(/"payload":"(do:[^"]+)"/gu)].map((match) => match[1]!);

    if (found.length === 0) throw new Error(`в экране нет кнопки дела: ${keyboard}`);

    return found[at] ?? found[0]!;
  };

  /** Ждёт, пока сообщение уберут из переписки: удаление идёт после ответа. */
  const untilGone = async (pattern: RegExp, timeoutMs = 6000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const left = platform.outgoing.filter((message) => pattern.test(said(message.text)));

      if (left.length === 0) return;

      if (Date.now() > deadline) {
        throw new Error(`«${pattern.source}» осталось в переписке: ${left.length}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  /** Ждёт сообщение по смыслу, а не по порядковому номеру. */
  const waitForMessage = async (recipient: number, pattern: RegExp, timeoutMs = 6000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const found = platform.outgoing.filter(
        (message) =>
          (message.userId === recipient || message.chatId === recipient) && pattern.test(said(message.text)),
      );

      if (found.length > 0) return said(found.at(-1)!.text);

      if (Date.now() > deadline) {
        // В ошибку идёт то, что бот сказал на самом деле: иначе причина
        // провалившегося ожидания ищется запуском с отладкой.
        const said = platform.outgoing
          .filter((message) => message.userId === recipient || message.chatId === recipient)
          .map((message) => message.text)
          .slice(-3)
          .join(' | ');

        throw new Error(`Не дождались «${pattern.source}» для ${recipient}. Бот сказал: ${said}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  /** Первый разговор начинается с выбора языка: дальше продукт говорит на нём. */
  const chooseLanguage = async (userId: number, chatId: number, code = 'ru'): Promise<void> => {
    await waitForMessage(chatId, /Choose your language/);

    platform.userPressesButton(`lang:${code}`, { userId, chatId });
  };

  /** Ждёт всплывающее уведомление на нажатие кнопки. */
  const waitForToast = async (pattern: RegExp, timeoutMs = 6000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const found = platform.answers.filter((answer) => pattern.test(answer.notification ?? ''));

      if (found.length > 0) return found.at(-1)!.notification!;
      if (Date.now() > deadline) throw new Error(`Не дождались уведомления «${pattern.source}»`);

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  /** Клавиатура следующего сообщения: кнопки приходят вложением к нему. */
  /** Последнее, что человек видит: нажатие кнопки правит это сообщение на месте. */
  const shownTo = (recipient: number): SentMessage | undefined =>
    platform.outgoing.findLast((message) => message.userId === recipient || message.chatId === recipient);

  const waitForKeyboard = async (recipient: number, timeoutMs = 3000): Promise<unknown> => {
    const before = JSON.stringify(shownTo(recipient) ?? null);
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const shown = shownTo(recipient);

      if (shown && shown.attachments.length > 0 && JSON.stringify(shown) !== before) return shown.attachments;
      if (Date.now() > deadline) throw new Error(`Не дождались кнопок для ${recipient}`);

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  const start = async (
    residents: Resident[] = [],
    extra: {
      transcriber?: Transcriber;
      /** Показание с фотографии табло: в проверках отвечает заглушкой. */
      vision?: MeterVision;
      onNotifyError?: (error: unknown) => void;
      /** Начало отсчёта: нужно тестам про сроки. */
      now?: () => Date;
      markerStore?: MarkerStore;
      /** Оборудование дома: домофоны и камеры за портом умного дома. */
      devices?: Device[];
      /** Режим проверки: роль примеряется прямо в переписке. */
      demo?: boolean;
      /** Разбор обращения моделью: без него категорию подсказывают ключевые слова. */
      reasoner?: AppDeps['reasoner'];
      /** Машинный перевод того, что читает весь дом. */
      machine?: AppDeps['machine'];
      /** Состояние диалога: в проверках подменяется, чтобы увидеть отказ хранилища. */
      sessionMiddleware?: (context: never, next: () => Promise<void>) => Promise<void>;
    } = {},
  ) => {
    const repository = new InMemoryRepository({
      buildings: [
        {
          id: BUILDING_ID,
          code: 'Д15',
          address: 'ул. Ленина, 15',
          partners: [{ kind: 'resource', title: 'Водоканал', categories: ['plumbing'], channel: 'email' }],
        },
      ],
      apartments: APARTMENTS,
      // Оборудование с наклейками: по этим кодам и ходят переходы из ссылок.
      equipment: [
        { buildingId: BUILDING_ID, code: 'lift-1', title: 'Лифт, подъезд 1', kind: 'lift' },
        { buildingId: BUILDING_ID, code: 'lift-2', title: 'Лифт, подъезд 2', kind: 'lift' },
        { buildingId: BUILDING_ID, code: 'domofon-1', title: 'Домофон, подъезд 1', kind: 'intercom' },
      ],
      // Согласие с документами и язык у заведённых людей уже есть: их отдельно
      // проверяет разговор с новым человеком.
      residents: residents.map((person) => ({
        ...person,
        legalVersion: LEGAL_VERSION,
        language: person.language ?? ('ru' as const),
      })),
    });

    let counter = 0;
    let clock = (extra.now ?? (() => new Date('2026-09-03T10:00:00Z')))().getTime();

    const hub = createMockHub({
      devices: extra.devices ?? [],
      now: () => new Date(clock),
      createCode: () => '123456',
    });

    const payments = createMockPayments({ now: () => new Date(clock) });

    const deps: AppDeps = {
      repository,
      now: () => new Date(clock),
      createId: () => `id-${++counter}`,
      defaultBuildingId: BUILDING_ID,
      hub,
      payments,
      botName: 'uk_bot',
      ...(extra.reasoner ? { reasoner: extra.reasoner } : {}),
      ...(extra.machine ? { machine: extra.machine } : {}),
      /** Настоящий рисунок проверяется отдельно: здесь важно, что и кому ушло. */
      stickers: {
        svg: (plan, look) => `<svg>${plan.payload}${look?.note ?? ''}</svg>`,
        sheet: (address, plans) => `<html>${address}: ${plans.length}</html>`,
      },
    };

    const { now, devices, reasoner, machine, ...botOptions } = extra;
    void now;
    void devices;
    void reasoner;
    void machine;

    // Адрес мини-приложения задан, как в бою: часть дел бот только открывает в нём.
    const created = createDomovoyBot({
      token: TOKEN,
      deps,
      baseUrl: platform.url,
      miniAppUrl: MINI_APP,
      ...botOptions,
    });
    created.bot.botInfo = await created.bot.api.getMyInfo();
    void created.supervisor.start();

    const handle = {
      repository,
      hub,
      deps: created.deps,
      /** Двигает часы продукта, не трогая настоящие. */
      advance: (ms: number) => {
        clock += ms;
      },
      stop: async () => {
        running.delete(handle);
        await created.supervisor.stop();
      },
    };

    running.add(handle);

    return handle;
  };

  it('переход по коду с наклейки спрашивает только суть проблемы', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);
    const payload = encodeTarget({ kind: 'equipment', buildingId: BUILDING_ID, equipmentId: 'lift-2' });

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 3003,
      user: { user_id: 3003, first_name: 'Мария', is_bot: false },
      payload,
    });

    const [greeting] = await platform.waitForOutgoing(1, 3000);

    assert.match(greeting?.text ?? '', /Лифт, подъезд 2/, 'у объекта человеческое название, а не код');
    assert.match(greeting?.text ?? '', /Опишите|Напишите, что случилось/);

    await bot.stop();
  });

  it('первый разговор начинается с выбора языка, и язык клиента стоит первым', async () => {
    const bot = await start();

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 5101,
      user: { user_id: 5101, first_name: 'Улугбек', is_bot: false },
      user_locale: 'uz-UZ',
    });

    // Клиент прислал узбекский: вопрос задают и на нём, третьей строкой.
    const asked = await waitForMessage(5101, /Tilni tanlang/u);

    assert.match(asked, /Выберите язык/u);
    assert.match(asked, /Choose your language/u);
    assert.doesNotMatch(asked, /персональные данные/, 'до выбора языка документы не показывают');

    const order = [
      ...JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []).matchAll(/"payload":"lang:([a-z]+)"/gu),
    ].map((match) => match[1]);

    assert.equal(order[0], 'uz', 'язык клиента стоит первым в списке');
    assert.ok(order.includes('ru') && order.includes('en'), 'остальные языки на месте');

    platform.userPressesButton('lang:uz', { userId: 5101, chatId: 5101 });

    // После выбора разговор идёт дальше: приветствие и документы на выбранном языке.
    await waitForMessage(5101, /shaxsiy maʼlumotlar/u);

    assert.equal((await bot.deps.repository.findResidentByMaxUserId(5101))?.language, 'uz');

    await bot.stop();
  });

  it('команда языка меняет язык и помечает выбранный', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/lang', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Choose your language/);

    assert.match(
      JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []),
      /✅ Русский/,
      'выбранный язык помечен',
    );

    platform.userPressesButton('lang:uz', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Til: Oʻzbekcha/u);

    assert.equal((await bot.deps.repository.findResidentByMaxUserId(3003))?.language, 'uz');

    await bot.stop();
  });

  it('в меню жильца есть смена языка', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/start', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Здравствуйте/);

    platform.userPressesButton('group:me', { userId: 3003, chatId: 3003 });

    const group = JSON.stringify((await waitForKeyboard(3003)) ?? []);

    assert.match(group, /Язык/);
    assert.match(group, /"payload":"menu:lang"/);

    await bot.stop();
  });

  it('новичку по наклейке сначала документы и код квартиры, а объект ждёт привязки', async () => {
    const bot = await start();
    const payload = encodeTarget({ kind: 'equipment', buildingId: BUILDING_ID, equipmentId: 'lift-2' });

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 2001,
      user: { user_id: 1001, first_name: 'Иван', is_bot: false },
      payload,
    });

    await chooseLanguage(1001, 2001);
    await waitForMessage(2001, /персональные данные/);
    assert.doesNotMatch(platform.outgoing.map((message) => message.text).join(' '), /Лифт, подъезд 2/);

    platform.userPressesButton('legal:accept', { userId: 1001, chatId: 2001 });

    const asked = await waitForMessage(2001, /код квартиры из квитанции/);

    assert.doesNotMatch(asked, /Чем помочь/);

    platform.userSends(FLAT_CODE, { userId: 1001, chatId: 2001 });

    // Экран привязки сменяется вопросом об объекте: ждём сам вопрос.
    assert.match(await waitForMessage(2001, /Лифт, подъезд 2/), /Опишите|Напишите, что случилось/);
    assert.equal((await bot.deps.repository.findResidentByMaxUserId(1001))?.apartmentId, 'apt-1');

    await bot.stop();
  });

  it('объект с наклейки чужого дома после привязки заявку не открывает', async () => {
    const bot = await start([UNBOUND_RESIDENT]);

    await bot.repository.saveBuilding({ id: 'b2', code: 'Д17', address: 'ул. Мира, 17' });
    await bot.repository.saveEquipment({ buildingId: 'b2', code: 'lift-9', title: 'Лифт, подъезд 9' });

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 3011,
      user: { user_id: 3011, first_name: 'Пётр', is_bot: false },
      payload: encodeTarget({ kind: 'equipment', buildingId: 'b2', equipmentId: 'lift-9' }),
    });

    // Документы уже приняты: сразу просьба о коде, без документов.
    const asked = await waitForMessage(3011, /код квартиры из квитанции/);

    assert.doesNotMatch(asked, /персональные данные/);

    platform.userSends(FLAT_CODE, { userId: 3011, chatId: 3011 });
    await waitForMessage(3011, /от другого дома/);

    assert.equal((await bot.deps.repository.findResidentByMaxUserId(3011))?.apartmentId, 'apt-1');
    assert.doesNotMatch(platform.outgoing.map((message) => message.text).join(' '), /Лифт, подъезд 9/);

    await bot.stop();
  });

  it('заведённое оборудование бот называет по имени', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveEquipment({ buildingId: BUILDING_ID, code: 'lift-2', title: 'Лифт, подъезд 2' });

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 3003,
      user: { user_id: 3003, first_name: 'Мария', is_bot: false },
      payload: encodeTarget({ kind: 'equipment', buildingId: BUILDING_ID, equipmentId: 'lift-2' }),
    });

    assert.match(await waitForMessage(3003, /Лифт, подъезд 2/), /Опишите|Напишите, что случилось/);

    await bot.stop();
  });

  it('следующее сообщение превращается в заявку с известным адресом', async () => {
    const bot = await start();
    const payload = encodeTarget({ kind: 'equipment', buildingId: BUILDING_ID, equipmentId: 'lift-2' });

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 2001,
      user: { user_id: 1001, first_name: 'Иван', is_bot: false },
      payload,
    });

    await chooseLanguage(1001, 2001);

    // Первый разговор начинается с документов и кода квартиры: без них продукт не записывает.
    await waitForMessage(2001, /персональные данные/);
    platform.userPressesButton('legal:accept', { userId: 1001, chatId: 2001 });
    await waitForMessage(2001, /код квартиры из квитанции/);

    platform.userSends(FLAT_CODE, { userId: 1001, chatId: 2001 });
    await waitForMessage(2001, /Лифт, подъезд 2/);

    platform.forgetOutgoing();
    platform.userSends('Застряли между этажами, кабина не двигается', { userId: 1001, chatId: 2001 });

    const confirmation = await waitForMessage(2001, /Заявка Д15/);
    assert.match(confirmation, /Заявка Д15-2609-0001 принята/);
    assert.match(confirmation, /Лифт, Лифт, подъезд 2|Лифт, подъезд 2/);
    assert.match(confirmation, /Ответим до /);
    assert.match(confirmation, /Починят до /);
    assert.match(confirmation, /нажмите кнопку связи/, 'по аварии бот говорит, что делать прямо сейчас');

    const created = await bot.deps.repository.listRequests({});
    assert.equal(created[0]?.priority, 'emergency', 'слово «застряли» подняло срочность');

    await bot.stop();
  });

  it('без кода объекта заявка создаётся по квартире жильца', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);

    platform.userSends('Течёт кран на кухне', { userId: 3003, chatId: 3003 });
    const messages = await platform.waitForOutgoing(2, 3000);

    assert.match(messages[1]?.text ?? '', /водоснабжение и канализация, квартира/i);

    await bot.stop();
  });

  it('без квартиры после согласия бот просит код одним сообщением и заявку не заводит', async () => {
    const bot = await start();

    platform.userSends('/new', { userId: 9009, chatId: 9009 });

    const documents = await waitForMessage(9009, /персональные данные/);

    assert.doesNotMatch(documents, /Аварийная служба/, 'дома нет, телефона тоже');

    platform.forgetOutgoing();
    platform.userPressesButton('legal:accept', { userId: 9009, chatId: 9009 });

    const asked = await waitForMessage(9009, /код квартиры из квитанции/);

    assert.doesNotMatch(asked, /Чем помочь|Опишите|Напишите, что случилось/);
    assert.equal(platform.outgoing.filter((message) => message.chatId === 9009).length, 1, 'сообщение одно');

    const keyboard = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

    assert.match(keyboard, /🏢 Квартира/);
    assert.doesNotMatch(keyboard, /Что сломалось|Мои обращения|Роль/);

    platform.forgetOutgoing();
    platform.userSends('Что-то сломалось', { userId: 9009, chatId: 9009 });
    await waitForMessage(9009, /Код не подошёл/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'заявка по дому целиком не завелась');

    await bot.stop();
  });

  it('без квартиры команды, кнопки, вложения и незнакомые команды получают просьбу о коде', async () => {
    const bot = await start([UNBOUND_RESIDENT]);
    const where = { userId: 3011, chatId: 3011 };

    const askedFor = async (send: () => void): Promise<void> => {
      platform.forgetOutgoing();
      send();
      await waitForMessage(3011, /код квартиры из квитанции/);
    };

    await askedFor(() => platform.userSends('/bill', where));
    await askedFor(() => platform.userSends('/contacts', where));
    await askedFor(() => platform.userSends('/news', where));
    await askedFor(() => platform.userSends('/чтоугодно', where));
    await askedFor(() => platform.userPressesButton('menu:new', where));
    await askedFor(() => platform.userPressesButton('group:money', where));
    await askedFor(() =>
      platform.pushUpdate({
        update_type: 'message_created',
        timestamp: Date.now(),
        message: {
          sender: { user_id: 3011, first_name: 'Пётр', is_bot: false },
          recipient: { chat_id: 3011, chat_type: 'dialog' },
          timestamp: Date.now(),
          body: { mid: 'mid-photo-unbound', seq: 1, attachments: [{ type: 'image', payload: { token: 'photo-token' } }] },
        },
      }),
    );

    assert.equal((await bot.deps.repository.listRequests({})).length, 0);

    // Что открыто и без квартиры: справка о привязке и свои данные.
    platform.forgetOutgoing();
    platform.userSends('/help', where);
    assert.match(await waitForMessage(3011, /Чтобы начать/), /код квартиры/);

    platform.forgetOutgoing();
    platform.userSends('/mydata', where);
    await waitForMessage(3011, /Я храню о вас/);

    // Код внутри фразы привязывает, и меню становится обычным.
    platform.forgetOutgoing();
    platform.userSends(`мой код ${FLAT_CODE}`, where);
    await waitForMessage(3011, /вы в квартире 1/);
    assert.match(JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []), /Что сломалось/);

    await bot.stop();
  });

  it('в режиме проверки непривязанному остаются квартира и роль', async () => {
    const bot = await start([UNBOUND_RESIDENT], { demo: true });

    platform.userSends('/start', { userId: 3011, chatId: 3011 });
    await waitForMessage(3011, /код квартиры из квитанции/);

    const keyboard = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

    assert.match(keyboard, /🏢 Квартира/);
    assert.match(keyboard, /👥 Роль/);
    assert.doesNotMatch(keyboard, /Что сломалось|Мои обращения/);

    platform.userSends('/demo', { userId: 3011, chatId: 3011 });
    await waitForMessage(3011, /Кем смотрим продукт/);

    await bot.stop();
  });

  it('короткая вежливость в переписке заявкой не становится', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('Здравствуйте', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Можно написать словами/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 0);

    await bot.stop();
  });

  it('рассказ о поломке в переписке становится заявкой без команды', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('Течёт кран на кухне, вода капает постоянно', { userId: 3003, chatId: 3003 });
    assert.match(await waitForMessage(3003, /принята/), /Починят до/);

    const [created] = await bot.deps.repository.listRequests({});

    assert.equal(created?.category, 'plumbing');
    assert.equal(created?.target.kind, 'apartment');

    await bot.stop();
  });

  it('показывает мои заявки', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);
    platform.userSends('Не работает розетка', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(2, 3000);

    platform.userSends('/my', { userId: 3003, chatId: 3003 });
    const messages = await platform.waitForOutgoing(3, 3000);
    const mine = messages[2];

    assert.match(mine?.text ?? '', /Д15-2609-0001/);
    assert.match(mine?.text ?? '', /новая/);
    assert.match(mine?.text ?? '', /Электричество/);
    assert.match(mine?.text ?? '', /Срок: до /, 'жилец видит, когда ждать работу');

    await bot.stop();
  });

  it('мастер получает наряды кнопками перехода, а не одним списком', async () => {
    const technician: Resident = {
      id: 'tech-1',
      maxUserId: 4004,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    const dispatcher: Resident = {
      id: 'disp-my',
      maxUserId: 5005,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, technician, dispatcher]);

    const request = await createServiceRequest(bot.deps, {
      resident: RESIDENT_WITH_FLAT,
      description: 'Течёт кран на кухне',
      category: 'plumbing',
    });

    await transitionRequest(bot.deps, { resident: dispatcher, requestId: request.id, to: 'accepted' });
    await transitionRequest(bot.deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'in_progress',
      assigneeId: technician.id,
    });

    platform.userSends('/my', { userId: 4004, chatId: 4004 });
    await waitForMessage(4004, /Срок: до /);

    const order = platform.outgoing.findLast(
      (message) => message.chatId === 4004 && message.text.includes('Течёт кран'),
    );

    assert.match(order?.text ?? '', /Течёт кран/);
    assert.match(JSON.stringify(order?.attachments ?? []), /Сдать работу/, 'наряд закрывается кнопкой');

    await bot.stop();
  });

  it('пустой список заявок объясняет, что делать дальше', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/my', { userId: 3003, chatId: 3003 });
    const [message] = await platform.waitForOutgoing(1, 3000);

    assert.match(message?.text ?? '', /Заявок пока нет/);

    await bot.stop();
  });

  it('сотрудник переводит заявку кнопкой', async () => {
    const dispatcher: Resident = {
      id: 'disp-1',
      maxUserId: 5005,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, dispatcher]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);
    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(2, 3000);

    const [request] = await bot.deps.repository.listRequests({});

    await waitForMessage(5005, /Новая заявка/);

    platform.userPressesButton(`req:${request!.id}:accepted`, { userId: 5005, chatId: 5005 });
    await waitForMessage(5005, /принята в работу/);

    const updated = await bot.deps.repository.findRequest(request!.id);
    assert.equal(updated?.status, 'accepted');

    await bot.stop();
  });

  it('автор узнаёт о переводе заявки тем же ботом', async () => {
    const dispatcher: Resident = {
      id: 'disp-2',
      maxUserId: 5006,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, dispatcher]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);
    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(2, 3000);

    const [request] = await bot.deps.repository.listRequests({});
    platform.userPressesButton(`req:${request!.id}:accepted`, { userId: 5006, chatId: 5006 });

    await platform.waitForOutgoing(4, 3000);

    const toAuthor = platform.outgoing.find((message) => message.userId === RESIDENT_WITH_FLAT.maxUserId);
    assert.match(toAuthor?.text ?? '', /принята в работу/);
    assert.match(toAuthor?.text ?? '', /Д15-2609-0001/);

    await bot.stop();
  });

  it('объявления дома читаются командой, а не только в уведомлении', async () => {
    const manager: Resident = {
      id: 'mgr-1',
      maxUserId: 7007,
      displayName: 'Управляющий',
      role: 'manager',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, manager]);

    await publishAnnouncement(bot.deps, {
      resident: manager,
      title: 'Отключение воды',
      body: 'Завтра с 9 до 14',
      entrance: 1,
      riser: 2,
    });
    await publishAnnouncement(bot.deps, { resident: manager, title: 'Собрание', body: 'В четверг во дворе' });

    platform.userSends('/news', { userId: 3003, chatId: 3003 });
    const messages = await platform.waitForOutgoing(2, 3000);

    const listing = messages[1]?.text ?? '';

    assert.match(listing, /Собрание, весь дом/);
    assert.equal(/Отключение воды/.test(listing), false, 'чужой стояк жильцу не показывается');

    await bot.stop();
  });

  it('жилец с другим языком читает объявления в переводе, а пометка одна на сообщение', async () => {
    const manager: Resident = {
      id: 'mgr-machine',
      maxUserId: 7012,
      displayName: 'Управляющий',
      role: 'manager',
      buildingId: BUILDING_ID,
    };

    const batches: string[][] = [];

    const bot = await start([{ ...RESIDENT_WITH_FLAT, language: 'en' }, manager], {
      machine: {
        async translate(texts) {
          batches.push([...texts]);

          return texts.map((text) => `EN: ${text}`);
        },
      },
    });

    await publishAnnouncement(bot.deps, { resident: manager, title: 'Собрание', body: 'В четверг во дворе' });
    await publishAnnouncement(bot.deps, { resident: manager, title: 'Уборка', body: 'В пятницу с утра' });

    platform.userSends('/news', { userId: 3003, chatId: 3003 });

    const listing = await waitForMessage(3003, /EN: /);

    assert.match(listing, /EN: Собрание/);
    assert.match(listing, /EN: Уборка/);
    assert.equal(listing.match(/Machine translation/gu)?.length, 1, 'пометка идёт один раз на всё сообщение');
    assert.equal(batches.length, 1, 'вся страница переводится одной пачкой');

    await bot.stop();
  });

  it('в ленте видно, идут работы сейчас или только объявлены', async () => {
    const manager: Resident = {
      id: 'mgr-news',
      maxUserId: 7011,
      displayName: 'Управляющий',
      role: 'manager',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, manager]);
    const now = bot.deps.now();

    await publishAnnouncement(bot.deps, {
      resident: manager,
      title: 'Замена задвижки',
      body: 'Отключение горячей воды',
      entrance: 1,
      riser: 1,
      works: {
        category: 'plumbing',
        from: new Date(now.getTime() - 3600_000),
        until: new Date(now.getTime() + 3600_000),
      },
    });

    platform.userSends('/news', { userId: 3003, chatId: 3003 });

    assert.match(await waitForMessage(3003, /идут сейчас/), /идут сейчас, до \d{2}:\d{2}/);

    await bot.stop();
  });

  it('заявку соседа по общему имуществу поддерживают из чата', async () => {
    const neighbour: Resident = {
      id: 'res-2',
      maxUserId: 3004,
      displayName: 'Павел',
      role: 'resident',
      apartmentId: 'apt-3',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, neighbour]);

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 3003,
      user: { user_id: 3003, first_name: 'Мария', is_bot: false },
      payload: encodeTarget({ kind: 'entrance', buildingId: BUILDING_ID, entrance: 1 }),
    });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    platform.userSends('Не убрана площадка второго этажа', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.repository.listRequests({});

    // Список соседских обращений живёт на экране: в переписке строка и переход.
    platform.userSends('/neighbours', { userId: 3004, chatId: 3004 });

    const offered = await waitForMessage(3004, /Заявки соседей/);

    assert.match(offered, /Соседи сообщили о 1 проблеме/);
    assert.match(JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []), /startapp=go-list/);

    // Подтвердить, что то же самое, можно из уведомления и из приложения.
    platform.userPressesButton(`support:${request!.id}`, { userId: 3004, chatId: 3004 });

    const answered = await waitForMessage(3004, /Записал: у вас то же самое/);

    assert.match(answered, /2 сообщили/);
    assert.equal((await bot.repository.findRequest(request!.id))?.joinedBy.length, 1);

    await bot.stop();
  });

  it('когда соседи молчат, поддерживать нечего', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/neighbours', { userId: 3003, chatId: 3003 });

    assert.match(await waitForMessage(3003, /Соседи/), /ни о чём не сообщали/);

    await bot.stop();
  });

  it('сосед по стояку получает не вторую заявку, а место в первой', async () => {
    const neighbour: Resident = {
      id: 'res-2',
      maxUserId: 3004,
      displayName: 'Павел',
      role: 'resident',
      apartmentId: 'apt-3',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, neighbour]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);
    platform.userSends('Нет горячей воды', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(2, 3000);

    platform.userSends('/new', { userId: 3004, chatId: 3004 });
    await platform.waitForOutgoing(3, 3000);
    platform.userSends('Нет горячей воды', { userId: 3004, chatId: 3004 });
    const messages = await platform.waitForOutgoing(4, 3000);

    assert.match(messages[3]?.text ?? '', /уже сообщили/);
    assert.match(messages[3]?.text ?? '', /Вы 2-й/);
    assert.equal((await bot.deps.repository.listRequests({})).length, 1, 'одна авария, одна заявка');

    await bot.stop();
  });

  it('квитанция приходит в чат с суммой и кнопкой', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/bill', { userId: 3003, chatId: 3003 });
    const said = await waitForMessage(3003, /Заплатить /);

    // В переписке сумма и срок, а разбор по строкам открывается в приложении.
    assert.doesNotMatch(said, /Содержание и текущий ремонт/, 'разбор квитанции остался в чате');
    assert.ok(said.split('\n').length <= 4, `в чате слишком длинная квитанция: ${said}`);

    const menu = platform.outgoing.findLast((message) => message.chatId === 3003);
    const buttons = JSON.stringify(menu?.attachments ?? []);

    assert.match(buttons, /За месяц /, 'на кнопке видно, за что платят');
    assert.match(buttons, /Квитанция в приложении/);

    platform.userPressesButton('pay', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Оплатить за месяц/);

    platform.userPressesButton('pay:yes', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Оплачено/);

    platform.userSends('/bill', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /всё оплачено/);

    await bot.stop();
  });

  it('домофон открывается из чата, без отдельного приложения', async () => {
    const bot = await start([RESIDENT_WITH_FLAT], {
      devices: [
        { id: 'intercom-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 1', entrance: 1 },
        { id: 'intercom-2', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 2', entrance: 2 },
      ],
    });

    platform.userSends('/door', { userId: 3003, chatId: 3003 });
    const asked = await waitForMessage(3003, /Что открыть/);

    void asked;

    const menu = platform.outgoing.findLast((message) => message.chatId === 3003);
    const buttons = JSON.stringify(menu?.attachments ?? []);

    assert.match(buttons, /Домофон, подъезд 1/);
    assert.doesNotMatch(buttons, /подъезд 2/, 'чужой подъезд жильцу не открывают');

    platform.userPressesButton('door:intercom-1', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /открыто/);

    assert.deepEqual(
      bot.hub.events.map((event) => `${event.action}:${event.deviceId}`),
      ['opened:intercom-1'],
    );

    await bot.stop();
  });

  it('гостевой код выдаётся кнопкой и живёт минуты', async () => {
    const bot = await start([RESIDENT_WITH_FLAT], {
      devices: [
        { id: 'intercom-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 1', entrance: 1 },
      ],
    });

    platform.userPressesButton('guest:intercom-1', { userId: 3003, chatId: 3003 });
    const said = await waitForMessage(3003, /Код для гостя/);

    assert.match(said, /\d{6}/);
    assert.match(
      JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []),
      /clipboard/,
      'код кладётся в буфер обмена нажатием',
    );
    assert.match(said, /работает сегодня до \d{2}:\d{2}/);

    await bot.stop();
  });

  it('сосед отвечает на предупреждение одним нажатием', async () => {
    const dispatcher: Resident = {
      id: 'disp-1',
      maxUserId: 5006,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const neighbour: Resident = {
      id: 'res-2',
      maxUserId: 3004,
      displayName: 'Павел',
      role: 'resident',
      apartmentId: 'apt-3',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, neighbour, dispatcher]);

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 3003,
      user: { user_id: 3003, first_name: 'Мария', is_bot: false },
      payload: encodeTarget({ kind: 'riser', buildingId: BUILDING_ID, entrance: 1, riser: 1 }),
    });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    platform.userSends('Нет горячей воды', { userId: 3003, chatId: 3003 });
    await waitForMessage(5006, /Новая заявка/);

    const [request] = await bot.deps.repository.listRequests({});

    platform.userPressesButton(`req:${request!.id}:accepted`, { userId: 5006, chatId: 5006 });
    await waitForMessage(3004, /Авария: /);

    const alert = platform.outgoing.findLast((message) => message.userId === neighbour.maxUserId);

    assert.match(JSON.stringify(alert?.attachments ?? []), /И у меня/);

    platform.userPressesButton(`same:${request!.id}`, { userId: 3004, chatId: 3004 });
    await waitForMessage(3004, /у вас то же самое/);

    const confirmed = await bot.deps.repository.findRequest(request!.id);

    assert.equal(confirmed?.joinedBy.length, 1, 'сосед стал участником заявки');
    assert.equal(confirmed?.notAffected.length, 0);

    await bot.stop();
  });

  it('ответ «у меня работает» показывает, что дело в квартире', async () => {
    const dispatcher: Resident = {
      id: 'disp-1',
      maxUserId: 5006,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const neighbour: Resident = {
      id: 'res-2',
      maxUserId: 3004,
      displayName: 'Павел',
      role: 'resident',
      apartmentId: 'apt-3',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, neighbour, dispatcher]);

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 3003,
      user: { user_id: 3003, first_name: 'Мария', is_bot: false },
      payload: encodeTarget({ kind: 'riser', buildingId: BUILDING_ID, entrance: 1, riser: 1 }),
    });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    platform.userSends('Нет горячей воды', { userId: 3003, chatId: 3003 });
    await waitForMessage(5006, /Новая заявка/);

    const [request] = await bot.deps.repository.listRequests({});

    platform.userPressesButton(`req:${request!.id}:accepted`, { userId: 5006, chatId: 5006 });
    await waitForMessage(3004, /Авария: /);

    platform.userPressesButton(`fine:${request!.id}`, { userId: 3004, chatId: 3004 });
    await waitForMessage(3004, /причина не в общем стояке/);

    const narrowed = await bot.deps.repository.findRequest(request!.id);

    assert.equal(narrowed?.notAffected.length, 1);
    assert.equal(narrowed?.joinedBy.length, 0);

    await bot.stop();
  });

  it('переход по наклейке сообщает, что о поломке уже знают', async () => {
    const bot = await start([RESIDENT_WITH_FLAT, NEIGHBOUR_WITH_FLAT]);
    const payload = encodeTarget({ kind: 'equipment', buildingId: BUILDING_ID, equipmentId: 'lift-2' });

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);
    platform.userSends('Лифт застрял между этажами', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(2, 3000);

    const [request] = await bot.deps.repository.listRequests({});
    assert.ok(request, 'заявка по квартире создана');

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 4004,
      user: { user_id: 4004, first_name: 'Сосед', is_bot: false },
      payload,
    });

    assert.match(await waitForMessage(4004, /Лифт, подъезд 2/), /обратились по объекту/);

    await bot.stop();
  });

  it('без службы распознавания голосовое просят рассказать словами', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);

    platform.pushUpdate({
      update_type: 'message_created',
      timestamp: Date.now(),
      message: {
        sender: { user_id: 3003, first_name: 'Мария', is_bot: false },
        recipient: { chat_id: 3003, chat_type: 'dialog' },
        timestamp: Date.now(),
        body: { mid: 'mid-voice-mute', seq: 1, attachments: [{ type: 'audio', payload: { token: 'voice-token' } }] },
      },
    });

    const asked = await platform.waitForOutgoing(3, 3000);

    assert.match(asked[1]?.text ?? '', /принята/, 'заявка не теряется, даже нерасшифрованная');
    assert.match(asked[2]?.text ?? '', /Напишите одной строкой/);

    platform.userSends('Течёт кран на кухне', { userId: 3003, chatId: 3003 });

    const passed = await platform.waitForOutgoing(4, 3000);
    const [request] = await bot.deps.repository.listRequests({});

    assert.match(passed[3]?.text ?? '', /Передал по заявке/);
    assert.equal(request?.attachments[0]?.kind, 'voice', 'запись остаётся при заявке');
    assert.match(
      request?.history.map((event) => event.comment ?? '').join(' ') ?? '',
      /Течёт кран на кухне/,
      'сказанное словами доходит до смены',
    );

    await bot.stop();
  });

  it('сбой хранилища виден жильцу ответом, а не молчанием', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    bot.repository.listRequests = () => Promise.reject(new Error('база недоступна'));

    platform.userSends('/my', { userId: 3003, chatId: 3003 });

    const [said] = await platform.waitForOutgoing(1, 3000);

    assert.match(said?.text ?? '', /Нажмите ещё раз или выберите в меню/);

    await bot.stop();
  });

  it('нажатие кнопки всегда закрывается ответом, а короткий итог приходит уведомлением', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/my', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);

    // Кнопка со своим сообщением: уведомление пустое, но нажатие закрыто.
    platform.userPressesButton('menu:news', { userId: 3003, chatId: 3003 });
    const [closed] = await platform.waitForAnswers(1, 3000);

    assert.equal(closed?.notification, undefined);

    // Кнопка без своего сообщения: итог виден всплывающим уведомлением.
    platform.userPressesButton('flat:apt-1', { userId: 3003, chatId: 3003 });

    assert.match(await waitForToast(/квартир/), /квартир/);

    await bot.stop();
  });

  it('длинная выгрузка своих данных уходит файлом', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    for (let number = 1; number <= 8; number += 1) {
      await createServiceRequest(bot.deps, {
        resident: RESIDENT_WITH_FLAT,
        description: `Не работает розетка ${number}`,
      });
    }

    platform.userSends('/mydata', { userId: 3003, chatId: 3003 });

    const profile = await waitForMessage(3003, /Я храню о вас/);

    assert.match(profile, /Заявок 8/, 'сначала видно, что о человеке известно');

    platform.userPressesButton('mydata:file', { userId: 3003, chatId: 3003 });

    const said = await waitForMessage(3003, /Ваши данные файлом/);

    assert.match(said, /Заявок 8/, 'файл уходит по кнопке, а не сам собой');

    await bot.stop();
  });

  it('профиль удаляют из переписки: сначала вопрос, потом дело', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/mydata', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Я храню о вас/);

    platform.userPressesButton('leave:ask', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Отвязать квартиру\?/);

    platform.userPressesButton('leave:yes', { userId: 3003, chatId: 3003 });
    await waitForToast(/Квартира отвязана/);

    assert.equal((await bot.repository.findResident('res-1'))?.apartmentId, undefined);

    platform.userPressesButton('forget:ask', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Удалить профиль\?/);

    platform.userPressesButton('forget:yes', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Профиль удалён/);

    const gone = await bot.repository.findResident('res-1');

    assert.equal(gone?.maxUserId, undefined, 'связь с человеком разорвана');
    assert.equal(/Мария/.test(gone?.displayName ?? ''), false, 'имя стёрто');

    await bot.stop();
  });

  it('вложение, которого бот не понимает, заявкой не становится', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.pushUpdate({
      update_type: 'message_created',
      timestamp: Date.now(),
      message: {
        sender: { user_id: 3003, first_name: 'Мария', is_bot: false },
        recipient: { chat_id: 3003, chat_type: 'dialog' },
        timestamp: Date.now(),
        body: { mid: 'mid-sticker', seq: 1, attachments: [{ type: 'sticker', payload: { token: 'sticker-token' } }] },
      },
    });

    const [said] = await platform.waitForOutgoing(1, 3000);

    assert.match(said?.text ?? '', /не разберу/);
    assert.equal((await bot.deps.repository.listRequests({})).length, 0);

    await bot.stop();
  });

  it('кадр с камеры приходит в переписку, без мини-приложения', async () => {
    const bot = await start([RESIDENT_WITH_FLAT], {
      devices: [
        { id: 'intercom-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 1', entrance: 1 },
        { id: 'camera-1', buildingId: BUILDING_ID, kind: 'camera', title: 'Камера у подъезда 1', entrance: 1 },
      ],
    });

    platform.userSends('/door', { userId: 3003, chatId: 3003 });

    const asked = await waitForMessage(3003, /Что открыть/);

    assert.match(asked, /посмотреть/, 'камеры предложены рядом с дверями');

    platform.userPressesButton('camera:camera-1', { userId: 3003, chatId: 3003 });

    assert.match(await waitForToast(/кадр отправлен/), /Камера/);
    assert.deepEqual(platform.state.uploads, [{ type: 'file' }]);

    await bot.stop();
  });

  it('у человека с двумя квартирами бот спрашивает адрес кнопками', async () => {
    const twoFlats: Resident = {
      id: 'res-two',
      maxUserId: 4021,
      displayName: 'Мария',
      role: 'resident',
      apartmentId: 'apt-1',
      apartmentIds: ['apt-1', 'apt-3'],
      buildingId: BUILDING_ID,
    };

    const bot = await start([twoFlats]);

    platform.userSends('Течёт кран на кухне', { userId: 4021, chatId: 4021 });
    await waitForMessage(4021, /принята/);

    // Ждём именно вопрос об адресе: слово «квартира» стоит и в подтверждении заявки.
    const asked = await waitForMessage(4021, /Где это случилось/);
    const question = platform.outgoing.findLast((message) => /Где это случилось/.test(message.text));
    const buttons = JSON.stringify(question?.attachments ?? []);

    assert.match(asked, /Где это случилось/);
    assert.match(buttons, /Квартира 3/, 'вариантов кнопками нет');

    const [request] = await bot.deps.repository.listRequests({});

    platform.userPressesButton(`where:${request?.id ?? ''}:1`, { userId: 4021, chatId: 4021 });
    await waitForMessage(4021, /Записал/);

    const saved = await bot.deps.repository.findRequest(request?.id ?? '');

    assert.equal(saved?.target.kind, 'apartment');
    assert.equal(saved?.target.kind === 'apartment' ? saved.target.apartmentId : '', 'apt-3');

    await bot.stop();
  });

  it('помощник отвечает на вопрос словами и уводит в нужный раздел', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/help', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Спрашивайте о доме/);

    platform.userSends('где передать показания счётчиков', { userId: 3003, chatId: 3003 });

    const said = await waitForMessage(3003, /Показания/);

    assert.match(said, /счётчик/i);
    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'вопрос не стал заявкой');

    const keyboard = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

    assert.match(keyboard, /menu:meters/, 'в раздел нечем перейти');
    assert.match(keyboard, /talk:stop/, 'из разговора нечем выйти');

    await bot.stop();
  });

  it('ответ данными дома на чужом языке тоже предлагает перейти на него', async () => {
    const bot = await start([{ ...RESIDENT_WITH_FLAT, language: 'en' }]);

    platform.userSends('Что с моей заявкой', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /request/iu);

    const keyboard = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

    assert.match(keyboard, /lang:ru/u, 'перейти на язык вопроса нечем');

    await bot.stop();
  });

  it('вопрос на другом языке получает и ответ, и кнопку перехода на этот язык', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/help', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Спрашивайте о доме/);

    platform.userSends('Hisoblagichlarni qayerda toʻlayman?', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Oʻzbekcha/u);

    const keyboard = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

    assert.match(keyboard, /lang:uz/u, 'перейти на язык вопроса нечем');
    assert.match(keyboard, /talk:stop/u, 'ответ на месте, разговор продолжается');

    platform.userPressesButton('lang:uz', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Til: Oʻzbekcha/u);

    assert.equal((await bot.deps.repository.findResidentByMaxUserId(3003))?.language, 'uz');

    await bot.stop();
  });

  it('кнопка под закрытой заявкой соседа отвечает словами, а не молчанием', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    const request = await createServiceRequest(bot.deps, {
      resident: RESIDENT_WITH_FLAT,
      description: 'Нет холодной воды во всём стояке',
      category: 'plumbing',
    });

    const found = (await bot.deps.repository.findRequest(request.id))!;

    // Состояние идёт вместе со своим событием: по истории его и читают.
    await bot.deps.repository.saveRequest({
      ...found,
      status: 'confirmed',
      history: [
        ...found.history,
        {
          at: new Date('2026-09-03T11:00:00Z'),
          status: 'confirmed',
          role: 'resident',
          actorId: RESIDENT_WITH_FLAT.id,
        },
      ],
    });

    platform.userPressesButton(`same:${request.id}`, { userId: 3003, chatId: 3003 });

    const answer = await waitForMessage(3003, /работы уже закончены/);

    assert.match(answer, /Спасибо/);

    await bot.stop();
  });

  it('важное в сообщении выделено, и разметка помечена форматом', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Напишите, что случилось/);

    // Подсказка без выделений: пометки формата у неё нет, иначе звёздочка
    // и подчёркивание в тексте жильца превратились бы в разметку.
    const prompt = platform.outgoing.findLast((message) => message.chatId === 3003);

    assert.equal(prompt?.body?.['format'], undefined);

    platform.userSends('Течёт кран на кухне', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const receipt = platform.outgoing.findLast((message) => /принята/.test(message.text));

    assert.match(receipt?.text ?? '', /Заявка \*\*Д15-2609-0001\*\* принята/, 'номер заявки не выделен');
    assert.equal(receipt?.body?.['format'], 'markdown', 'без пометки разметка придёт звёздочками');

    await bot.stop();
  });

  it('звёздочки в словах жильца разметкой не становятся', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Напишите, что случилось/);

    platform.userSends('Течёт **кран** на кухне', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    platform.userPressesButton('menu:my', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /кран/);

    const card = platform.outgoing.findLast((message) => /кран/.test(message.text));

    assert.match(card?.text ?? '', /\*\*кран\*\*/, 'слова жильца показаны не так, как он их написал');
    assert.equal(card?.body?.['format'], undefined, `звёздочки жильца включили разметку: ${card?.text ?? ''}`);

    await bot.stop();
  });

  it('экран в переписке остаётся один, даже когда ходят разными путями', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    platform.userSends('/start', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Здравствуйте/);
    platform.forgetOutgoing();

    // Тот же путь, что и на скриншоте: счётчики, своя квартира, подтверждение
    // отвязки и возврат в группу меню. Раньше каждый шаг оставлял своё сообщение.
    platform.userPressesButton('menu:meters', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Холодная вода|Отправьте показание/);

    platform.userPressesButton('menu:flat', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /квартира 1/);

    platform.userPressesButton('leave:ask', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Отвязать квартиру/);

    platform.userPressesButton('group:me', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Связь и профиль/);

    // Удалённое мок из ленты убирает: остаётся то, что человек видит сейчас.
    const alive = platform.outgoing.filter((message) => message.chatId === 3003);

    assert.equal(alive.length, 1, `экранов в переписке: ${alive.map((message) => message.text).join(' | ')}`);

    await bot.stop();
  });

  it('возврат в меню переписывает экран вместе с пометкой формата', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/start', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Здравствуйте/);

    platform.userPressesButton('group:money', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Деньги и счётчики/);

    platform.userPressesButton('group:back', { userId: 3003, chatId: 3003 });

    const menu = await waitForMessage(3003, /Домовой: ул\. Ленина, 15/);
    const rewritten = platform.outgoing.findLast((message) => /Домовой/.test(message.text));

    assert.match(menu, /Можно написать словами/);
    assert.equal(rewritten?.body?.['format'], 'markdown', 'переписанный экран показал бы звёздочки');

    await bot.stop();
  });

  it('просьба словами делает дело, а не заводит заявку', async () => {
    const bot = await start([RESIDENT_WITH_FLAT], {
      devices: [{ id: 'intercom-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 1', entrance: 1 }],
    });

    platform.userSends('открыть дверь', { userId: 3003, chatId: 3003 });

    const said = await waitForMessage(3003, /Что открыть/);

    assert.match(JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []), /door:intercom-1/);
    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'просьба стала заявкой');
    assert.doesNotMatch(said, /Одного знака или цифры мало/, 'просьбу приняли за мусор');

    await bot.stop();
  });

  it('одно слово о поломке заводит заявку, а не показывает меню', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('течь', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    assert.equal(request?.category, 'plumbing', 'категория по слову не определилась');

    await bot.stop();
  });

  it('название раздела словами открывает его, даже когда раздел живёт в приложении', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('капитальный ремонт', { userId: 3003, chatId: 3003 });

    const said = await waitForMessage(3003, /Капитальный ремонт/);

    assert.doesNotMatch(said, /Одного знака или цифры мало/, 'название раздела приняли за мусор');
    assert.match(JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []), /startapp=go-capital/);
    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'раздел стал заявкой');

    await bot.stop();
  });

  it('разговор с помощником продолжается без повторного нажатия', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/help', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Спрашивайте о доме/);

    platform.userSends('где передать показания счётчиков', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Показания/);

    // Второй вопрос подряд: кнопку «Спросить» человек больше не нажимал.
    platform.userSends('а где открыть дверь подъезда', { userId: 3003, chatId: 3003 });

    const next = await waitForMessage(3003, /двер/i);

    assert.match(next, /Спросите ещё/);
    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'второй вопрос стал заявкой');

    platform.userPressesButton('talk:stop', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Домовой/);

    // Разговор закончен: следующее сообщение это уже обращение, а не вопрос.
    platform.userSends('в подъезде разбито стекло', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 1);

    await bot.stop();
  });

  it('в ответе жильцу нет служебных пометок о разборе текста', async () => {
    const bot = await start([RESIDENT_WITH_FLAT], {
      reasoner: {
        understand: () => Promise.resolve({ category: 'plumbing', priority: 'normal', title: 'Течёт кран' }),
      },
    });

    platform.userSends('На кухне что-то капает', { userId: 3003, chatId: 3003 });

    const said = await waitForMessage(3003, /принята/);

    // Жильцу в ответе нужны категория, срок и номер: служебная пометка о том,
    // откуда взялась категория, ему ничего не даёт.
    assert.doesNotMatch(said, /разбор текста/);
    assert.match(said, /водоснабжение и канализация/i);

    await bot.stop();
  });

  it('просьба на другом языке доходит до дела: язык разбирает модель', async () => {
    const bot = await start([{ ...RESIDENT_WITH_FLAT, language: 'en' }], {
      // Модель читает сообщение на любом языке и называет раздел по-русски.
      reasoner: {
        understand: () => Promise.resolve(undefined),
        onTopic: () => Promise.resolve(true),
        route: () => Promise.resolve({ kind: 'elsewhere' as const, screen: 'home' }),
      },
      devices: [
        { id: 'dev-1', buildingId: BUILDING_ID, kind: 'intercom', title: 'Домофон, подъезд 1', entrance: 1 },
      ],
    });

    platform.userSends('I want to open the door', { userId: 3003, chatId: 3003 });

    const said = await waitForMessage(3003, /open|view|Домофон/iu);

    assert.doesNotMatch(said, /помогаю только с домом/u, 'просьбу приняли за постороннюю');
    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'просьба стала заявкой о поломке');

    await bot.stop();
  });

  it('без модели категория подписана ключевыми словами, а не моделью', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('Течёт кран на кухне', { userId: 3003, chatId: 3003 });

    const said = await waitForMessage(3003, /принята/);

    assert.doesNotMatch(said, /разбор текста/);

    await bot.stop();
  });

  it('код из квитанции сообщением привязывает квартиру, а не заводит заявку', async () => {
    const bot = await start();

    platform.userSends(FLAT_CODE.toLowerCase(), { userId: 4009, chatId: 4009 });
    await waitForMessage(4009, /персональные данные/);

    platform.userPressesButton('legal:accept', { userId: 4009, chatId: 4009 });
    await waitForMessage(4009, /код квартиры из квитанции/);

    platform.userSends(FLAT_CODE.toLowerCase(), { userId: 4009, chatId: 4009 });

    assert.match(await waitForMessage(4009, /Теперь я знаю, что вы в квартире/), /квартире 1/);

    const resident = await bot.deps.repository.findResidentByMaxUserId(4009);

    assert.equal(resident?.apartmentId, 'apt-1');
    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'заявки не появилось');

    await bot.stop();
  });

  it('чужой восьмизначный код отвечает отказом, а не заявкой', async () => {
    const bot = await start();

    platform.userSends('WXYWXY33', { userId: 4010, chatId: 4010 });
    await waitForMessage(4010, /персональные данные/);

    platform.userPressesButton('legal:accept', { userId: 4010, chatId: 4010 });
    await waitForMessage(4010, /код квартиры из квитанции/);

    platform.userSends('WXYWXY33', { userId: 4010, chatId: 4010 });

    assert.match(await waitForMessage(4010, /Код не подошёл/), /квитанц/);
    assert.equal((await bot.deps.repository.listRequests({})).length, 0);

    await bot.stop();
  });

  it('стикер вместо ответа в разговоре не подвешивает его', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/support', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);

    platform.pushUpdate({
      update_type: 'message_created',
      timestamp: Date.now(),
      message: {
        sender: { user_id: 3003, first_name: 'Мария', is_bot: false },
        recipient: { chat_id: 3003, chat_type: 'dialog' },
        timestamp: Date.now(),
        body: { mid: 'mid-sticker-2', seq: 2, attachments: [{ type: 'sticker', payload: { token: 'sticker-token' } }] },
      },
    });

    assert.match(await waitForMessage(3003, /нужен текст/i), /нужен текст/i);

    platform.userSends('Когда включат отопление?', { userId: 3003, chatId: 3003 });

    await waitForMessage(3003, /Вопрос принят|Обращение/i);

    assert.equal((await bot.deps.repository.listSupportTickets({})).length, 1, 'разговор продолжился');

    await bot.stop();
  });

  it('голосовое становится описанием заявки', async () => {
    const bot = await start([RESIDENT_WITH_FLAT], {
      transcriber: { transcribe: () => Promise.resolve('не работает лифт в подъезде') },
    });

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);

    platform.pushUpdate({
      update_type: 'message_created',
      timestamp: Date.now(),
      message: {
        sender: { user_id: 3003, first_name: 'Мария', is_bot: false },
        recipient: { chat_id: 3003, chat_type: 'dialog' },
        timestamp: Date.now(),
        body: {
          mid: 'mid-voice',
          seq: 1,
          attachments: [{ type: 'audio', payload: { token: 'voice-token' } }],
        },
      },
    });

    const messages = await platform.waitForOutgoing(2, 3000);
    const [request] = await bot.deps.repository.listRequests({});

    assert.match(messages[1]?.text ?? '', /принята/);
    assert.equal(request?.description, 'не работает лифт в подъезде');
    assert.equal(request?.category, 'elevator', 'категория угадана по расшифровке');
    assert.equal(request?.attachments[0]?.transcript, 'не работает лифт в подъезде');

    await bot.stop();
  });

  /** Сообщение Марии с вложением платформы: запись или снимок, с подписью или без. */
  const mariaSends = (mid: string, attachment: { type: string; payload: Record<string, string> }, text?: string) =>
    platform.pushUpdate({
      update_type: 'message_created',
      timestamp: Date.now(),
      message: {
        sender: { user_id: 3003, first_name: 'Мария', is_bot: false },
        recipient: { chat_id: 3003, chat_type: 'dialog' },
        timestamp: Date.now(),
        body: { mid, seq: 1, ...(text ? { text } : {}), attachments: [attachment] },
      },
    });

  const VOICE = { type: 'audio', payload: { token: 'voice-token' } };
  const PHOTO = { type: 'image', payload: { url: 'https://max.test/photo.jpg' } };

  const withMeters = async (bot: Awaited<ReturnType<typeof start>>): Promise<void> => {
    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await bot.repository.saveMeter({ id: 'hot-1', apartmentId: 'apt-1', kind: 'hot_water', serial: 'ГВС-1' });
  };

  it('показание голосом не подаётся само: число переспрашивается кнопкой', async () => {
    const bot = await start([RESIDENT_WITH_FLAT], {
      transcriber: { transcribe: () => Promise.resolve('Холодная вода 12350') },
    });

    await withMeters(bot);
    mariaSends('mid-voice-reading', VOICE);

    const asked = await waitForMessage(3003, /Услышал показание/);

    assert.match(asked, /12\s350/u);
    assert.equal((await bot.repository.listReadings('cold-1')).length, 0, 'показание с голоса подано без подтверждения');

    platform.userPressesButton('meter-read:cold-1:12350', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Принято/);

    assert.equal((await bot.repository.listReadings('cold-1'))[0]?.value, 12350);

    await bot.stop();
  });

  it('число голосом без названия прибора: продукт спрашивает, чей это счётчик', async () => {
    const bot = await start([RESIDENT_WITH_FLAT], { transcriber: { transcribe: () => Promise.resolve('140,2') } });

    await withMeters(bot);
    mariaSends('mid-voice-number', VOICE);

    const asked = await waitForMessage(3003, /Какого это счётчика/);

    assert.match(asked, /140,2/);
    assert.equal((await bot.repository.listReadingsFor(['cold-1', 'hot-1'])).length, 0);
    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'число ушло заявкой');

    await bot.stop();
  });

  it('голосовое в ответ на вопрос о показании тоже переспрашивается', async () => {
    // Расшифровка приходит с названием прибора: число из неё всё равно достаётся.
    const bot = await start([RESIDENT_WITH_FLAT], {
      transcriber: { transcribe: () => Promise.resolve('Холодная вода 123,5') },
    });

    await withMeters(bot);
    platform.userSends('/meters', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Выберите счётчик/);
    platform.userPressesButton('meter:cold-1', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Холодная вода/);

    mariaSends('mid-voice-answer', VOICE);
    await waitForMessage(3003, /Услышал показание 123,5/);

    assert.equal((await bot.repository.listReadings('cold-1')).length, 0);

    await bot.stop();
  });

  it('голосовое, которое не разобрали, заявкой не становится', async () => {
    const bot = await start([RESIDENT_WITH_FLAT], { transcriber: { transcribe: () => Promise.resolve(undefined) } });

    mariaSends('mid-voice-noise', VOICE);
    await waitForMessage(3003, /Голосовое не разобрал/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'из шума вышла заявка');

    // Рассказ словами после этого идёт заявкой без повторного «что случилось».
    platform.userSends('Нет горячей воды со вчерашнего вечера', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    assert.equal(request?.description, 'Нет горячей воды со вчерашнего вечера');

    await bot.stop();
  });

  it('слишком длинная запись и молчание расшифровки объясняются словами', async () => {
    const tooLong = await start([RESIDENT_WITH_FLAT], {
      transcriber: {
        transcribe: () => Promise.reject(new DomainError('voice_too_long', 'Запись длиннее двух минут. Скажите короче')),
      },
    });

    mariaSends('mid-voice-long', VOICE);
    await waitForMessage(3003, /длиннее двух минут/);
    assert.equal((await tooLong.deps.repository.listRequests({})).length, 0);
    await tooLong.stop();

    platform.reset();

    const silent = await start([RESIDENT_WITH_FLAT], {
      transcriber: { transcribe: () => Promise.reject(new Error('GigaChat не ответил за 30 с')) },
    });

    mariaSends('mid-voice-timeout', VOICE);
    await waitForMessage(3003, /Расшифровка сейчас не отвечает/);
    assert.equal((await silent.deps.repository.listRequests({})).length, 0);
    await silent.stop();
  });

  it('показание с фотографии табло переспрашивается, а не подаётся', async () => {
    const seen: string[] = [];
    const bot = await start([RESIDENT_WITH_FLAT], {
      vision: {
        read: () => Promise.resolve(undefined),
        readUrl: (url) => {
          seen.push(url);

          return Promise.resolve(1234.5);
        },
      },
    });

    await withMeters(bot);
    platform.userSends('/meters', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Выберите счётчик/);
    platform.userPressesButton('meter:cold-1', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Холодная вода/);

    mariaSends('mid-photo-meter', PHOTO);

    const asked = await waitForMessage(3003, /С фотографии вижу/);

    assert.match(asked, /1\s234,5/u);
    assert.deepEqual(seen, ['https://max.test/photo.jpg']);
    assert.equal((await bot.repository.listReadings('cold-1')).length, 0, 'показание со снимка подано без подтверждения');

    platform.userPressesButton('meter-read:cold-1:1234.5', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Принято/);

    assert.equal((await bot.repository.listReadings('cold-1'))[0]?.value, 1234.5);

    await bot.stop();
  });

  it('снимок без табло и нечитаемое табло объясняются по-разному', async () => {
    const answers: (() => Promise<number | undefined>)[] = [
      () => Promise.reject(new DomainError('meter_not_in_photo', 'На снимке не вижу табло счётчика')),
      () => Promise.resolve(undefined),
      () => Promise.reject(new Error('GigaChat не ответил за 30 с')),
    ];
    const bot = await start([RESIDENT_WITH_FLAT], {
      vision: { read: () => Promise.resolve(undefined), readUrl: () => answers.shift()!() },
    });

    await withMeters(bot);
    platform.userSends('/meters', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Выберите счётчик/);
    platform.userPressesButton('meter:cold-1', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Холодная вода/);

    mariaSends('mid-photo-cat', PHOTO);
    await waitForMessage(3003, /не видно табло счётчика/);

    // Ожидание остаётся: следующий снимок идёт тому же счётчику.
    mariaSends('mid-photo-blur', PHOTO);
    await waitForMessage(3003, /Цифры на снимке не разобрать/);

    mariaSends('mid-photo-late', PHOTO);
    await waitForMessage(3003, /Распознавание не ответило/);

    assert.equal((await bot.repository.listReadings('cold-1')).length, 0);
    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'снимок табло ушёл заявкой');

    await bot.stop();
  });

  it('снимок к заявке уходит с подписью и без неё', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    mariaSends('mid-photo-captioned', PHOTO, 'В подвале течёт труба у стояка');
    await waitForMessage(3003, /принята/);

    const [captioned] = await bot.deps.repository.listRequests({});

    assert.equal(captioned?.description, 'В подвале течёт труба у стояка');
    assert.equal(captioned?.attachments[0]?.kind, 'photo');

    platform.forgetOutgoing();
    mariaSends('mid-photo-mute', PHOTO);
    await waitForMessage(3003, /Что на снимке/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 1, 'по одной картинке заявка не заводится');

    platform.userSends('Разбито стекло на площадке', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const mute = (await bot.deps.repository.listRequests({})).find((item) => item.id !== captioned?.id);

    assert.equal(mute?.description, 'Разбито стекло на площадке');
    assert.equal(mute?.attachments[0]?.kind, 'photo', 'снимок дождался слов и ушёл в заявку');

    await bot.stop();
  });

  it('жилец принимает работу кнопкой, а возврат объясняет словами', async () => {
    const dispatcher: Resident = {
      id: 'disp-3',
      maxUserId: 5007,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const technician: Resident = {
      id: 'tech-1',
      maxUserId: 6006,
      displayName: 'Мастер',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, dispatcher, technician]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);
    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(2, 3000);

    const [request] = await bot.deps.repository.listRequests({});
    const id = request!.id;

    platform.userPressesButton(`req:${id}:accepted`, { userId: 5007, chatId: 5007 });
    await new Promise((resolve) => setTimeout(resolve, 120));

    // В работу заявка уходит с исполнителем, поэтому диспетчер поручает её мастеру.
    platform.userPressesButton(`assign:${id}:${technician.id}`, { userId: 5007, chatId: 5007 });
    await new Promise((resolve) => setTimeout(resolve, 120));

    // Сдача работы требует отметки о сделанном: бот спрашивает её отдельным сообщением.
    platform.userPressesButton(`ask:${id}:done`, { userId: 6006, chatId: 6006 });
    await waitForMessage(6006, /Что сделано/);
    platform.userSends('Заменил смеситель', { userId: 6006, chatId: 6006 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const reported = await bot.deps.repository.findRequest(id);

    assert.equal(reported?.status, 'done');
    assert.equal(reported?.history.at(-1)?.comment, 'Заменил смеситель');

    platform.userPressesButton(`ask:${id}:in_progress`, { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Что именно не сделано/);

    assert.equal((await bot.deps.repository.findRequest(id))?.status, 'done');

    platform.userSends('Вода так и не появилась', { userId: 3003, chatId: 3003 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const reopened = await bot.deps.repository.findRequest(id);

    assert.equal(reopened?.status, 'in_progress');
    assert.equal(reopened?.reopenCount, 1);
    assert.equal(reopened?.history.at(-1)?.comment, 'Вода так и не появилась');

    await bot.stop();
  });

  it('сводка по дому приходит сотруднику текстом, а жильцу, нет', async () => {
    const manager: Resident = {
      id: 'mgr-2',
      maxUserId: 7008,
      displayName: 'Управляющий',
      role: 'manager',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, manager]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);
    platform.userSends('Нет горячей воды', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(2, 3000);

    platform.userSends('/report', { userId: 7008, chatId: 7008 });
    await waitForMessage(7008, /Сейчас: открыто 1/);

    platform.userSends('/report', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /чужие данные/);

    await bot.stop();
  });

  it('отказ кнопкой сначала спрашивает причину', async () => {
    const dispatcher: Resident = {
      id: 'disp-4',
      maxUserId: 5008,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, dispatcher]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);
    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await waitForMessage(5008, /Новая заявка/);

    const [request] = await bot.deps.repository.listRequests({});

    platform.userPressesButton(`ask:${request!.id}:rejected`, { userId: 5008, chatId: 5008 });
    await waitForMessage(5008, /Почему заявка отклоняется/);

    assert.equal((await bot.deps.repository.findRequest(request!.id))?.status, 'new');

    platform.userSends('Не относится к общему имуществу', { userId: 5008, chatId: 5008 });
    await waitForMessage(5008, /отклонена/);

    const rejected = await bot.deps.repository.findRequest(request!.id);

    assert.equal(rejected?.status, 'rejected');
    assert.equal(rejected?.history.at(-1)?.comment, 'Не относится к общему имуществу');

    assert.match(await waitForMessage(3003, /отклонена/), /Не относится к общему имуществу/);

    await bot.stop();
  });

  it('обращение в жилинспекцию собирается по команде', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/gzhi', { userId: 3003, chatId: 3003 });
    const [empty] = await platform.waitForOutgoing(1, 3000);

    assert.match(empty?.text ?? '', /обращаться не с чем/);

    await bot.stop();
  });

  it('по просроченной заявке приходит готовый текст обращения', async () => {
    const bot = await start([RESIDENT_WITH_FLAT], { now: () => new Date('2026-09-03T10:00:00Z') });

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);
    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    bot.advance(2 * 3600_000);

    platform.userSends('/gzhi', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /есть основание для обращения/);

    const complaint = await waitForMessage(3003, /Государственную жилищную инспекцию/);

    assert.match(complaint, /Д15-2609-0001/);
    assert.match(complaint, /Хронология:/);

    // Отправляет продукт, а не жилец: переписывать текст в чужую форму не нужно.
    const [request] = await bot.deps.repository.listRequests({});

    // Обращение в надзорный орган отзыву не подлежит, поэтому между текстом
    // и отправкой стоит подтверждение.
    platform.userPressesButton(`gzhi:${request!.id}:send`, { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Отправить это обращение/);

    platform.userPressesButton(`gzhi:${request!.id}:yes`, { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Обращение отправлено/);

    const sent = await bot.deps.repository.listHandoffs({ requestId: request!.id });

    assert.equal(sent.length, 1, 'обращение не ушло в надзор');
    assert.equal(sent[0]?.to, 'inspection');
    assert.equal(sent[0]?.byResident, true);

    await bot.stop();
  });

  it('сотруднику обращение в инспекцию не собирают', async () => {
    const master: Resident = {
      id: 'tech-gzhi',
      maxUserId: 6009,
      displayName: 'Сергей, мастер',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    const olga: Resident = {
      id: 'disp-gzhi',
      maxUserId: 5009,
      displayName: 'Ольга, диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, olga, master], { now: () => new Date('2026-09-03T10:00:00Z') });

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);
    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    await transitionRequest(bot.deps, { resident: olga, requestId: request!.id, to: 'accepted' });
    await transitionRequest(bot.deps, {
      resident: olga,
      requestId: request!.id,
      to: 'in_progress',
      assigneeId: master.id,
    });

    bot.advance(2 * 3600_000);

    platform.userSends('/gzhi', { userId: 6009, chatId: 6009 });
    await waitForMessage(6009, /составляет заявитель/);

    await bot.stop();
  });

  it('переход по наклейке показывает открытую заявку по этому объекту', async () => {
    const bot = await start([RESIDENT_WITH_FLAT, NEIGHBOUR_WITH_FLAT]);
    const payload = encodeTarget({ kind: 'entrance', buildingId: BUILDING_ID, entrance: 1 });

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 3003,
      user: { user_id: 3003, first_name: 'Мария', is_bot: false },
      payload,
    });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    platform.userSends('Не горит лампа на площадке', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 4004,
      user: { user_id: 4004, first_name: 'Сосед', is_bot: false },
      payload,
    });

    const greeting = await waitForMessage(4004, /Об этом уже сообщили/);

    assert.match(greeting, /Д15-2609-0001/);
    assert.match(greeting, /добавлю вас к этой заявке/);

    await bot.stop();
  });

  it('ссылка на приложение не ломается своим запросом в адресе', async () => {
    const { appLink } = await import('../dist/keyboards.js');

    assert.equal(appLink('https://max.ru/uk_bot', 'go-queue'), 'https://max.ru/uk_bot?startapp=go-queue');
    assert.equal(appLink('https://max.ru/uk_bot?utm=max', 'go-queue'), 'https://max.ru/uk_bot?utm=max&startapp=go-queue');
    assert.equal(appLink('https://max.ru/uk_bot'), 'https://max.ru/uk_bot');
  });

  it('ненужные уведомления отключаются кнопкой под ними', async () => {
    const manager: Resident = {
      id: 'mgr-mute',
      maxUserId: 7012,
      displayName: 'Нина',
      role: 'manager',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, manager]);

    await publishAnnouncement(bot.deps, { resident: manager, title: 'Субботник', body: 'В субботу во дворе' });

    await waitForMessage(3003, /Субботник/);

    const keyboard = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

    assert.match(keyboard, /mute:news/, 'под объявлением есть отказ от таких уведомлений');

    platform.userPressesButton('mute:news', { userId: 3003, chatId: 3003 });
    assert.match(await waitForMessage(3003, /Больше не пришлю/), /объявления дома/i);

    platform.forgetOutgoing();
    await publishAnnouncement(bot.deps, { resident: manager, title: 'Ещё субботник', body: 'И в воскресенье' });
    await new Promise((resolve) => setTimeout(resolve, 400));

    assert.equal(
      platform.outgoing.filter((message) => message.userId === 3003).length,
      0,
      'отключённые объявления больше не приходят',
    );

    platform.userPressesButton('unmute:news', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Снова буду присылать/);

    await bot.stop();
  });

  it('кнопки под уведомлением идут на языке жильца', async () => {
    const manager: Resident = {
      id: 'mgr-lang',
      maxUserId: 5088,
      displayName: 'Нина',
      role: 'manager',
      buildingId: BUILDING_ID,
    };

    const bot = await start([{ ...RESIDENT_WITH_FLAT, language: 'uz' }, manager]);

    await publishAnnouncement(bot.deps, { resident: manager, title: 'Субботник', body: 'В субботу во дворе' });
    await waitForMessage(3003, /Субботник/);

    const keyboard = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

    assert.match(keyboard, /Bildirishnomalar/u, 'отказ от уведомлений на языке жильца');
    assert.doesNotMatch(keyboard, /Уведомления/u);

    await bot.stop();
  });

  it('из разговора выходят словом, а незнакомая команда не остаётся без ответа', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    platform.userSends('отмена', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Отменил/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'слово выхода заявкой не становится');

    platform.userSends('/такойкомандынет', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Такой команды у меня нет/);

    await bot.stop();
  });

  it('«В работу» без мастера не отказывает, а спрашивает, кому поручить', async () => {
    const dispatcher: Resident = {
      id: 'disp-need',
      maxUserId: 5021,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const technician: Resident = {
      id: 'tech-need',
      maxUserId: 4021,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, dispatcher, technician]);

    platform.userSends('Течёт кран на кухне', { userId: 3003, chatId: 3003 });
    await waitForMessage(5021, /Новая заявка/);

    const [request] = await bot.deps.repository.listRequests({});

    platform.userPressesButton(`req:${request!.id}:accepted`, { userId: 5021, chatId: 5021 });
    await waitForMessage(5021, /принята/);

    platform.userPressesButton(`req:${request!.id}:in_progress`, { userId: 5021, chatId: 5021 });
    assert.match(await waitForMessage(5021, /Кому поручить/), /сколько нарядов/);

    assert.equal((await bot.deps.repository.findRequest(request!.id))?.status, 'accepted', 'без мастера заявка на месте');

    platform.userPressesButton(`assign:${request!.id}:tech-need`, { userId: 5021, chatId: 5021 });
    await waitForMessage(5021, /поручена/);

    assert.equal((await bot.deps.repository.findRequest(request!.id))?.assigneeId, 'tech-need');

    await bot.stop();
  });

  it('мастер сдаёт работу словами: продукт уточняет и записывает отчёт', async () => {
    const master: Resident = {
      id: 'tech-words',
      maxUserId: 5030,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    const dispatcher: Resident = {
      id: 'disp-words',
      maxUserId: 5031,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, master, dispatcher]);

    const request = await createServiceRequest(bot.deps, {
      resident: RESIDENT_WITH_FLAT,
      description: 'Течёт труба под раковиной',
      category: 'plumbing',
      startParam: 'apt_apt-1',
    });

    await transitionRequest(bot.deps, { resident: dispatcher, requestId: request.id, to: 'accepted' });
    await transitionRequest(bot.deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'in_progress',
      assigneeId: master.id,
    });

    platform.userSends('починил трубу, заменил гибкую подводку', { userId: 5030, chatId: 5030 });

    const asked = await waitForMessage(5030, /Понял: сдать работу/);

    assert.match(asked, /Д15-2609-0001/, 'не видно, о каком наряде речь');
    assert.match(asked, /Записать как «починил трубу/, 'слова мастера не попали в отчёт');
    assert.equal(
      (await bot.deps.repository.findRequest(request.id))?.status,
      'in_progress',
      'работа сдана без подтверждения',
    );

    platform.userPressesButton(doingButton(5030), { userId: 5030, chatId: 5030 });
    await waitForMessage(5030, /выполнена/);

    const closed = await bot.deps.repository.findRequest(request.id);

    assert.equal(closed?.status, 'done');
    assert.match(closed?.history.at(-1)?.comment ?? '', /гибкую подводку/, 'отчёт не записан');

    await bot.stop();
  });

  it('жилец принимает работу словами, а не поиском кнопки', async () => {
    const bot = await start([RESIDENT_WITH_FLAT, DISPATCHER_FOR_WORDS]);

    const request = await createServiceRequest(bot.deps, {
      resident: RESIDENT_WITH_FLAT,
      description: 'Не горит лампа на площадке',
      category: 'electricity',
    });

    await untilDoneBy(bot.deps, DISPATCHER_FOR_WORDS, request.id);

    platform.userSends('всё сделали, спасибо', { userId: 3003, chatId: 3003 });

    const asked = await waitForMessage(3003, /Понял: принять работу/);

    assert.match(asked, /Д15-2609-0001/);

    platform.userPressesButton(doingButton(3003), { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята жильцом|закрыта/);

    assert.equal((await bot.deps.repository.findRequest(request.id))?.status, 'confirmed');

    await bot.stop();
  });

  it('когда нарядов несколько, продукт спрашивает, по какому дело', async () => {
    const master: Resident = {
      id: 'tech-many',
      maxUserId: 5032,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, master, DISPATCHER_FOR_WORDS]);

    for (const description of ['Течёт труба в подвале', 'Не работает свет в подъезде']) {
      const request = await createServiceRequest(bot.deps, {
        resident: RESIDENT_WITH_FLAT,
        description,
        category: 'plumbing',
      });

      await transitionRequest(bot.deps, {
        resident: DISPATCHER_FOR_WORDS,
        requestId: request.id,
        to: 'accepted',
      });
      await transitionRequest(bot.deps, {
        resident: DISPATCHER_FOR_WORDS,
        requestId: request.id,
        to: 'in_progress',
        assigneeId: master.id,
      });
    }

    platform.userSends('сделал', { userId: 5032, chatId: 5032 });

    const asked = await waitForMessage(5032, /По какой заявке/);
    const buttons = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

    assert.match(asked, /Понял: сдать работу/);
    assert.equal((buttons.match(/"payload":"do:/g) ?? []).length, 2, 'выбор из двух нарядов не предложен');

    await bot.stop();
  });

  it('слова о сделанном доходят до отчёта и когда наряд выбран кнопкой', async () => {
    const master: Resident = {
      id: 'tech-choice',
      maxUserId: 5034,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, master, DISPATCHER_FOR_WORDS]);
    const ids: string[] = [];

    for (const description of ['Течёт труба в подвале', 'Не работает свет в подъезде']) {
      const request = await createServiceRequest(bot.deps, {
        resident: RESIDENT_WITH_FLAT,
        description,
        category: 'plumbing',
      });

      await transitionRequest(bot.deps, {
        resident: DISPATCHER_FOR_WORDS,
        requestId: request.id,
        to: 'accepted',
      });
      await transitionRequest(bot.deps, {
        resident: DISPATCHER_FOR_WORDS,
        requestId: request.id,
        to: 'in_progress',
        assigneeId: master.id,
      });

      ids.push(request.id);
    }

    platform.userSends('починил трубу, заменил прокладку', { userId: 5034, chatId: 5034 });
    await waitForMessage(5034, /По какой заявке/);

    platform.userPressesButton(doingButton(5034), { userId: 5034, chatId: 5034 });
    await waitForMessage(5034, /выполнена/);

    const closed = await bot.deps.repository.findRequest(ids[0]!);

    assert.equal(closed?.status, 'done');
    assert.match(closed?.history.at(-1)?.comment ?? '', /заменил прокладку/, 'слова мастера не попали в отчёт');

    await bot.stop();
  });

  it('диспетчер поручает наряд мастеру прямо из переписки', async () => {
    const dispatcher: Resident = {
      id: 'disp-assign',
      maxUserId: 5011,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const technician: Resident = {
      id: 'tech-assign',
      maxUserId: 4011,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, dispatcher, technician]);

    platform.userSends('Течёт кран на кухне', { userId: 3003, chatId: 3003 });
    await waitForMessage(5011, /Новая заявка/);

    const [request] = await bot.deps.repository.listRequests({});

    platform.userPressesButton(`req:${request!.id}:accepted`, { userId: 5011, chatId: 5011 });

    const accepted = await waitForMessage(5011, /принята/);

    assert.match(accepted, /Д15/);
    assert.match(
      JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []),
      new RegExp(`assign:${request!.id}`),
      'у принятой заявки без мастера есть «Назначить»',
    );

    platform.userPressesButton(`assign:${request!.id}`, { userId: 5011, chatId: 5011 });
    assert.match(await waitForMessage(5011, /Кому поручить/), /сколько нарядов/);

    platform.userPressesButton(`assign:${request!.id}:tech-assign`, { userId: 5011, chatId: 5011 });
    assert.match(await waitForMessage(5011, /поручена/), /Сергей/);

    await waitForMessage(4011, /Вам поручена заявка/);

    assert.equal((await bot.deps.repository.findRequest(request!.id))?.assigneeId, 'tech-assign');

    await bot.stop();
  });

  it('диспетчер поручает наряд словами, назвав мастера по имени', async () => {
    const dispatcher: Resident = {
      id: 'disp-words',
      maxUserId: 5012,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const technician: Resident = {
      id: 'tech-words',
      maxUserId: 4013,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, dispatcher, technician]);

    const request = await createServiceRequest(bot.deps, {
      resident: RESIDENT_WITH_FLAT,
      description: 'Течёт кран на кухне',
      category: 'plumbing',
    });

    platform.userSends(`назначь Сергея на ${request.number.slice(-4)}`, { userId: 5012, chatId: 5012 });

    const asked = await waitForMessage(5012, /Понял: поручить наряд/);

    assert.match(asked, /Мастер: Сергей\. Поручить\?/);

    platform.userPressesButton(`assign:${request.id}:tech-words`, { userId: 5012, chatId: 5012 });
    await waitForMessage(5012, /поручена/);

    assert.equal((await bot.deps.repository.findRequest(request.id))?.assigneeId, 'tech-words');

    await bot.stop();
  });

  it('закрытые заявки открываются в приложении, а в карточке видно мастера', async () => {
    const technician: Resident = {
      id: 'tech-closed',
      maxUserId: 4012,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, technician]);

    platform.userSends('Течёт кран на кухне', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    await bot.deps.repository.saveRequest({ ...request!, assigneeId: technician.id });

    platform.forgetOutgoing();
    platform.userSends('/my', { userId: 3003, chatId: 3003 });
    assert.match(await waitForMessage(3003, /Течёт кран/), /Работу ведёт Сергей/);

    platform.userSends('/my', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Течёт кран/);

    assert.doesNotMatch(
      JSON.stringify(platform.outgoing.map((message) => message.text)),
      /Это всё, что в работе/,
      'закрытых заявок нет, и предлагать их нечего',
    );

    await transitionRequest(bot.deps, { resident: RESIDENT_WITH_FLAT, requestId: request!.id, to: 'withdrawn' });

    platform.forgetOutgoing();
    platform.userSends('/my', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Заявок пока нет/);

    // Архив закрытых заявок в переписке не листают: он открывается в приложении.
    assert.doesNotMatch(
      JSON.stringify(platform.outgoing.map((message) => message.attachments ?? [])),
      /more:closed/,
      'закрытые остались списком в чате',
    );

    await bot.stop();
  });

  it('под нарушенным сроком стоит кнопка с готовым обращением в инспекцию', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('Не горит свет в подъезде', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    bot.advance(72 * 60 * 60 * 1000);
    platform.forgetOutgoing();

    platform.userPressesButton(`gzhi:${request!.id}`, { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /жилищную инспекцию/);
    assert.match(await waitForMessage(3003, /Государственную жилищную инспекцию/), new RegExp(request!.number));

    await bot.stop();
  });

  it('номер заявки в сообщении открывает её, а не заводит новую', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('Течёт кран на кухне', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    platform.forgetOutgoing();
    platform.userSends(request!.number, { userId: 3003, chatId: 3003 });
    assert.match(await waitForMessage(3003, /Течёт кран/), new RegExp(request!.number));

    platform.userSends('Д15-2609-9999', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /у вас нет/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 1, 'номер новой заявкой не становится');

    await bot.stop();
  });

  it('меню зависит от роли', async () => {
    const manager: Resident = {
      id: 'mgr-3',
      maxUserId: 7009,
      displayName: 'Управляющий',
      role: 'manager',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, manager]);

    platform.userSends('/start', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Здравствуйте/);

    platform.userSends('/start', { userId: 7009, chatId: 7009 });
    await waitForMessage(7009, /Здравствуйте/);

    const keyboardOf = (chatId: number): string =>
      JSON.stringify(platform.outgoing.findLast((message) => message.chatId === chatId)?.attachments ?? []);

    const forResident = keyboardOf(3003);
    const forStaff = keyboardOf(7009);

    assert.match(forResident, /Что сломалось/);
    assert.match(forResident, /Деньги и счётчики/, 'частое кнопками, редкое группами');
    assert.equal(/Смена/.test(forResident), false);
    assert.match(forStaff, /Жильцы/);
    assert.equal(/Деньги и счётчики/.test(forStaff), false, 'своей квартиры у этого управляющего нет');

    // Второй экран меню: пункты группы открываются нажатием.
    platform.userPressesButton('group:money', { userId: 3003, chatId: 3003 });
    assert.match(JSON.stringify((await waitForKeyboard(3003)) ?? []), /Сколько платить|Квитанция/);

    platform.userPressesButton('group:house', { userId: 7009, chatId: 7009 });

    const shift = JSON.stringify((await waitForKeyboard(7009)) ?? []);

    assert.match(shift, /Сводка/);
    assert.equal(/Чат дома/.test(shift), false, 'чат дома привязывают командой в самом чате');

    await bot.stop();
  });

  it('сотрудник, живущий в доме, получает в меню и свои квартирные дела', async () => {
    const living: Resident = {
      id: 'disp-3',
      maxUserId: 7010,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      apartmentId: 'apt-3',
      buildingId: BUILDING_ID,
    };

    const bot = await start([living]);

    platform.userSends('/start', { userId: 7010, chatId: 7010 });
    await waitForMessage(7010, /Здравствуйте/);

    const keyboard = JSON.stringify(
      platform.outgoing.findLast((message) => message.chatId === 7010)?.attachments ?? [],
    );

    assert.match(keyboard, /Жильцы/);
    assert.match(keyboard, /Моя квартира/, 'квартирные дела собраны своей группой');

    platform.userPressesButton('group:home', { userId: 7010, chatId: 7010 });

    const own = JSON.stringify((await waitForKeyboard(7010)) ?? []);

    assert.match(own, /Показания/);
    assert.match(own, /Сколько платить|Квитанция/);
    assert.match(own, /Квартира/);

    await bot.stop();
  });

  it('сотруднику без квартиры квартирные дела в меню не показывают', async () => {
    const dispatcher: Resident = {
      id: 'disp-4',
      maxUserId: 7011,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([dispatcher]);

    platform.userSends('/start', { userId: 7011, chatId: 7011 });
    await waitForMessage(7011, /Здравствуйте/);

    const keyboard = JSON.stringify(
      platform.outgoing.findLast((message) => message.chatId === 7011)?.attachments ?? [],
    );

    assert.equal(/Сколько платить|Квитанция/.test(keyboard), false);
    assert.match(keyboard, /Моя квартира/, 'привязать свою квартиру сотруднику есть чем');

    platform.userPressesButton('group:home', { userId: 7011, chatId: 7011 });

    const own = JSON.stringify((await waitForKeyboard(7011)) ?? []);

    assert.match(own, /Моя квартира/);
    assert.equal(/Показания/.test(own), false, 'счётчиков без квартиры нет');

    await bot.stop();
  });

  it('сотрудник со своей квартирой задаёт вопрос в компанию как жилец', async () => {
    const living: Resident = {
      id: 'disp-own',
      maxUserId: 7013,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      apartmentId: 'apt-3',
      buildingId: BUILDING_ID,
    };

    const bot = await start([living]);

    platform.userSends('/support', { userId: 7013, chatId: 7013 });
    await waitForMessage(7013, /Свой вопрос/);

    platform.userPressesButton('support:own', { userId: 7013, chatId: 7013 });
    await waitForMessage(7013, /Напишите вопрос/);

    platform.userSends('Когда сделают перерасчёт за горячую воду?', { userId: 7013, chatId: 7013 });
    await waitForMessage(7013, /Вопрос принят/);

    const tickets = await bot.deps.repository.listSupportTickets({ buildingId: BUILDING_ID });

    assert.equal(tickets.length, 1, 'вопрос сотрудника не завёлся');
    assert.equal(tickets[0]?.residentId, 'disp-own');

    await bot.stop();
  });

  it('кнопка меню делает то же, что команда', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/start', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Здравствуйте/);

    platform.userPressesButton('menu:new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    platform.userSends('Течёт кран на кухне', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    await bot.stop();
  });

  it('невозможный переход объясняется словами, а не молчанием', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);
    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    platform.userPressesButton(`ask:${request!.id}:rejected`, { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Почему заявка отклоняется/);

    platform.userSends('Передумал', { userId: 3003, chatId: 3003 });

    assert.match(await waitForMessage(3003, /Не получилось/), /Роль «resident»/);

    await bot.stop();
  });

  it('вопрос о доме получает ответ, а заявку заводят кнопкой', async () => {
    const dispatcher: Resident = {
      id: 'disp-1',
      maxUserId: 5005,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, dispatcher]);

    await publishAnnouncement(bot.deps, {
      resident: dispatcher,
      title: 'Замена задвижки',
      body: 'Стояк 1',
      entrance: 1,
      riser: 1,
      works: {
        category: 'plumbing',
        from: new Date('2026-09-03T08:00:00Z'),
        until: new Date('2026-09-03T14:00:00Z'),
      },
    });

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);

    platform.userSends('Когда дадут воду?', { userId: 3003, chatId: 3003 });

    const answer = await waitForMessage(3003, /Замена задвижки/);

    assert.doesNotMatch(answer, /принята/, 'вопрос заявкой не стал');
    assert.deepEqual(await bot.deps.repository.listRequests({}), []);

    platform.userPressesButton('anyway', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 1, 'кнопкой заявка всё же заводится');

    await bot.stop();
  });

  it('у человека две квартиры: он выбирает, по какой смотреть показания', async () => {
    const owner: Resident = {
      ...RESIDENT_WITH_FLAT,
      apartmentIds: ['apt-1', 'apt-2'],
    };

    const bot = await start([owner]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await bot.repository.saveMeter({ id: 'cold-2', apartmentId: 'apt-2', kind: 'cold_water', serial: 'ХВС-2' });

    platform.userSends('/flat', { userId: 3003, chatId: 3003 });

    const list = await waitForMessage(3003, /по ней идут показания/);

    assert.match(list, /квартира 1/);

    platform.userPressesButton('flat:apt-2', { userId: 3003, chatId: 3003 });
    await waitForToast(/квартира 2/);

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /ХВС-2/);

    await bot.stop();
  });

  it('выбранная квартира держится во всех разделах, а не только в счётчиках', async () => {
    const owner: Resident = { ...RESIDENT_WITH_FLAT, apartmentIds: ['apt-1', 'apt-2'] };

    const bot = await start([owner]);

    platform.userSends('/flat', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /по ней идут показания/);

    platform.userPressesButton('flat:apt-2', { userId: 3003, chatId: 3003 });
    await waitForToast(/квартира 2/);

    // Первый экран говорит, по какой квартире идёт разговор.
    platform.userPressesButton('group:back', { userId: 3003, chatId: 3003 });
    assert.match(await waitForMessage(3003, /Домовой: /), /кв\. 2/);

    // Профиль и новая заявка идут по той же квартире.
    platform.userSends('/mydata', { userId: 3003, chatId: 3003 });
    assert.match(await waitForMessage(3003, /Я храню о вас/), /кв\. 2/);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Напишите, что случилось/);
    platform.userSends('Не закрывается окно в комнате', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    assert.equal(
      request?.target.kind === 'apartment' ? request.target.apartmentId : undefined,
      'apt-2',
      'заявка ушла на прежнюю квартиру',
    );

    await bot.stop();
  });

  it('нажатие «Написать» вытесняет ожидание показаний, а не ждёт вместе с ним', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);
    platform.userSends('Течёт кран на кухне', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Отправьте показание числом/);

    platform.userPressesButton(`say:${request!.id}`, { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Напишите ответ одним сообщением/);

    platform.userSends('Буду дома после шести', { userId: 3003, chatId: 3003 });

    const answer = await waitForMessage(3003, /Передал по заявке|Не похоже на число/);

    assert.match(answer, /Передал по заявке/, 'текст ушёл в переписку по заявке, а не в показания');

    await bot.stop();
  });

  it('показание, названное словами, принимается без хождения по разделам', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await bot.repository.saveMeter({ id: 'hot-1', apartmentId: 'apt-1', kind: 'hot_water', serial: 'ГВС-1' });

    platform.userSends('холодная вода 12345', { userId: 3003, chatId: 3003 });

    const answer = await waitForMessage(3003, /Принято/);

    assert.match(said(answer), /Принято: 12\s345 м³/u);

    const readings = await bot.deps.repository.listReadingsFor(['cold-1']);

    assert.equal(readings.length, 1, 'показание не записано');
    assert.equal(readings[0]?.value, 12345);

    await bot.stop();
  });

  it('заявка отзывается только после подтверждения', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    const request = await createServiceRequest(bot.deps, {
      resident: RESIDENT_WITH_FLAT,
      description: 'Разбито стекло в подъезде',
    });

    platform.userPressesButton(`req:${request.id}:withdrawn`, { userId: 3003, chatId: 3003 });

    const asked = await waitForMessage(3003, /Отозвать заявку|Заявка/);

    assert.match(asked, /Отозвать заявку/, 'заявку сняли одним нажатием');
    assert.equal((await bot.deps.repository.findRequest(request.id))?.status, 'new');

    platform.userPressesButton(`req:${request.id}:withdrawn:yes`, { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /снята|отозвана|Заявка/);

    assert.equal((await bot.deps.repository.findRequest(request.id))?.status, 'withdrawn');

    await bot.stop();
  });

  it('повторённое слово в слово обращение новой заявкой не становится', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('В подъезде не горит свет на площадке', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    platform.userSends('В подъезде не горит свет на площадке', { userId: 3003, chatId: 3003 });

    await waitForMessage(3003, /та же заявка/);

    assert.equal((await bot.deps.repository.listRequests({ buildingId: BUILDING_ID })).length, 1);

    await bot.stop();
  });

  it('разряды показания, разделённые пробелом, читаются одним числом', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    platform.userSends('хвс 12 350', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Принято/);

    const readings = await bot.deps.repository.listReadingsFor(['cold-1']);

    assert.equal(readings[0]?.value, 12350, 'разряды с пробелом потеряли тысячи');

    await bot.stop();
  });

  it('два прибора в одном сообщении дают два показания, каждое своему счётчику', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await bot.repository.saveMeter({ id: 'hot-1', apartmentId: 'apt-1', kind: 'hot_water', serial: 'ГВС-1' });

    platform.userSends('гвс 9800 хвс 12350', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Принято: 12\s350/u);

    const cold = await bot.deps.repository.listReadingsFor(['cold-1']);
    const hot = await bot.deps.repository.listReadingsFor(['hot-1']);

    assert.equal(cold[0]?.value, 12350, 'холодной воде досталось чужое число');
    assert.equal(hot[0]?.value, 9800, 'горячая вода осталась без показания');

    await bot.stop();
  });

  it('показание с минусом не принимается', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    platform.userSends('хвс -5', { userId: 3003, chatId: 3003 });

    const answer = await waitForMessage(3003, /./u);

    assert.doesNotMatch(answer, /Принято/, 'минус принят как показание');
    assert.equal((await bot.deps.repository.listReadingsFor(['cold-1'])).length, 0, 'минус записан как показание');

    await bot.stop();
  });

  it('отказ хранилища состояния не оставляет человека без ответа', async () => {
    const bot = await start([RESIDENT_WITH_FLAT], {
      sessionMiddleware: () => Promise.reject(new Error('хранилище недоступно')),
    });

    platform.userSends('Течёт кран на кухне', { userId: 3003, chatId: 3003 });

    const answer = await waitForMessage(3003, /./u);

    assert.match(answer, /Не получилось обработать сообщение/);
    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'заявка без состояния не заводится');

    await bot.stop();
  });

  it('промах по клавишам в ожидании показания не уводит разговор в меню', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Отправьте показание/);

    platform.forgetOutgoing();
    platform.userSends('Sh', { userId: 3003, chatId: 3003 });

    assert.match(await waitForMessage(3003, /./u), /не похоже на показание/i);

    platform.forgetOutgoing();
    platform.userSends('140', { userId: 3003, chatId: 3003 });

    assert.match(await waitForMessage(3003, /./u), /Принято/, 'вопрос о показании остался');

    await bot.stop();
  });

  it('рассказ о поломке в ожидании показания становится заявкой, а не повтором вопроса', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Отправьте показание/);

    platform.userSends('у меня в ванной потоп, вода хлещет из трубы', { userId: 3003, chatId: 3003 });

    const answer = await waitForMessage(3003, /принята|Не похоже на число/);

    assert.match(answer, /принята/, 'авария осталась в вопросе о цифрах');

    await bot.stop();
  });

  it('восемь знаков внутри фразы кодом квартиры не считаются', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    platform.userSends('хвс 99999999', { userId: 3003, chatId: 3003 });

    const answer = await waitForMessage(3003, /Код|принята|Показание/);

    assert.doesNotMatch(answer, /Код/, 'показание прочитали как код квартиры');

    await bot.stop();
  });

  it('код внутри фразы находится так же, как присланный одним сообщением', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('код квартиры LMNPRT47', { userId: 3003, chatId: 3003 });

    const asked = await waitForMessage(3003, /Этот код привяжет квартиру 2/);

    assert.match(asked, /Привязать её\?/);
    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'фраза с кодом стала заявкой');

    platform.userSends('мой код lmnprt47', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Этот код привяжет квартиру 2/);

    await bot.stop();
  });

  it('код своей же квартиры не предлагает привязку заново', async () => {
    const twoFlats: Resident = {
      ...RESIDENT_WITH_FLAT,
      apartmentId: 'apt-2',
      apartmentIds: ['apt-1', 'apt-2'],
    };

    const bot = await start([twoFlats]);

    platform.userSends(FLAT_CODE, { userId: 3003, chatId: 3003 });

    const answer = await waitForMessage(3003, /Квартира 1 уже ваша/);

    assert.doesNotMatch(answer, /привяжет/, 'свою квартиру предложили привязать заново');

    platform.userSends('LMNPRT47', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Квартира 2 уже ваша/);

    assert.equal((await bot.deps.repository.findResidentByMaxUserId(3003))?.apartmentId, 'apt-2');

    await bot.stop();
  });

  it('код чужой квартиры перепривязывает только после ответа человека', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('LMNPRT47', { userId: 3003, chatId: 3003 });

    const answer = await waitForMessage(3003, /Привязать|Теперь я знаю/);

    assert.match(answer, /Привязать/, 'квартиру сменили без подтверждения');
    assert.equal((await bot.deps.repository.findResident('res-1'))?.apartmentId, 'apt-1');

    platform.userPressesButton('bind:LMNPRT47', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /квартире 2/);

    assert.equal((await bot.deps.repository.findResident('res-1'))?.apartmentId, 'apt-2');

    await bot.stop();
  });

  it('жалоба на воду с числом заявкой остаётся, а показанием не становится', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    platform.userSends('нет холодной воды с 6 утра', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    assert.equal((await bot.deps.repository.listReadingsFor(['cold-1'])).length, 0, 'жалоба стала показанием');

    await bot.stop();
  });

  it('показания счётчиков подаются по одному, с прошлым значением перед глазами', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await bot.repository.saveMeter({ id: 'hot-1', apartmentId: 'apt-1', kind: 'hot_water', serial: 'ГВС-1' });
    await bot.repository.saveReading({
      id: 'r-old',
      meterId: 'cold-1',
      value: 120,
      // Прошлый расчётный период: он начинается с 20 числа, а не с первого.
      at: new Date('2026-07-22T10:00:00Z'),
      submittedBy: RESIDENT_WITH_FLAT.id,
    });

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Выберите счётчик/);

    platform.userPressesButton('meter:cold-1', { userId: 3003, chatId: 3003 });

    const first = await waitForMessage(3003, /Холодная вода/);

    assert.match(first, /Прошлое показание: 120 м³/);

    platform.userSends('123,5', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Принято: 123.5 м³/);

    platform.userPressesButton('meter:hot-1', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Горячая вода/);

    platform.userSends('45', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Принято: 45/);

    const readings = await bot.repository.listReadings('cold-1');

    assert.equal(readings[0]?.value, 123.5);
    assert.equal((await bot.repository.listReadings('hot-1')).length, 1);

    await bot.stop();
  });

  it('счётчик выбирают из списка, а не идут по приборам подряд', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await bot.repository.saveMeter({ id: 'power-1', apartmentId: 'apt-1', kind: 'electricity', serial: 'ЭЛ-1' });

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });

    const list = JSON.stringify((await waitForKeyboard(3003)) ?? []);

    assert.match(list, /Холодная вода/);
    assert.match(list, /Электричество/);

    platform.userPressesButton('meter:power-1', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Электричество/);

    platform.userSends('45', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Принято: 45/);

    assert.equal((await bot.repository.listReadings('power-1')).length, 1, 'показание ушло по выбранному прибору');
    assert.equal((await bot.repository.listReadings('cold-1')).length, 0, 'вода осталась нетронутой');

    await bot.stop();
  });

  it('начатый разговор отменяется кнопкой, заявка не заводится', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    platform.userPressesButton('cancel', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Можно написать словами/);

    platform.userSends('Спасибо', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Можно написать словами/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 0);

    await bot.stop();
  });

  it('хождение по меню правит одно сообщение, а не копит их', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/start', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Здравствуйте/);

    platform.forgetOutgoing();

    platform.userSends('/menu', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Можно написать словами/);

    const single = platform.outgoing.length;

    platform.userPressesButton('group:money', { userId: 3003, chatId: 3003 });
    assert.match(JSON.stringify((await waitForKeyboard(3003)) ?? []), /Сколько платить|Квитанция/);

    platform.userPressesButton('group:back', { userId: 3003, chatId: 3003 });
    assert.match(JSON.stringify((await waitForKeyboard(3003)) ?? []), /Деньги и счётчики/);

    assert.equal(platform.outgoing.length, single, 'переписка от хождения по меню не растёт');

    await bot.stop();
  });

  it('заявка из одного знака не заводится, бот просит сказать словами', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    platform.userSends('6', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Напишите словами/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'заявка из знака не заводится');

    platform.userSends('Не горит лампа на площадке', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 1, 'сказанное словами становится заявкой');

    await bot.stop();
  });

  it('отменённая подсказка из переписки убирается', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/start', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Здравствуйте/);
    platform.forgetOutgoing();

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    platform.userPressesButton('cancel', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Можно написать словами/);

    const left = platform.outgoing.filter((message) => /Опишите|Напишите, что случилось/.test(message.text));

    assert.equal(left.length, 0, 'подсказка с «Отмена» в переписке не остаётся');

    await bot.stop();
  });

  it('ответ на подсказку убирает её, а не копит', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    platform.userSends('Не горит лампа на площадке', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    // Подсказку убирают после ответа, уже за пределами самого ответа: ждём,
    // пока это дойдёт, а не сверяем в ту же миллисекунду.
    await untilGone(/Опишите|Напишите, что случилось/);

    await bot.stop();
  });

  it('до согласия обычное сообщение заявкой не становится', async () => {
    const bot = await start();

    platform.userSends('Течёт кран на кухне, вода капает', { userId: 9100, chatId: 9100 });
    await waitForMessage(9100, /персональные данные/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'без согласия заявки нет');

    platform.userPressesButton('legal:accept', { userId: 9100, chatId: 9100 });
    await waitForMessage(9100, /код квартиры из квитанции/);

    await bot.stop();
  });

  it('мастер по наклейке отмечает выезд, а не заводит вторую заявку', async () => {
    const technician: Resident = {
      id: 'tech-onsite',
      maxUserId: 4030,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
      legalVersion: LEGAL_VERSION,
    };

    const dispatcher: Resident = {
      id: 'disp-onsite',
      maxUserId: 5030,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
      legalVersion: LEGAL_VERSION,
    };

    const bot = await start([RESIDENT_WITH_FLAT, technician, dispatcher]);

    const lift = encodeTarget({ kind: 'equipment', buildingId: BUILDING_ID, equipmentId: 'lift-1' });

    await createServiceRequest(bot.deps, {
      resident: RESIDENT_WITH_FLAT,
      description: 'Лифт застрял между этажами',
      startParam: lift,
    });

    const [request] = await bot.deps.repository.listRequests({});

    await transitionRequest(bot.deps, { resident: dispatcher, requestId: request!.id, to: 'accepted' });
    await transitionRequest(bot.deps, {
      resident: dispatcher,
      requestId: request!.id,
      to: 'in_progress',
      assigneeId: technician.id,
    });

    platform.forgetOutgoing();

    // Мастер сканирует ту же наклейку, по которой жилец сообщает о поломке.
    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 4030,
      user: { user_id: 4030, first_name: 'Сергей', is_bot: false },
      payload: lift,
    });

    await waitForMessage(4030, /Вы на месте/);

    platform.userPressesButton(`ask:${request!.id}:done`, { userId: 4030, chatId: 4030 });
    await waitForMessage(4030, /Что сделано/);

    platform.userSends('Поднял кабину, заменил датчик', { userId: 4030, chatId: 4030 });
    await waitForMessage(4030, /выполнена/);

    const saved = await bot.deps.repository.findRequest(request!.id);

    assert.equal((await bot.deps.repository.listRequests({})).length, 1, 'второй заявки не завелось');
    assert.ok(
      saved?.history.some((event) => event.onSite === true),
      'в истории осталась отметка о выезде',
    );

    await bot.stop();
  });

  it('жилец принимает работу с оценкой', async () => {
    const dispatcher: Resident = {
      id: 'disp-rate',
      maxUserId: 5031,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
      legalVersion: LEGAL_VERSION,
    };

    const bot = await start([RESIDENT_WITH_FLAT, dispatcher]);

    platform.userSends('Не горит лампа на площадке', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    await transitionRequest(bot.deps, { resident: dispatcher, requestId: request!.id, to: 'accepted' });
    await transitionRequest(bot.deps, {
      resident: dispatcher,
      requestId: request!.id,
      to: 'in_progress',
      assigneeId: dispatcher.id,
    });
    await transitionRequest(bot.deps, {
      resident: dispatcher,
      requestId: request!.id,
      to: 'done',
      comment: 'Поменял лампу',
    });

    platform.userPressesButton(`req:${request!.id}:confirmed`, { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Как приняли работу/);

    platform.userPressesButton(`rate:${request!.id}:5`, { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /ваша оценка 5/);

    assert.equal((await bot.deps.repository.findRequest(request!.id))?.rating, 5);

    await bot.stop();
  });

  it('на подсказке один выход: отмена, без второй кнопки', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    const shown = JSON.stringify(platform.outgoing.findLast((message) => message.chatId === 3003)?.attachments ?? []);

    assert.match(shown, /Отмена/);
    assert.doesNotMatch(shown, /Меню/, 'у отмены второго выхода нет');
    assert.doesNotMatch(shown, /Назад/);

    await bot.stop();
  });

  it('отмена возвращает туда, откуда пришли: в группу или на первый экран', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/start', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Здравствуйте/);

    platform.userPressesButton('group:me', { userId: 3003, chatId: 3003 });
    await waitForKeyboard(3003);

    platform.userPressesButton('menu:support', { userId: 3003, chatId: 3003 });
    await waitForKeyboard(3003);

    platform.userPressesButton('cancel', { userId: 3003, chatId: 3003 });

    assert.match(JSON.stringify((await waitForKeyboard(3003)) ?? []), /Мои данные/, 'вернулись в «Ещё»');

    platform.userPressesButton('group:back', { userId: 3003, chatId: 3003 });
    await waitForKeyboard(3003);

    platform.userPressesButton('menu:new', { userId: 3003, chatId: 3003 });
    await waitForKeyboard(3003);

    platform.userPressesButton('cancel', { userId: 3003, chatId: 3003 });

    const root = JSON.stringify((await waitForKeyboard(3003)) ?? []);

    assert.match(root, /Что сломалось/, 'с первого экрана отмена возвращает на первый экран');
    assert.doesNotMatch(root, /Мои данные/, 'а не в группу, где человек был раньше');

    await bot.stop();
  });

  it('с каждого экрана видно и шаг назад, и меню', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/start', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Здравствуйте/);

    platform.userPressesButton('group:me', { userId: 3003, chatId: 3003 });
    await waitForKeyboard(3003);

    platform.userPressesButton('menu:mydata', { userId: 3003, chatId: 3003 });

    const shown = JSON.stringify((await waitForKeyboard(3003)) ?? []);

    assert.match(shown, /Назад/, 'шаг назад в «Ещё»');
    assert.match(shown, /Меню/, 'и сразу на первый экран');

    await bot.stop();
  });

  it('в ряду выходов меню стоит первым, а шаг назад вторым', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/support', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Напишите вопрос/);

    platform.userSends('Когда включат отопление?', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Вопрос принят/);

    const rows = (platform.outgoing.findLast((message) => message.chatId === 3003)?.attachments ?? []).flatMap(
      (attachment) => (attachment as { payload?: { buttons?: { payload?: string }[][] } }).payload?.buttons ?? [],
    );
    const exits = rows.find((row) => row.some((button) => button.payload === 'cancel'));
    const payloads = (exits ?? []).map((button) => button.payload);

    assert.deepEqual(payloads, ['group:back', 'cancel'], 'меню и шаг назад стоят не в том порядке');

    await bot.stop();
  });

  it('дела приложения видны в меню бота и открываются кнопкой', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/start', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Здравствуйте/);

    platform.userPressesButton('group:house', { userId: 3003, chatId: 3003 });

    const house = JSON.stringify((await waitForKeyboard(3003)) ?? []);

    assert.match(house, /Капитальный ремонт/, 'о капремонте человек узнаёт из меню бота');

    platform.userPressesButton('app:capital', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Взнос, накопленное домом/);

    const shown = JSON.stringify(platform.outgoing.findLast((message) => message.chatId === 3003)?.attachments ?? []);

    assert.match(shown, /startapp=go-capital/, 'кнопка ведёт прямо в раздел приложения');
    assert.match(shown, /Назад/, 'из рассказа есть выход');

    await bot.stop();
  });

  it('дела управляющего мастеру в меню не показывают', async () => {
    const manager: Resident = {
      id: 'mgr-menu',
      maxUserId: 7031,
      displayName: 'Нина',
      role: 'manager',
      buildingId: BUILDING_ID,
      legalVersion: LEGAL_VERSION,
    };

    const technician: Resident = {
      id: 'tech-menu',
      maxUserId: 7032,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
      legalVersion: LEGAL_VERSION,
    };

    const bot = await start([manager, technician]);

    platform.userSends('/start', { userId: 7031, chatId: 7031 });
    const forManager = JSON.stringify((await waitForKeyboard(7031)) ?? []);

    platform.userSends('/start', { userId: 7032, chatId: 7032 });
    const forTechnician = JSON.stringify((await waitForKeyboard(7032)) ?? []);

    assert.match(forManager, /Управление/);
    assert.equal(/Управление/.test(forTechnician), false, 'мастеру эти дела не поручены');

    await bot.stop();
  });

  it('отмена возвращает в ту группу меню, из которой начали', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/menu', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Можно написать словами/);

    platform.userPressesButton('group:house', { userId: 3003, chatId: 3003 });
    await waitForKeyboard(3003);

    platform.userPressesButton('menu:neighbours', { userId: 3003, chatId: 3003 });
    await waitForKeyboard(3003);

    platform.userPressesButton('cancel', { userId: 3003, chatId: 3003 });

    const back = JSON.stringify((await waitForKeyboard(3003)) ?? []);

    assert.match(back, /Объявления/, 'вернулись в группу «Дом», а не на первый экран');

    await bot.stop();
  });

  it('длинный список заявок уводит в приложение, а не листается в чате', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    for (let number = 0; number < 7; number += 1) {
      platform.userSends(`Не горит лампа на этаже ${number + 1}`, { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /принята/);
    }

    platform.forgetOutgoing();
    platform.userSends('/my', { userId: 3003, chatId: 3003 });

    const said = await waitForMessage(3003, /Ваших заявок в работе/);
    const cards = platform.outgoing.filter((message) => /Не горит лампа/.test(message.text));

    assert.match(said, /Ваших заявок в работе: 7/);
    assert.equal(cards.length, 0, 'простыня карточек в переписку не уходит');

    const last = platform.outgoing.findLast((message) => message.chatId === 3003);

    assert.match(JSON.stringify(last?.attachments ?? []), /Заявки в приложении/);
    assert.doesNotMatch(JSON.stringify(last?.attachments ?? []), /more:my/, 'список всё ещё листается кнопкой');

    await bot.stop();
  });

  it('счётчик без поверки не спрашивают, а объясняют, что с ним делать', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({
      id: 'cold-1',
      apartmentId: 'apt-1',
      kind: 'cold_water',
      serial: 'ХВС-1',
      verifiedUntil: new Date('2020-01-01T00:00:00Z'),
    });
    await bot.repository.saveMeter({ id: 'hot-1', apartmentId: 'apt-1', kind: 'hot_water', serial: 'ГВС-1' });

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });

    const warning = await waitForMessage(3003, /Истёк срок проверки/);

    assert.match(warning, /Холодная вода № ХВС-1/);
    assert.match(warning, /считают по средней норме/);

    const asked = await waitForMessage(3003, /Отправьте показание числом/);

    assert.match(asked, /Горячая вода/);
    assert.doesNotMatch(asked, /ХВС-1/);

    await bot.stop();
  });

  it('нечисло вместо показания объясняется, а не молча теряется', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Отправьте показание числом/);

    platform.userSends('примерно сто', { userId: 3003, chatId: 3003 });

    const said = await waitForMessage(3003, /Не похоже на число/);
    const keyboard = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

    assert.match(said, /например 123.456/);
    assert.match(keyboard, /cancel/, 'из подачи показаний нечем выйти');
    assert.equal((await bot.repository.listReadings('cold-1')).length, 0);

    // Ожидание осталось: следующее число подаётся тем же разговором.
    platform.userSends('130', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Принято/);

    assert.equal((await bot.repository.listReadings('cold-1')).length, 1);

    await bot.stop();
  });

  it('неверное показание отклоняется с причиной', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });
    await bot.repository.saveReading({
      id: 'r-old',
      meterId: 'cold-1',
      value: 120.5,
      // Прошлый расчётный период: он начинается с 20 числа, а не с первого.
      at: new Date('2026-07-22T10:00:00Z'),
      submittedBy: RESIDENT_WITH_FLAT.id,
    });

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });

    const prompt = await waitForMessage(3003, /Прошлое показание/);

    assert.match(prompt, /120,5/, 'числа в переписке везде с запятой');

    platform.userSends('100', { userId: 3003, chatId: 3003 });

    const refused = await waitForMessage(3003, /не принято/);

    assert.match(refused, /не может показать меньше/);

    // После отказа показание повторяют тем же вводом: ожидание не снято.
    platform.userSends('130', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Принято/);

    assert.equal((await bot.repository.listReadings('cold-1')).length, 2);

    await bot.stop();
  });

  it('когда всё подано, бот не спрашивает по второму разу', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Отправьте показание числом/);

    platform.userSends('130', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Принято/);

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });

    assert.match(await waitForMessage(3003, /уже поданы/), /Спасибо/);

    await bot.stop();
  });

  it('новому человеку бот сначала показывает документы, а потом делает дело', async () => {
    const bot = await start();

    platform.userSends('/meters', { userId: 9010, chatId: 9010 });

    const asked = await waitForMessage(9010, /по поручению управляющей организации/);
    const buttons = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

    assert.match(asked, /Нажимая «Принимаю»/);
    assert.match(buttons, /Принимаю/);
    assert.match(buttons, /privacy/, 'ссылки на политику нет');
    assert.match(buttons, /terms/, 'ссылки на соглашение нет');

    // После согласия бот доделывает то, о чём просили: команду повторять не нужно.
    platform.userPressesButton('legal:accept', { userId: 9010, chatId: 9010 });

    assert.match(await waitForMessage(9010, /код квартиры/), /из квитанции/);

    await bot.stop();
  });

  it('без счётчиков команда так и говорит', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/meters', { userId: 3003, chatId: 3003 });

    assert.match(await waitForMessage(3003, /счётчиков не записано/), /Написать в компанию|управляющей компании/);

    await bot.stop();
  });

  it('бюллетень приходит кнопками, а доли считаются по площади', async () => {
    const manager: Resident = {
      id: 'mgr-4',
      maxUserId: 7010,
      displayName: 'Управляющий',
      role: 'manager',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, manager]);

    await bot.repository.saveApartment({ ...APARTMENTS[0]!, area: 75 });
    await bot.repository.saveApartment({ ...APARTMENTS[1]!, area: 15 });
    await bot.repository.saveApartment({ ...APARTMENTS[2]!, area: 10 });

    const poll = await bot.repository.savePoll({
      id: 'poll-1',
      buildingId: BUILDING_ID,
      kind: 'simple',
      title: 'Ремонт подъездов',
      question: 'Утвердить смету',
      opensAt: new Date('2026-09-01T10:00:00Z'),
      closesAt: new Date('2026-09-30T10:00:00Z'),
    });

    // Бюллетень живёт на экране: в переписке остаётся строка и переход.
    platform.userSends('/vote', { userId: 3003, chatId: 3003 });

    const handoff = await waitForMessage(3003, /Собрания собственников/);

    assert.match(handoff, /Открытых собраний: 1/);
    assert.match(JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []), /startapp=go-polls/);

    // Голос под уведомлением о собрании остаётся: это одно нажатие.
    platform.userPressesButton(`vote:${poll.id}:for`, { userId: 3003, chatId: 3003 });

    const result = await waitForMessage(3003, /Голос квартиры/);

    assert.match(result, /Участие: 75% площади дома/);
    assert.match(result, /За: 75%/);
    assert.match(result, /Голос квартиры: за/);
    assert.equal((await bot.repository.listVotes(poll.id)).length, 1);

    await bot.stop();
  });

  it('без открытых собраний команда так и говорит', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/vote', { userId: 3003, chatId: 3003 });

    assert.match(await waitForMessage(3003, /Открытых собраний сейчас нет/), /Открытых собраний сейчас нет/);

    await bot.stop();
  });

  it('голос после закрытия не принимается', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    const poll = await bot.repository.savePoll({
      id: 'poll-old',
      buildingId: BUILDING_ID,
      kind: 'simple',
      title: 'Прошлое собрание',
      question: 'Вопрос',
      opensAt: new Date('2026-07-01T10:00:00Z'),
      closesAt: new Date('2026-07-15T10:00:00Z'),
    });

    platform.userPressesButton(`vote:${poll.id}:for`, { userId: 3003, chatId: 3003 });

    assert.match(await waitForToast(/Голос не принят/), /Итоги подведены/);

    await bot.stop();
  });

  it('код квартиры привязывает жильца, а не заводит заявку', async () => {
    const bot = await start();
    const payload = apartmentKeyParam(FLAT_CODE);

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 4005,
      user: { user_id: 4005, first_name: 'Новосёл', is_bot: false },
      payload,
    });

    await chooseLanguage(4005, 4005);

    const greeting = await waitForMessage(4005, /Теперь я знаю, что вы в квартире/);

    assert.match(greeting, /квартире 1/);
    assert.match(greeting, /цифры со счётчиков/);

    const resident = await bot.deps.repository.findResidentByMaxUserId(4005);

    assert.equal(resident?.apartmentId, 'apt-1');
    assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'заявка не создавалась');

    await bot.stop();
  });

  it('повторный переход по коду квартиры это замечает', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);
    const payload = apartmentKeyParam(FLAT_CODE);

    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: 3003,
      user: { user_id: 3003, first_name: 'Мария', is_bot: false },
      payload,
    });

    assert.match(await waitForMessage(3003, /уже привязаны/), /квартире 1/);

    await bot.stop();
  });

  it('позиция в потоке переживает перезапуск', async () => {
    const markerStore = new MemoryMarkerStore();
    const first = await start([RESIDENT_WITH_FLAT], { markerStore });

    platform.userSends('/my', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Заявок пока нет/);
    await first.stop();

    assert.ok(markerStore.load() !== undefined, 'позиция сохранена вне процесса');

    const before = platform.outgoing.length;

    const restarted = await start([RESIDENT_WITH_FLAT], { markerStore });

    await new Promise((resolve) => setTimeout(resolve, 400));

    assert.equal(platform.outgoing.length, before, 'обработанное заново не приходит');

    await restarted.stop();
  });

  it('пустая лента объявлений так и говорит', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/news', { userId: 3003, chatId: 3003 });

    assert.match(await waitForMessage(3003, /Объявлений пока нет/), /Объявлений пока нет/);

    await bot.stop();
  });

  it('недоставленное уведомление сценарий не роняет', async () => {
    const dispatcher: Resident = {
      id: 'disp-5',
      maxUserId: 5009,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const failures: unknown[] = [];
    const bot = await start([RESIDENT_WITH_FLAT, dispatcher], {
      onNotifyError: (error) => failures.push(error),
    });

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Опишите|Напишите, что случилось/);

    platform.chaos.failNext(400, { times: 1, path: 'messages' });

    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 1);
    assert.ok(failures.length > 0, 'о неудачной доставке сообщено, а не проглочено');

    await bot.stop();
  });

  it('жильцу кнопка сотрудника не помогает', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);
    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(2, 3000);

    const [request] = await bot.deps.repository.listRequests({});

    platform.userPressesButton(`req:${request!.id}:accepted`, { userId: 3003, chatId: 3003 });

    assert.match(await waitForToast(/Не получилось/), /Не получилось/);
    assert.equal((await bot.deps.repository.findRequest(request!.id))?.status, 'new');

    await bot.stop();
  });

  it('мастеру /my показывает наряды, а не его собственные жалобы', async () => {
    const master: Resident = {
      id: 'tech-my',
      maxUserId: 6008,
      displayName: 'Сергей, мастер',
      role: 'technician',
      buildingId: BUILDING_ID,
    };

    const olga: Resident = {
      id: 'disp-my',
      maxUserId: 5008,
      displayName: 'Ольга, диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, olga, master]);

    platform.userSends('/my', { userId: 6008, chatId: 6008 });
    await waitForMessage(6008, /На вас ничего не назначено/);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(2, 3000);
    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    platform.userPressesButton(`req:${request!.id}:accepted`, { userId: 5008, chatId: 5008 });
    await waitForMessage(5008, /принята в работу/);

    await transitionRequest(bot.deps, {
      resident: master,
      requestId: request!.id,
      to: 'in_progress',
      assigneeId: master.id,
    });

    platform.userSends('/my', { userId: 6008, chatId: 6008 });
    await waitForMessage(6008, new RegExp(request!.number));

    await bot.stop();
  });

  it('во время объявленных работ бот отвечает сроком, а не номером заявки', async () => {
    const olga: Resident = {
      id: 'disp-works',
      maxUserId: 5007,
      displayName: 'Ольга, диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, olga]);

    await publishAnnouncement(bot.deps, {
      resident: olga,
      title: 'Замена задвижки',
      body: 'Отключение горячей воды на время работ',
      entrance: 1,
      riser: 1,
      works: {
        category: 'plumbing',
        from: new Date(bot.deps.now().getTime() - 3600_000),
        until: new Date(bot.deps.now().getTime() + 4 * 3600_000),
      },
    });

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);

    platform.userSends('Нет горячей воды', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /плановые работы до/);

    assert.deepEqual(await bot.deps.repository.listRequests({}), [], 'заявка не заводилась');

    platform.userPressesButton('anyway', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    assert.equal((await bot.deps.repository.listRequests({})).length, 1);

    await bot.stop();
  });

  it('жилец отвечает по заявке прямо в чате, не открывая приложение', async () => {
    const dispatcher: Resident = {
      id: 'disp-1',
      maxUserId: 5006,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, dispatcher]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);
    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /принята/);

    const [request] = await bot.deps.repository.listRequests({});

    platform.userPressesButton(`say:${request!.id}`, { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Напишите ответ/);

    platform.userSends('Дома после шести', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Передал по заявке/);

    const saved = await bot.deps.repository.findRequest(request!.id);
    const last = saved?.history.at(-1);

    assert.equal(last?.kind, 'message', 'сообщение не выдаёт себя за смену состояния');
    assert.equal(last?.comment, 'Дома после шести');
    assert.equal(saved?.status, request!.status, 'состояние заявки разговор не трогает');

    assert.match(await waitForMessage(5006, /Дома после шести/), /Жилец пишет/);

    await bot.stop();
  });

  it('кнопка «Написать» приходит вместе с уведомлением по открытой заявке', async () => {
    const dispatcher: Resident = {
      id: 'disp-1',
      maxUserId: 5006,
      displayName: 'Диспетчер',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const bot = await start([RESIDENT_WITH_FLAT, dispatcher]);

    platform.userSends('/new', { userId: 3003, chatId: 3003 });
    await platform.waitForOutgoing(1, 3000);
    platform.userSends('Течёт кран', { userId: 3003, chatId: 3003 });
    await waitForMessage(5006, /Новая заявка/);

    const toStaff = platform.outgoing.findLast((message) => message.userId === dispatcher.maxUserId);
    const buttons = JSON.stringify(toStaff?.attachments ?? []);

    assert.match(buttons, /Написать/, 'уточнить у жильца можно из уведомления');

    await bot.stop();
  });

  it('после перезапуска кнопка «всё равно» просит написать заново, а не молчит', async () => {
    const bot = await start([RESIDENT_WITH_FLAT]);

    platform.userPressesButton('anyway', { userId: 3003, chatId: 3003 });
    await waitForMessage(3003, /Напишите ещё раз/);

    assert.deepEqual(await bot.deps.repository.listRequests({}), []);

    await bot.stop();
  });

  describe('передача обращения смежной организации', () => {
    const DISPATCHER: Resident = {
      id: 'disp-pass',
      maxUserId: 6007,
      displayName: 'Ольга Титова',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    it('смена передаёт обращение из переписки, а жилец видит срок ответа', async () => {
      const bot = await start([RESIDENT_WITH_FLAT, DISPATCHER]);

      platform.userSends('Нет холодной воды во всём стояке', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /принята/);

      const [request] = await bot.deps.repository.listRequests({});
      const number = request?.number ?? '';

      platform.userSends(number, { userId: 6007, chatId: 6007 });

      const card = await waitForMessage(6007, /Отвечает/);

      assert.match(card, /Управляющая организация/);
      assert.equal(/ЖК РФ/.test(card), false, 'норму закона смене в каждой карточке не печатают');

      platform.userPressesButton(`pass:${request?.id ?? ''}`, { userId: 6007, chatId: 6007 });
      await waitForMessage(6007, /Кому передать/);

      const offered = platform.outgoing.at(-1);

      assert.match(JSON.stringify(offered?.attachments ?? []), /Водоканал/, 'организация стоит кнопкой');

      platform.userPressesButton(`pass-to:${request?.id ?? ''}:resource`, { userId: 6007, chatId: 6007 });
      await waitForMessage(6007, /Передано: Водоканал/);

      const told = await waitForMessage(3003, /передано в Водоканал/);

      assert.match(told, /Ответ ожидается до/);
      assert.match(told, /остаётся на контроле/);

      const [handoff] = await bot.deps.repository.listHandoffs({ requestId: request?.id ?? '' });

      platform.userPressesButton(`handoff:${handoff?.id ?? ''}`, { userId: 6007, chatId: 6007 });
      await waitForMessage(6007, /Что ответила организация/);

      platform.userSends('Задвижку на вводе заменили', { userId: 6007, chatId: 6007 });
      await waitForMessage(6007, /Записал ответ/);

      assert.match(await waitForMessage(3003, /Водоканал ответила/), /Задвижку на вводе/);

      await bot.stop();
    });

    it('жилец обращение не передаёт', async () => {
      const bot = await start([RESIDENT_WITH_FLAT, DISPATCHER]);

      platform.userSends('Нет холодной воды во всём стояке', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /принята/);

      const [request] = await bot.deps.repository.listRequests({});

      platform.userPressesButton(`pass:${request?.id ?? ''}`, { userId: 3003, chatId: 3003 });

      assert.match(await waitForToast(/управляющая организация/), /Передаёт обращение/);
      assert.deepEqual(await bot.deps.repository.listHandoffs({}), []);

      await bot.stop();
    });
  });

  describe('вопрос в управляющую компанию', () => {
    const DISPATCHER: Resident = {
      id: 'disp-support',
      maxUserId: 6006,
      displayName: 'Ольга Титова',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    it('вопрос жильца уходит смене, а ответ возвращается в переписку', async () => {
      const bot = await start([RESIDENT_WITH_FLAT, DISPATCHER]);

      platform.userSends('/support', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Напишите вопрос/);

      platform.userSends('Когда включат отопление?', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Вопрос принят/);
      await waitForMessage(6006, /Вопрос в поддержку/);

      const [ticket] = await bot.deps.repository.listSupportTickets({ buildingId: BUILDING_ID });

      platform.userPressesButton(`ticket:${ticket?.id ?? ''}`, { userId: 6006, chatId: 6006 });
      await waitForMessage(6006, /Напишите ответ жильцу/);

      platform.userSends('Тепло подадим 25 сентября.', { userId: 6006, chatId: 6006 });
      assert.match(await waitForMessage(3003, /25 сентября/), /отопление/i);

      await bot.stop();
    });

    it('смена видит вопросы дома, а жилец только свои', async () => {
      const bot = await start([RESIDENT_WITH_FLAT, DISPATCHER]);

      platform.userSends('/support', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Напишите вопрос/);
      platform.userSends('Кто меняет лампочку в подъезде?', { userId: 3003, chatId: 3003 });
      await waitForMessage(6006, /Вопрос в поддержку/);

      platform.userSends('/support', { userId: 6006, chatId: 6006 });
      const listed = await waitForMessage(6006, /ждёт /);

      assert.match(listed, /Мария, кв\. 1 · ждёт /, 'смене видно, кто спросил и сколько ждёт');

      await bot.stop();
    });

    it('без вопросов смене отвечают прямо', async () => {
      const bot = await start([DISPATCHER]);

      platform.userSends('/support', { userId: 6006, chatId: 6006 });
      await waitForMessage(6006, /Вопросов от жильцов нет/);

      await bot.stop();
    });

    it('команда контактов называет ответственного и дежурного', async () => {
      const bot = await start([RESIDENT_WITH_FLAT, DISPATCHER]);

      await bot.repository.saveBuilding({
        id: BUILDING_ID,
        code: 'Д15',
        address: 'ул. Ленина, 15',
        contact: {
          name: 'Гордеева Нина Павловна',
          role: 'управляющая домом',
          phone: '+7 900 120-45-15',
          email: 'nina@uk.ru',
        },
      });
      await bot.repository.saveResident({ ...DISPATCHER, onDuty: true });

      platform.userSends('/contacts', { userId: 3003, chatId: 3003 });
      const answer = await waitForMessage(3003, /Гордеева Нина Павловна/);

      assert.match(answer, /\+7 900 120-45-15/);
      assert.match(answer, /nina@uk\.ru/);
      assert.match(answer, /Дежурит сейчас: Ольга Титова/);

      await bot.stop();
    });
  });

  describe('дежурство смены', () => {
    const dispatcher: Resident = {
      id: 'disp-duty',
      maxUserId: 5005,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    const technician: Resident = {
      id: 'tech-duty',
      maxUserId: 4004,
      displayName: 'Сергей',
      role: 'technician',
      buildingId: BUILDING_ID,
      onDuty: true,
    };

    it('дежурство принимают и сдают из переписки', async () => {
      const bot = await start([dispatcher, technician]);

      platform.userSends('/duty', { userId: 5005, chatId: 5005 });
      assert.match(await waitForMessage(5005, /Дежурство принято/), /Вместе с вами: Сергей/);

      assert.equal((await bot.deps.repository.findResident('disp-duty'))?.onDuty, true);

      platform.userSends('/duty', { userId: 5005, chatId: 5005 });
      assert.match(await waitForMessage(5005, /Дежурство снято/), /На дежурстве: Сергей/);

      await bot.stop();
    });

    it('жильцу дежурство не назначают', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);

      platform.userSends('/duty', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Дежурят сотрудники/);

      await bot.stop();
    });
  });

  describe('ввод без сути', () => {
    it('сообщение из одних значков заявкой не становится', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);

      platform.userSends('😀😀😀😀😀', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Можно написать словами/);

      assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'заявка не заводится');

      await bot.stop();
    });

    it('пустое сообщение просит написать словами', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);

      platform.userSends('   ', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Напишите одной строкой/);

      assert.equal((await bot.deps.repository.listRequests({})).length, 0);

      await bot.stop();
    });

    it('кнопка из старого сообщения не оставляет человека ни с чем', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);

      platform.userPressesButton('такой-кнопки-нет:1', { userId: 3003, chatId: 3003 });
      await waitForToast(/уже не работает/);

      platform.userPressesButton('menu:нет-такого-раздела', { userId: 3003, chatId: 3003 });

      // Уведомление живёт пару секунд: следом приходит меню, по которому видно,
      // что делать дальше.
      await waitForMessage(3003, /с чего можно начать/);

      await bot.stop();
    });
  });

  describe('запись на приём', () => {
    it('жилец записывается в приложении, а свою запись отменяет из переписки', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);
      const manager: Resident = {
        id: 'man-visit',
        maxUserId: 7007,
        displayName: 'Нина',
        role: 'manager',
        buildingId: BUILDING_ID,
      };

      await bot.deps.repository.saveResident(manager);
      // Одно короткое окно: ближайшие часы остаются кнопками в переписке.
      await updateBuilding(bot.deps, manager, {
        reception: [{ weekday: 2, from: '15:00', to: '16:00' }],
        service: { office: 'ул. Ленина, 15, офис 1' },
      });

      // Выбор времени это календарь: бот называет число свободных часов и уводит
      // на экран, где видно дни.
      platform.userSends('/visit', { userId: 3003, chatId: 3003 });

      const said = await waitForMessage(3003, /Свободных часов/);

      assert.match(said, /Приём: ул\. Ленина, 15, офис 1/);
      assert.match(JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []), /startapp=go-visits/);

      const guest = (await bot.deps.repository.findResidentByMaxUserId(3003))!;
      const reception = await receptionFor(bot.deps, guest);

      await takeVisit(bot.deps, {
        resident: guest,
        at: reception.slots[0]!,
        topic: 'Перерасчёт за горячую воду',
      });

      const booked = await bot.deps.repository.listVisits({ residentId: 'res-1', statuses: ['booked'] });

      assert.equal(booked.length, 1);
      assert.equal(booked[0]?.topic, 'Перерасчёт за горячую воду');

      // Своя запись видна в переписке, и отменяется она там же.
      platform.userSends('/visit', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Вы записаны на приём/);

      platform.userPressesButton(`visit-cancel:${booked[0]?.id ?? ''}`, { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Запись на приём отменена/);

      assert.equal((await bot.deps.repository.listVisits({ statuses: ['booked'] })).length, 0);

      await bot.stop();
    });

    it('когда часов много, бот называет их число и открывает календарь', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);
      const manager: Resident = {
        id: 'man-many',
        maxUserId: 7008,
        displayName: 'Нина',
        role: 'manager',
        buildingId: BUILDING_ID,
      };

      await bot.deps.repository.saveResident(manager);
      await updateBuilding(bot.deps, manager, {
        reception: [
          { weekday: 1, from: '10:00', to: '18:00' },
          { weekday: 3, from: '10:00', to: '18:00' },
        ],
        service: { office: 'ул. Ленина, 15, офис 1' },
      });

      platform.userSends('/visit', { userId: 3003, chatId: 3003 });

      const said = await waitForMessage(3003, /Свободных часов/);

      assert.match(said, /Приём: ул\. Ленина, 15, офис 1/);
      assert.match(JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []), /startapp=go-visits/);

      await bot.stop();
    });

    it('без приёмных окон бот об этом и говорит', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);

      platform.userSends('/visit', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Приём по записи не ведётся/);

      await bot.stop();
    });
  });

  describe('роли для проверки', () => {
    it('роль примеряется кнопкой и меню становится сменным', async () => {
      const bot = await start([RESIDENT_WITH_FLAT], { demo: true });

      platform.userSends('/demo', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Кем смотрим продукт/);

      const buttons = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

      assert.match(buttons, /Диспетчер/);
      assert.match(buttons, /demo:manager/);

      platform.userPressesButton('demo:dispatcher', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Роль: диспетчер/i);

      assert.equal((await bot.deps.repository.findResident('res-1'))?.role, 'dispatcher');

      await bot.stop();
    });

    it('в обычной установке роль не меняется', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);

      platform.userSends('/demo', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /выключено/);

      platform.userPressesButton('demo:manager', { userId: 3003, chatId: 3003 });
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.equal((await bot.deps.repository.findResident('res-1'))?.role, 'resident');

      await bot.stop();
    });
  });

  describe('наклейки с кодами объектов', () => {
    it('бот называет число объектов и открывает наклейки в приложении', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);

      platform.userSends('/stickers', { userId: 3003, chatId: 3003 });

      const said = await waitForMessage(3003, /Объектов с кодами/);
      const buttons = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

      assert.match(said, /придёт сюда файлом/);
      assert.match(buttons, /Наклейки в приложении/);
      assert.doesNotMatch(buttons, /sticker:/, 'выбор объекта остался в переписке');

      await bot.stop();
    });
  });

  describe('рассылка управляющей компании', () => {
    const dispatcher: Resident = {
      id: 'disp-cast',
      maxUserId: 5005,
      displayName: 'Ольга',
      role: 'dispatcher',
      buildingId: BUILDING_ID,
    };

    it('бот открывает рассылку в приложении, а не собирает её в переписке', async () => {
      const bot = await start([dispatcher, RESIDENT_WITH_FLAT]);

      platform.userSends('/broadcast', { userId: 5005, chatId: 5005 });

      await waitForMessage(5005, /Рассылка собирается в приложении/);
      const buttons = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

      assert.match(buttons, /Рассылка в приложении/);
      assert.doesNotMatch(buttons, /cast:/, 'выбор адресата остался в переписке');

      await bot.stop();
    });

    it('жилец рассылку не отправляет', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);

      platform.userSends('/broadcast', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /чужие данные/);

      await bot.stop();
    });
  });

  describe('разговор без тупиков', () => {
    it('команда снимает прежнее ожидание, и рассказ о поломке становится заявкой', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);

      platform.userSends('/help', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Спрашивайте о доме/);

      platform.userSends('/my', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Заявок пока нет/);

      platform.userSends('Течёт кран на кухне, вода капает постоянно', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /принята/);

      assert.equal((await bot.deps.repository.listRequests({})).length, 1, 'сообщение ушло помощнику');

      await bot.stop();
    });

    it('вежливое «спасибо» после поддержки обращением не становится', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);

      platform.userSends('/support', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Напишите вопрос/);

      platform.userSends('спасибо', { userId: 3003, chatId: 3003 });
      await waitForMessage(3003, /Можно написать словами/);

      assert.equal((await bot.deps.repository.listSupportTickets({ buildingId: BUILDING_ID })).length, 0);

      await bot.stop();
    });

    it('без квартиры бот ждёт код и объясняет неподходящий ввод', async () => {
      const newcomer: Resident = {
        id: 'res-9',
        maxUserId: 3010,
        displayName: 'Пётр',
        role: 'resident',
        buildingId: BUILDING_ID,
      };

      const bot = await start([newcomer]);

      platform.userSends('/flat', { userId: 3010, chatId: 3010 });
      await waitForMessage(3010, /код из 8 знаков/);

      platform.userSends('не помню', { userId: 3010, chatId: 3010 });
      await waitForMessage(3010, /Код не подошёл/);

      platform.userSends(FLAT_CODE, { userId: 3010, chatId: 3010 });
      await waitForMessage(3010, /вы в квартире 1/);

      assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'ввод кода стал заявкой');

      await bot.stop();
    });

    it('из списка долгов кнопка ведёт в рассылку, а не устаревает', async () => {
      const manager: Resident = {
        id: 'mgr-debts',
        maxUserId: 7020,
        displayName: 'Нина',
        role: 'manager',
        buildingId: BUILDING_ID,
      };

      const bot = await start([manager]);

      platform.userPressesButton('cast:debtors', { userId: 7020, chatId: 7020 });
      await waitForMessage(7020, /Рассылка собирается в приложении/);

      await bot.stop();
    });

    it('чат дома привязывают в самом чате, а в переписке остаётся меню', async () => {
      const manager: Resident = {
        id: 'mgr-here',
        maxUserId: 7021,
        displayName: 'Нина',
        role: 'manager',
        buildingId: BUILDING_ID,
      };

      const bot = await start([manager]);

      platform.userSends('/here', { userId: 7021, chatId: 7021 });

      const said = await waitForMessage(7021, /в чате дома/);
      const keyboard = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

      assert.match(said, /\/here/);
      assert.match(keyboard, /group:back/, 'ответ без кнопок оставляет человека ни с чем');

      await bot.stop();
    });
  });

  describe('общий чат дома', () => {
    const HOUSE_CHAT = 5500;

    const MANAGER: Resident = {
      id: 'mgr-chat',
      maxUserId: 7007,
      displayName: 'Нина',
      role: 'manager',
      buildingId: BUILDING_ID,
    };

    /** Чат привязан к дому: с этого начинается всё остальное. */
    const withHouseChat = async (residents: Resident[] = []) => {
      const bot = await start([MANAGER, ...residents]);

      platform.botAdded({ userId: MANAGER.maxUserId, chatId: HOUSE_CHAT });
      await waitForMessage(HOUSE_CHAT, /Чат привязан к дому/);

      return bot;
    };

    it('добавленный управляющим бот привязывает чат сам', async () => {
      const bot = await withHouseChat();

      assert.equal((await bot.deps.repository.findBuilding(BUILDING_ID))?.chatId, HOUSE_CHAT);

      await bot.stop();
    });

    it('добавленный жильцом бот объясняет, чего не хватает', async () => {
      const bot = await start([RESIDENT_WITH_FLAT]);

      platform.botAdded({ userId: 3003, chatId: HOUSE_CHAT });
      const said = await waitForMessage(HOUSE_CHAT, /Домовой/);

      assert.match(said, /\/here/);
      assert.equal((await bot.deps.repository.findBuilding(BUILDING_ID))?.chatId, undefined);

      await bot.stop();
    });

    it('в разговор соседей не вмешивается', async () => {
      const bot = await withHouseChat();
      const before = platform.outgoing.length;

      platform.chatSends('Кто-нибудь знает, когда включат воду?', { userId: 4004, chatId: HOUSE_CHAT });
      await new Promise((resolve) => setTimeout(resolve, 250));

      assert.equal(platform.outgoing.length, before, 'бот ответил, хотя к нему не обращались');
      assert.deepEqual(await bot.deps.repository.listRequests({}), []);

      await bot.stop();
    });

    it('по обращению заводит заявку и называет срок при соседях', async () => {
      const bot = await withHouseChat();

      platform.chatSends('в первом подъезде не горит свет на площадке', {
        userId: 4004,
        chatId: HOUSE_CHAT,
        mention: true,
      });

      const said = await waitForMessage(HOUSE_CHAT, /Починят до/);

      assert.match(said, /Заявка Д15-2609-0001 принята/);

      const [request] = await bot.deps.repository.listRequests({});

      assert.deepEqual(request?.target, { kind: 'building', buildingId: BUILDING_ID });
      assert.match(request?.description ?? '', /не горит свет/);

      await bot.stop();
    });

    it('ответом на сообщение соседа оформляет заявку по его словам', async () => {
      const bot = await withHouseChat();

      platform.chatSends('оформи', {
        userId: 4005,
        chatId: HOUSE_CHAT,
        mention: true,
        quote: 'Второй день не работает домофон в третьем подъезде',
      });

      await waitForMessage(HOUSE_CHAT, /Починят до/);

      const [request] = await bot.deps.repository.listRequests({});

      assert.match(request?.description ?? '', /не работает домофон/);

      await bot.stop();
    });

    it('сбой при обращении в чате виден тому, кто обратился', async () => {
      const bot = await withHouseChat();

      bot.deps.repository.listRequests = () => Promise.reject(new Error('база недоступна'));

      platform.chatSends('в подъезде выбило пробки', { userId: 4004, chatId: HOUSE_CHAT, mention: true });

      assert.match(await waitForMessage(HOUSE_CHAT, /ещё раз/), /ещё раз/);

      await bot.stop();
    });

    it('сбой на разговоре соседей молчит: к боту не обращались', async () => {
      const bot = await withHouseChat();
      const before = platform.outgoing.length;

      bot.deps.repository.listRequests = () => Promise.reject(new Error('база недоступна'));

      platform.chatSends('когда включат воду?', { userId: 4004, chatId: HOUSE_CHAT });
      await new Promise((resolve) => setTimeout(resolve, 250));

      assert.equal(platform.outgoing.length, before);

      await bot.stop();
    });

    it('на короткую вежливость отвечает подсказкой, а не заявкой', async () => {
      const bot = await withHouseChat();

      platform.chatSends('спасибо', { userId: 4004, chatId: HOUSE_CHAT, mention: true });
      await waitForMessage(HOUSE_CHAT, /Чат дома/);

      assert.deepEqual(await bot.deps.repository.listRequests({}), []);

      await bot.stop();
    });

    it('квитанцию присылает лично, а при соседях говорит только об этом', async () => {
      const bot = await withHouseChat([RESIDENT_WITH_FLAT]);

      platform.chatSends('/bill', { userId: 3003, chatId: HOUSE_CHAT });

      const personal = await waitForMessage(3003, /Заплатить /);
      const public_ = await waitForMessage(HOUSE_CHAT, /ответил вам лично/);

      assert.match(personal, /Заплатить /);
      assert.equal(/Заплатить /.test(public_), false, 'сумма показана соседям');

      await bot.stop();
    });

    it('показание при соседях не принимает, а зовёт в переписку', async () => {
      const bot = await withHouseChat([RESIDENT_WITH_FLAT]);

      await bot.repository.saveMeter({ id: 'cold-1', apartmentId: 'apt-1', kind: 'cold_water', serial: 'ХВС-1' });

      platform.chatSends('хвс 12350', { userId: 3003, chatId: HOUSE_CHAT, mention: true });

      const answer = await waitForMessage(HOUSE_CHAT, /личной переписке/);

      assert.match(answer, /личные сообщения/);
      assert.equal((await bot.deps.repository.listReadingsFor(['cold-1'])).length, 0, 'показание принято в чате');
      assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'показание стало заявкой');

      await bot.stop();
    });

    it('подсказку по разделу в чате присылает лично и с кнопкой раздела', async () => {
      const bot = await withHouseChat([RESIDENT_WITH_FLAT]);

      platform.chatSends('передать показания счётчиков', { userId: 3003, chatId: HOUSE_CHAT, mention: true });

      const personal = await waitForMessage(3003, /Показания/);
      const public_ = await waitForMessage(HOUSE_CHAT, /ответил вам лично/);

      assert.match(personal, /счётчик/i);
      assert.doesNotMatch(public_, /счётчик/i, 'подсказка ушла в общий чат');

      const keyboard = JSON.stringify(platform.outgoing.findLast((message) => message.userId === 3003)?.attachments ?? []);

      assert.match(keyboard, /menu:meters/, 'к личному ответу не прикреплена кнопка раздела');
      assert.equal((await bot.deps.repository.listRequests({})).length, 0, 'вопрос о разделе стал заявкой');

      await bot.stop();
    });

    it('новую заявку из общего чата уводит в переписку', async () => {
      const bot = await withHouseChat([RESIDENT_WITH_FLAT]);

      platform.chatSends('/new', { userId: 3003, chatId: HOUSE_CHAT });

      // Команду в чате набирать не предлагают: разговор продолжается в личной
      // переписке, и попасть туда можно кнопкой.
      assert.match(await waitForMessage(HOUSE_CHAT, /личные сообщения/), /отвечу вам лично/);

      await bot.stop();
    });

    it('показания из общего чата уводит в переписку целиком', async () => {
      const bot = await withHouseChat([RESIDENT_WITH_FLAT]);

      platform.chatSends('/meters', { userId: 3003, chatId: HOUSE_CHAT });

      assert.match(await waitForMessage(HOUSE_CHAT, /личные сообщения/), /отвечу вам лично/);

      await bot.stop();
    });

    it('объявления дома читаются и в чате', async () => {
      const bot = await withHouseChat([RESIDENT_WITH_FLAT]);

      await publishAnnouncement(bot.deps, { resident: MANAGER, title: 'Собрание', body: 'В четверг во дворе' });
      await waitForMessage(HOUSE_CHAT, /Собрание/);

      platform.chatSends('/news', { userId: 4004, chatId: HOUSE_CHAT });
      const listing = await waitForMessage(HOUSE_CHAT, /Собрание, весь дом/);

      assert.match(listing, /В четверг во дворе/);

      const keyboard = JSON.stringify(platform.outgoing.at(-1)?.attachments ?? []);

      assert.doesNotMatch(keyboard, /group:back/, 'личное меню в общий чат не выносится');

      await bot.stop();
    });

    it('в чате показывает счёт собрания, а голос соседа, только ему', async () => {
      const bot = await withHouseChat([RESIDENT_WITH_FLAT]);

      const meeting = await startPoll(bot.deps, {
        resident: MANAGER,
        kind: 'simple',
        title: 'Ремонт подъездов',
        question: 'Утвердить смету',
        days: 14,
      });

      platform.userPressesButton(`vote:${meeting.id}:for`, {
        userId: 3003,
        chatId: HOUSE_CHAT,
        chatType: 'chat',
      });

      const inHouseChat = await waitForMessage(HOUSE_CHAT, /За: /);

      assert.equal(/Голос квартиры/.test(inHouseChat), false, 'голос соседа виден всему чату');
      assert.match(await waitForMessage(3003, /Голос квартиры/), /за/);

      await bot.stop();
    });

    it('в канале дома заявку заводят комментарием под постом', async () => {
      const bot = await start([MANAGER]);

      platform.botAdded({ userId: MANAGER.maxUserId, chatId: HOUSE_CHAT, isChannel: true });

      const welcome = await waitForMessage(HOUSE_CHAT, /привязан к дому/);

      assert.match(welcome, /Канал привязан/);
      assert.match(welcome, /комментарием под постом/);

      platform.channelComments('в третьем подъезде не работает свет', {
        userId: 4007,
        chatId: HOUSE_CHAT,
        postId: 'mid.post.7',
        mention: true,
      });

      for (let attempt = 0; attempt < 150; attempt += 1) {
        if (platform.outgoing.some((message) => message.postId === 'mid.post.7')) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const answer = platform.outgoing.find((message) => message.postId === 'mid.post.7');

      assert.match(said(answer?.text ?? ''), /Заявка Д15-2609-0001 принята/);

      const [request] = await bot.deps.repository.listRequests({});

      assert.match(request?.description ?? '', /не работает свет/);

      await bot.stop();
    });

    it('новому соседу один раз рассказывает, что здесь можно', async () => {
      const bot = await withHouseChat();

      platform.userAdded({ userId: 4006, firstName: 'Пётр', chatId: HOUSE_CHAT });
      const said = await waitForMessage(HOUSE_CHAT, /Пётр/);

      assert.match(said, /Домовой/);
      assert.match(said, /личной переписке/);

      await bot.stop();
    });

    it('после удаления из чата туда больше ничего не уходит', async () => {
      const bot = await withHouseChat();

      platform.botRemoved({ userId: MANAGER.maxUserId, chatId: HOUSE_CHAT });

      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((await bot.deps.repository.findBuilding(BUILDING_ID))?.chatId === undefined) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const before = platform.outgoing.filter((message) => message.chatId === HOUSE_CHAT).length;

      await publishAnnouncement(bot.deps, { resident: MANAGER, title: 'Собрание', body: 'В четверг' });

      assert.equal(
        platform.outgoing.filter((message) => message.chatId === HOUSE_CHAT).length,
        before,
        'объявление ушло в чат, из которого бота выгнали',
      );

      await bot.stop();
    });

    it('аварию закрепляет наверху чата и снимает, когда её устранили', async () => {
      const bot = await withHouseChat([RESIDENT_WITH_FLAT]);

      const request = await createServiceRequest(bot.deps, {
        resident: RESIDENT_WITH_FLAT,
        description: 'Нет холодной воды во всём доме',
        category: 'plumbing',
      });
      const houseWide = { ...request, target: { kind: 'building', buildingId: BUILDING_ID } as const };

      await announceIncident(bot.deps, houseWide);
      await waitForMessage(HOUSE_CHAT, /Авария/);

      const pinned = platform.pinnedIn(HOUSE_CHAT);

      assert.ok(pinned, 'авария не закреплена в чате');

      await announceResolved(bot.deps, houseWide);
      await waitForMessage(HOUSE_CHAT, /Устранено/);

      assert.equal(platform.pinnedIn(HOUSE_CHAT), undefined, 'устранённая авария осталась закреплённой');

      await bot.stop();
    });

    it('чужое закрепление в чате не снимает', async () => {
      const bot = await withHouseChat([RESIDENT_WITH_FLAT]);

      const request = await createServiceRequest(bot.deps, {
        resident: RESIDENT_WITH_FLAT,
        description: 'Нет холодной воды во всём доме',
        category: 'plumbing',
      });
      const houseWide = { ...request, target: { kind: 'building', buildingId: BUILDING_ID } as const };

      await announceIncident(bot.deps, houseWide);

      platform.setPinned(HOUSE_CHAT, 'mid.rules', 9999);

      await announceResolved(bot.deps, houseWide);
      await waitForMessage(HOUSE_CHAT, /Устранено/);

      assert.equal(platform.pinnedIn(HOUSE_CHAT), 'mid.rules', 'сняли чужое закрепление');

      await bot.stop();
    });
  });
});

describe('названия в меню', () => {
  /** Длиннее этого название обрезается многоточием на телефоне. */
  const LIMIT = 23;

  /** Значок считается одним знаком: селектор начертания в ширину не идёт. */
  const width = (title: string): number => [...title.replace(/️/gu, '')].length;

  it('умещаются в кнопку на телефоне', () => {
    const roles: Resident['role'][] = ['resident', 'dispatcher', 'technician', 'manager', 'contractor'];

    const long = roles.flatMap((role) => {
      const menu = menuFor(
        { id: `who-${role}`, maxUserId: 1, displayName: 'Кто-то', role, apartmentId: 'apt-1', buildingId: BUILDING_ID },
        { demo: true },
      );

      return [...menu.top, ...menu.groups.flatMap((group) => [{ title: group.title }, ...group.items])]
        .map((item) => RU(item.title))
        .filter((title) => width(title) > LIMIT);
    });

    assert.deepEqual([...new Set(long)], []);
  });

  it('у каждой роли есть кнопка в раздел, который называет помощник', () => {
    const roles: Resident['role'][] = ['resident', 'dispatcher', 'technician', 'manager', 'contractor'];

    // Сотрудник живёт в своей квартире и спрашивает про свою квитанцию: раздел
    // помощник называет всем ролям, значит и перейти в него должно быть чем.
    const without = roles.filter((role) => {
      const menu = menuFor(
        { id: `who-${role}`, maxUserId: 1, displayName: 'Кто-то', role, apartmentId: 'apt-1', buildingId: BUILDING_ID },
        { demo: true },
      );

      const commands = [...menu.top, ...menu.groups.flatMap((group) => group.items)].map((item) => item.command);

      return !commands.includes('bill') || !commands.includes('meters');
    });

    assert.deepEqual(without, []);
  });

  it('жильцу без квартиры меню сводится к привязке, языку и, на проверке, роли', () => {
    const plain = menuFor(UNBOUND_RESIDENT);
    const demo = menuFor(UNBOUND_RESIDENT, { demo: true });

    // Язык остаётся и здесь: без него человек не прочтёт саму просьбу о коде.
    assert.deepEqual(plain.top.map((item) => item.command), ['flat', 'lang']);
    assert.deepEqual(plain.groups, []);
    assert.deepEqual(demo.top.map((item) => item.command), ['flat', 'lang', 'demo']);

    // Сотрудника без квартиры правило не касается: у него дом из назначения роли.
    const staff = menuFor({ ...UNBOUND_RESIDENT, role: 'technician', buildingId: BUILDING_ID });

    assert.ok(staff.groups.length > 0);
  });
});
