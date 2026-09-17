import {
  InMemoryRepository,
  closeDuePolls,
  createMockHub,
  createMockPayments,
  chargesForResident,
  listRequestsFor,
  receptionFor,
  makeManager,
  openByCode,
  publishAnnouncement,
  raiseSensorAlarm,
  sendBroadcast,
  sendSticker,
  startPoll,
  type AppDeps,
} from '@domovoy/app';
import { formatMoney } from '@domovoy/domain';
import { createDomovoyBot } from '@domovoy/bot';
import { renderSticker, renderStickerPng, sheetFor } from '@domovoy/stickers';
import { startMockPlatform, type SentMessage } from '@maxkit/platform-mock';

import { demoData, demoDevices, seedDemo, seedReadings } from './demo.js';

/** Участник прогона, которого сценарий уже завёл. @throws {Error} */
const expectResident = <T>(found: T | undefined): T => {
  if (!found) throw new Error('Участник прогона не найден');

  return found;
};

/** Сквозной прогон продукта. */
const TOKEN = 'walkthrough-token';

export interface Line {
  /** Кто говорит: имя участника или «бот». */
  who: string;
  text: string;
}

interface Actor {
  name: string;
  maxUserId: number;
}

const MARIA: Actor = { name: 'Мария (кв. 1 и кв. 4 в соседнем доме)', maxUserId: 1001 };
const IVAN: Actor = { name: 'Иван (кв. 2)', maxUserId: 1002 };
const ANNA: Actor = { name: 'Анна (кв. 3, тот же стояк)', maxUserId: 1003 };
const PETR: Actor = { name: 'Пётр (кв. 6)', maxUserId: 1004 };
const DISPATCHER: Actor = { name: 'Ольга Титова, диспетчер', maxUserId: 2001 };
const TECHNICIAN: Actor = { name: 'Сергей Малых, мастер', maxUserId: 2002 };
const MANAGER: Actor = { name: 'Нина Гордеева, управляющая', maxUserId: 2003 };
const NEWCOMER: Actor = { name: 'Сосед в чате дома', maxUserId: 1009 };

/** Общий чат жильцов: он у дома уже есть, бота туда добавляют. */
const HOUSE_CHAT = 900_100;

export interface WalkthroughOptions {
  /** Куда писать ход разговора. Без неё прогон просто возвращает расшифровку. */
  log?: (line: Line) => void;
}

export const runWalkthrough = async (options: WalkthroughOptions = {}): Promise<Line[]> => {
  const lines: Line[] = [];
  const log = options.log ?? ((): void => undefined);

  const say = (who: string, text: string): void => {
    const line = { who, text };
    lines.push(line);
    log(line);
  };

  const platform = await startMockPlatform({ token: TOKEN, maxPollTimeoutMs: 100 });
  const data = demoData();
  let counter = 0;

  const now = (): Date => new Date();

  const hub = createMockHub({ devices: demoDevices, now });

  const deps: AppDeps = {
    repository: new InMemoryRepository(),
    now,
    createId: () => `wt-${++counter}`,
    defaultBuildingId: data.buildingId,
    hub,
    payments: createMockPayments({ now }),
    botName: 'uk_bot',
    stickers: {
      svg: renderSticker,
      sheet: sheetFor,
      png: async (plan, look) => (await renderStickerPng(plan, look)).toString('base64'),
    },
  };

  await seedDemo(deps);

  // Адреса как в бою: в сообщениях появляются кнопки приложения и ссылки на документы.
  const bot = createDomovoyBot({
    token: TOKEN,
    deps,
    baseUrl: platform.url,
    miniAppUrl: 'https://max.ru/domovoy_bot',
    siteUrl: 'https://domovoy.homes',
  });
  bot.bot.botInfo = await bot.bot.api.getMyInfo();
  void bot.supervisor.start();

  const shown = new Set<string>();
  const everyone = [IVAN, ANNA, PETR, DISPATCHER, TECHNICIAN, MANAGER, NEWCOMER];

  /** Выводит всё, что бот отправил с прошлого раза, в порядке отправки. */
  const flush = (): void => {
    for (const message of platform.outgoing) {
      if (shown.has(message.mid)) continue;

      shown.add(message.mid);

      if (message.chatId === HOUSE_CHAT) {
        say('бот → чат дома', message.text);
        continue;
      }

      const to = everyone.find((actor) => addressedTo(message, actor));
      const other = data.residents.find(
        (resident) => resident.maxUserId !== undefined && addressedTo(message, { maxUserId: resident.maxUserId }),
      );

      say(`бот → ${to?.name ?? other?.displayName ?? 'другому жильцу'}`, message.text);
    }
  };

  /** Ждёт ответ бота конкретному участнику и дописывает разговор. */
  const expect = async (actor: Actor, pattern: RegExp, timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const found = platform.outgoing.some(
        (message) => addressedTo(message, actor) && pattern.test(message.text),
      );

      if (found) {
        flush();
        return;
      }

      if (Date.now() > deadline) throw new Error(`Не дождались ответа «${pattern.source}» для ${actor.name}`);

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  /** Ждёт всплывающее уведомление: короткий итог нажатия приходит им, а не сообщением. */
  const expectToast = async (pattern: RegExp, timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const found = platform.answers.find((answer) => pattern.test(answer.notification ?? ''));

      if (found) {
        flush();
        say('бот → всплывающим уведомлением', found.notification ?? '');
        return;
      }

      if (Date.now() > deadline) throw new Error(`Не дождались уведомления «${pattern.source}»`);

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  /** То же ожидание, но для общего чата: там у сообщения нет адресата. */
  const expectChat = async (pattern: RegExp, timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      if (platform.outgoing.some((message) => message.chatId === HOUSE_CHAT && pattern.test(message.text))) {
        flush();
        return;
      }

      if (Date.now() > deadline) throw new Error(`Не дождались «${pattern.source}» в чате дома`);

      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  try {
    await publishAnnouncement(deps, {
      resident: (await deps.repository.findResidentByMaxUserId(DISPATCHER.maxUserId))!,
      title: 'Замена запорной арматуры',
      body: 'Сегодня с 9:00 до 14:00 по стояку 2 первого подъезда.',
      entrance: 1,
      riser: 2,
      works: {
        category: 'plumbing',
        from: new Date(deps.now().getTime() - 3600_000),
        until: new Date(deps.now().getTime() + 3 * 3600_000),
      },
    });

    say('', 'Ольга заранее объявила плановое отключение по стояку 2');

    say('', 'Иван сканирует код на стояке и открывает бота');
    platform.pushUpdate({
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: IVAN.maxUserId,
      user: { user_id: IVAN.maxUserId, first_name: 'Иван', is_bot: false },
      payload: 'rsr_dom15_1_2',
    });
    await expect(IVAN, /Опишите/);

    say(IVAN.name, 'Нет горячей воды со вчерашнего вечера');
    platform.userSends('Нет горячей воды со вчерашнего вечера', {
      userId: IVAN.maxUserId,
      chatId: IVAN.maxUserId,
    });
    await expect(IVAN, /плановые работы до/);

    say('', 'Заявка не заводилась, но последнее слово за жильцом');
    say(IVAN.name, 'нажимает «Всё равно оставить заявку»: в подвале ещё и хлещет');
    platform.userPressesButton('anyway', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /принята/);
    await expect(DISPATCHER, /Новая заявка/);

    const [request] = await deps.repository.listRequests({});

    say(DISPATCHER.name, 'принимает заявку в работу');
    platform.userPressesButton(`req:${request!.id}:accepted`, {
      userId: DISPATCHER.maxUserId,
      chatId: DISPATCHER.maxUserId,
    });
    await expect(DISPATCHER, /принята в работу/);
    await expect(IVAN, /принята в работу/);

    say('', 'Соседям по стояку ушло не предупреждение, а вопрос');
    await expect(ANNA, /Авария: /);

    say(ANNA.name, 'нажимает «У меня тоже», не написав ни слова');
    platform.userPressesButton(`same:${request!.id}`, { userId: ANNA.maxUserId, chatId: ANNA.maxUserId });
    await expect(ANNA, /у вас то же самое/);

    const surveyed = await deps.repository.findRequest(request!.id);

    say(
      '',
      `В очереди по-прежнему одна заявка ${request!.number}. Подтвердили ${surveyed?.joinedBy.length ?? 0}, ` +
        `у ${surveyed?.notAffected.length ?? 0} всё работает, управляющая компания видит границу аварии, ` +
        'не обходя подъезд',
    );

    say(DISPATCHER.name, 'передаёт мастеру');
    platform.userPressesButton(`req:${request!.id}:in_progress`, {
      userId: DISPATCHER.maxUserId,
      chatId: DISPATCHER.maxUserId,
    });
    await expect(DISPATCHER, /выполняется/);

    say('', 'Чтобы попасть в квартиру, нужно договориться, разговор идёт там же');
    say(DISPATCHER.name, 'нажимает «Написать» под уведомлением');
    platform.userPressesButton(`say:${request!.id}`, {
      userId: DISPATCHER.maxUserId,
      chatId: DISPATCHER.maxUserId,
    });
    await expect(DISPATCHER, /Напишите ответ/);

    say(DISPATCHER.name, 'Мастер подъедет после обеда, будете дома?');
    platform.userSends('Мастер подъедет после обеда, будете дома?', {
      userId: DISPATCHER.maxUserId,
      chatId: DISPATCHER.maxUserId,
    });
    await expect(IVAN, /Мастер подъедет после обеда/);

    say(IVAN.name, 'отвечает из чата, не открывая приложение');
    platform.userPressesButton(`say:${request!.id}`, { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /Напишите ответ/);

    say(IVAN.name, 'Да, после 15:00');
    platform.userSends('Да, после 15:00', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(DISPATCHER, /Да, после 15:00/);

    const talking = await deps.repository.findRequest(request!.id);

    say('', `Состояние заявки прежнее: ${talking?.status}. Разговор, не смена статуса`);

    say(TECHNICIAN.name, 'отчитывается о выполнении');
    platform.userPressesButton(`req:${request!.id}:done`, {
      userId: TECHNICIAN.maxUserId,
      chatId: TECHNICIAN.maxUserId,
    });
    await expect(TECHNICIAN, /выполнена/);
    await expect(IVAN, /ждёт вашей приёмки/);

    say('', 'Работа не сделана: жилец возвращает её мастеру кнопкой из уведомления');
    platform.userPressesButton(`ask:${request!.id}:in_progress`, {
      userId: IVAN.maxUserId,
      chatId: IVAN.maxUserId,
    });
    await expect(IVAN, /Что именно не сделано/);

    say(IVAN.name, 'Вода так и не появилась');
    platform.userSends('Вода так и не появилась', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /выполняется/);

    say('', 'Тем же ботом открывается дверь: отдельного приложения для домофона не нужно');
    say(IVAN.name, '/door');
    platform.userSends('/door', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /Что открыть/);

    say(IVAN.name, 'нажимает «Домофон, подъезд 1»');
    platform.userPressesButton('door:intercom-1', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /открыто/);

    say(IVAN.name, 'просит код для гостя');
    platform.userPressesButton('guest:intercom-1', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /Код для гостя/);

    say('', 'Гость набрал код на панели, хозяин узнаёт об этом сам, а код гаснет');
    await openByCode(bot.deps, hub.codes.at(-1)!.code);
    await expect(IVAN, /Гостевой код сработал/);

    say('', 'А это заявка, которую никто не подавал: сработал датчик дыма');
    await raiseSensorAlarm(bot.deps, data.buildingId, 'smoke-1');
    await expect(DISPATCHER, /датчик дыма/i);

    await seedReadings(bot.deps, data);

    say('', 'Заодно жилец подаёт показания счётчиков');
    say(IVAN.name, '/meters');
    platform.userSends('/meters', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /Отправьте показание числом/);

    say(IVAN.name, '140,2');
    platform.userSends('140,2', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /Принято/);
    await expect(IVAN, /Отправьте показание числом/);

    say('', 'Из этих же показаний считается квитанция: в переписке сумма и срок, оплата тут же');
    say(IVAN.name, '/bill');
    platform.userSends('/bill', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /К оплате/);

    say('', 'Разбор по строкам, это экран: те же числа открываются в приложении');
    const payer = expectResident(await bot.deps.repository.findResidentByMaxUserId(IVAN.maxUserId));
    const charges = await chargesForResident(bot.deps, payer);

    say('', charges.lines.map((line) => `${line.title}: ${formatMoney(line.amount)}`).join(' · '));

    say(IVAN.name, 'нажимает «Оплатить»');
    platform.userPressesButton('pay', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /Оплачено/);

    say('', 'Долги дома видит смена: крупные должники сверху');
    say(DISPATCHER.name, '/debts');
    platform.userSends('/debts', { userId: DISPATCHER.maxUserId, chatId: DISPATCHER.maxUserId });
    await expect(DISPATCHER, /Долг дома/);

    say('', 'У дома есть общий чат жильцов, своего продукт не заводит, приходит в этот');
    say(MANAGER.name, 'добавляет бота в чат дома');
    platform.botAdded({ userId: MANAGER.maxUserId, chatId: HOUSE_CHAT });
    await expectChat(/Чат привязан к дому/);

    say('Сосед в чате дома', '@Домовой в первом подъезде не горит свет на площадке');
    platform.chatSends('в первом подъезде не горит свет на площадке', {
      userId: NEWCOMER.maxUserId,
      chatId: HOUSE_CHAT,
      firstName: 'Пётр',
      mention: true,
    });
    await expectChat(/Срок выполнения/);

    say('', 'Номер и срок видят все. Квартира соседа неизвестна, адресом стал дом из чата');

    say('', 'А без обращения бот в разговор не лезет');
    say('Сосед в чате дома', 'Кто-нибудь знает, когда включат воду?');
    const quiet = platform.outgoing.length;

    platform.chatSends('Кто-нибудь знает, когда включат воду?', {
      userId: NEWCOMER.maxUserId,
      chatId: HOUSE_CHAT,
      firstName: 'Пётр',
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    say('', `Сообщений от бота за это время: ${platform.outgoing.length - quiet}`);

    // Квартира без жильца: по её коду сосед из чата и привязывается.
    const flatCode = data.apartments.find((apartment) => apartment.id === 'apt-10')?.code ?? '';

    say('', 'Первый разговор с новым человеком начинается с документов');
    say('Сосед в чате дома', '/start');
    platform.userSends('/start', { userId: NEWCOMER.maxUserId, chatId: NEWCOMER.maxUserId, firstName: 'Пётр' });
    await expect(NEWCOMER, /по поручению управляющей организации/);

    say('Сосед в чате дома', 'нажимает «Принимаю»');
    platform.userPressesButton('legal:accept', { userId: NEWCOMER.maxUserId, chatId: NEWCOMER.maxUserId });
    await expect(NEWCOMER, /Чем помочь/);

    say('', 'Сосед пока не привязан к квартире и вводит код из своей квитанции');
    say('Сосед в чате дома', flatCode);
    platform.userSends(flatCode, { userId: NEWCOMER.maxUserId, chatId: NEWCOMER.maxUserId, firstName: 'Пётр' });
    await expect(NEWCOMER, /привязаны к квартире/);

    say('', 'Подобрать код нельзя: он свой у каждой квартиры, а промахи считаются');
    say('Сосед в чате дома', 'WXYWXY33');
    platform.userSends('WXYWXY33', { userId: NEWCOMER.maxUserId, chatId: NEWCOMER.maxUserId, firstName: 'Пётр' });
    await expect(NEWCOMER, /Код не подошёл/);

    say(IVAN.name, 'в том же чате спрашивает свою квитанцию: /bill');
    platform.chatSends('/bill', { userId: IVAN.maxUserId, chatId: HOUSE_CHAT, firstName: 'Иван' });
    await expectChat(/ответил вам лично/);
    await expect(IVAN, /оплачено/);

    say('', 'Сумма ушла в личную переписку');

    say('', 'Управляющая компания объявляет собрание, уведомление уходит собственникам');

    const dispatcher = (await deps.repository.findResidentByMaxUserId(DISPATCHER.maxUserId))!;

    const meeting = await startPoll(bot.deps, {
      resident: dispatcher,
      kind: 'qualified',
      title: 'Ремонт подъездов',
      question: 'Утвердить смету на ремонт подъездов',
      days: 14,
    });

    await expect(IVAN, /Собрание собственников/);

    say(IVAN.name, '/vote');
    platform.userSends('/vote', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /Участие/);

    say(IVAN.name, 'нажимает «За»');
    platform.userPressesButton(`vote:${meeting.id}:for`, {
      userId: IVAN.maxUserId,
      chatId: IVAN.maxUserId,
    });
    await expect(IVAN, /Ваш голос/);

    say('', 'Срок собрания вышел, итоги подводятся сами, а протокол остаётся у дома');
    await bot.deps.repository.savePoll({ ...meeting, closesAt: new Date(now().getTime() - 60_000) });

    const [closed] = await closeDuePolls(bot.deps);

    await expect(IVAN, /Собрание завершено/);
    say('', (closed?.protocol ?? '').split('\n').slice(0, 3).join(' · '));

    say('', 'Те же числа, что у управляющей компании, видит и тот, кто за это платит');
    say(IVAN.name, '/house');
    platform.userSends('/house', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /Сейчас открыто заявок/);

    say('', 'Право знать, что о тебе хранят, есть по закону, и отвечает на это продукт');
    say(IVAN.name, '/mydata');
    platform.userSends('/mydata', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /Ваши данные файлом/);

    say('', 'На вопрос о доме бот отвечает данными, а не заводит заявку');
    say(PETR.name, '/new');
    platform.userSends('/new', { userId: PETR.maxUserId, chatId: PETR.maxUserId });
    await expect(PETR, /Опишите/);

    const asked = (await deps.repository.listRequests({})).length;

    say(PETR.name, 'Когда включат воду?');
    platform.userSends('Когда включат воду?', { userId: PETR.maxUserId, chatId: PETR.maxUserId });
    await expect(PETR, /Замена запорной арматуры/);

    say(
      '',
      `Заявок в доме было ${asked}, столько и осталось: ${(await deps.repository.listRequests({})).length}. ` +
        'Под ответом кнопка «Оформить заявку», если ответ не подошёл',
    );

    say('', 'У Марии вторая квартира в соседнем доме, и всё считается по выбранной');
    say(MARIA.name, '/flat');
    platform.userSends('/flat', { userId: MARIA.maxUserId, chatId: MARIA.maxUserId });
    await expect(MARIA, /по ней идут показания/);

    say(MARIA.name, 'выбирает вторую квартиру');
    platform.userPressesButton('flat:apt-17-4', { userId: MARIA.maxUserId, chatId: MARIA.maxUserId });
    await expectToast(/Показания и квитанция: /);

    say('', 'Лифт на подряде: наряд уходит подрядчику, а очередь дома ему не видна');

    const lifts = await makeManager(bot.deps, 9009, 'Лифтсервис');

    await bot.deps.repository.saveResident({ ...lifts, role: 'contractor', buildingId: data.buildingId });

    const own = await listRequestsFor(bot.deps, { ...lifts, role: 'contractor' }, 'queue');

    say('', `Подрядчик видит в очереди дома заявок: ${own.length}`);

    say('', 'Вопрос в управляющую компанию идёт перепиской, а не заявкой');
    say(ANNA.name, '/support');
    platform.userSends('/support', { userId: ANNA.maxUserId, chatId: ANNA.maxUserId });
    await expect(ANNA, /Напишите вопрос/);

    say(ANNA.name, 'Можно поставить лавочку у второго подъезда?');
    platform.userSends('Можно поставить лавочку у второго подъезда?', {
      userId: ANNA.maxUserId,
      chatId: ANNA.maxUserId,
    });
    await expect(ANNA, /Вопрос принят/);
    await expect(DISPATCHER, /Вопрос в поддержку/);

    const [question] = await deps.repository.listSupportTickets({ buildingId: data.buildingId });

    say(DISPATCHER.name, 'отвечает кнопкой под вопросом');
    platform.userPressesButton(`ticket:${question?.id ?? ''}`, {
      userId: DISPATCHER.maxUserId,
      chatId: DISPATCHER.maxUserId,
    });
    await expect(DISPATCHER, /Напишите ответ жильцу/);

    platform.userSends('Лавочку поставим до конца месяца, смета уже согласована.', {
      userId: DISPATCHER.maxUserId,
      chatId: DISPATCHER.maxUserId,
    });
    await expect(ANNA, /Лавочку поставим/);

    say('', 'Выбор объекта для наклейки, это список: бот называет число и открывает приложение');
    say(IVAN.name, '/stickers');
    platform.userSends('/stickers', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /Объектов с кодами/);

    say('', 'Саму наклейку делает приложение, а приходит она в ту же переписку');
    const made = await sendSticker(bot.deps, { resident: payer, payload: 'ent_dom15_1', style: 'night' });

    say('', `Наклейка «${made.plan.caption}» ушла ${made.as === 'image' ? 'картинкой' : 'файлом'}`);

    say('', 'Рассылка собирается в приложении: адресат из подъездов и стояков, охват виден до отправки');
    say(DISPATCHER.name, '/broadcast');
    platform.userSends('/broadcast', { userId: DISPATCHER.maxUserId, chatId: DISPATCHER.maxUserId });
    await expect(DISPATCHER, /Рассылка собирается в приложении/);

    const sent = await sendBroadcast(bot.deps, {
      actor: expectResident(await bot.deps.repository.findResidentByMaxUserId(DISPATCHER.maxUserId)),
      scope: { kind: 'riser', entrance: 1, riser: 2 },
      text: 'Завтра с 9:00 до 14:00 перекроем стояк: меняем участок трубы.',
    });

    say('', `Отправлено из приложения: ${sent.description}, получателей ${sent.recipients}`);

    await expect(IVAN, /Сообщение управляющей компании/);

    say('', 'Приём в управляющей организации назначается в том же чате: этого требует порядок');
    say(IVAN.name, '/visit');
    platform.userSends('/visit', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
    await expect(IVAN, /Когда удобно/);

    const ivan = await bot.deps.repository.findResidentByMaxUserId(IVAN.maxUserId);
    const slot = ivan ? (await receptionFor(bot.deps, ivan)).slots[0] : undefined;

    if (slot) {
      say(IVAN.name, 'выбирает ближайший час');
      platform.userPressesButton(`visit:${slot.toISOString()}`, { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
      await expect(IVAN, /С чем придёте/);

      say(IVAN.name, 'Перерасчёт за горячую воду');
      platform.userSends('Перерасчёт за горячую воду', { userId: IVAN.maxUserId, chatId: IVAN.maxUserId });
      await expect(IVAN, /Записал на приём/);
      await expect(DISPATCHER, /Запись на приём/);
    }

    say('', 'Ночью заявки идут дежурному, и дежурство принимают из переписки');
    say(DISPATCHER.name, '/duty');
    platform.userSends('/duty', { userId: DISPATCHER.maxUserId, chatId: DISPATCHER.maxUserId });
    await expect(DISPATCHER, /Дежурство принято/);

    say(DISPATCHER.name, '/report');
    platform.userSends('/report', { userId: DISPATCHER.maxUserId, chatId: DISPATCHER.maxUserId });
    await expect(DISPATCHER, /За 30 дн\./);

    return lines;
  } finally {
    await bot.supervisor.stop();
    await platform.stop();
  }
};

/** В личной переписке чат и пользователь, один и тот же адресат. */
const addressedTo = (message: SentMessage, actor: { maxUserId: number }): boolean =>
  message.userId === actor.maxUserId || message.chatId === actor.maxUserId;
