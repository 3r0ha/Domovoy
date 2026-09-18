import {
  ensureResident,
  buildingByChat,
  type AppDeps,
  type Building,
  type Resident,
  type MeterVision,
  type Transcriber,
} from '@domovoy/app';
import {
  DomainError,
  decodeTarget,
} from '@domovoy/domain';
import type { Notifier } from '@domovoy/app';
import { Bot, Context, Keyboard, MemorySessionStore, session } from '@maxkit/max-bot-api';
import {
  createBotSupervisor,
  installResilientApi,
  scenarioRecovery,
  type MarkerStore,
  type UpdateSupervisor,
} from '@maxkit/runtime';


import {
  actionKeyboard,
  alertKeyboard,
  appLink,
  appRow,
  initiativeKeyboard,
  keyboardOf,
  menuButton,
  supportKeyboard,
  PERSONAL,
} from './keyboards.js';
import { BUTTONS } from './buttons.js';
import { registerComments, speakInChat } from './chat.js';
import { registerChatEvents } from './events.js';
import { chatHelp, greet } from './greeting.js';
import { menuKeyboard } from './menu.js';
import { announce, answerQuestion } from './reply.js';
import { continueDialog } from './dialog.js';
import { basicCommands } from './commands/basic.js';
import { broadcastCommands } from './commands/broadcast.js';
import { houseCommands } from './commands/house.js';
import { moneyCommands } from './commands/money.js';
import { staffCommands } from './commands/staff.js';
import { legalCommands, needsLegal } from './commands/legal.js';
import { stickerCommands } from './commands/stickers.js';
import { visitCommands } from './commands/visits.js';
import type { BotKit, Extra } from './kit.js';
import {
  addressed,
  DIALOG_COMMANDS,
  forget,
  inChat,
  PRIVATE_COMMANDS,
  nameOf,
  toast,
  toAttachments,
  type BotContext,
  type DialogSession,
} from './max.js';

/** Кнопки, которые ничего не меняют: их нажимают и до согласия с документами. */
const WITHOUT_LEGAL_BUTTONS = new Set(['legal', 'menu', 'group', 'cancel', 'more']);

/** Нажатие кнопки: обработчик по приставке payload, остальное после двоеточий. */
const pressed = async (kit: BotKit, typed: BotContext): Promise<void> => {
  const [name, ...args] = (typed.callback?.payload ?? '').split(':');
  const button = name ? BUTTONS[name] : undefined;

  if (name && button) {
    // Кнопка меняет данные так же, как команда, поэтому и согласие спрашивается так же.
    if (!inChat(typed) && !WITHOUT_LEGAL_BUTTONS.has(name) && (await needsLegal(kit, typed))) {
      await toast(typed);
      return;
    }

    await button(kit, typed, args);

    // Нажатие закрывается в любом случае: иначе кнопка у нажавшего висит в ожидании.
    await toast(typed);
    return;
  }

  // Кнопка из старого сообщения после обновления продукта: молчать нельзя,
  // человек не отличит это от зависания.
  await toast(typed, 'Кнопка устарела, откройте меню');
};

/**
 * Разговор с продолжением из общего чата не начинается: он уводится в переписку.
 */
const inviteToDialog = async (typed: BotContext, name: string, openApp: () => Extra | undefined): Promise<void> => {
  const user = typed.user ?? typed.callback?.user ?? typed.message?.sender;

  await typed.reply(
    `${nameOf(user)}, это разговор на двоих: напишите мне /${name} в личные сообщения.`,
    openApp(),
  );
};

/** Что бот делает и без согласия: приветствие, справка, документы и контакты. */
const WITHOUT_LEGAL = new Set(['start', 'help', 'legal', 'contacts']);

/** Куда ведёт кнопка под уведомлением: подпись под раздел приложения. */
const SECTION_TITLES: Record<string, string> = {
  news: 'В приложении',
  meters: 'В приложении',
  polls: 'Собрание в приложении',
  inspections: 'Осмотры в приложении',
  list: 'В приложении',
  queue: 'Очередь в приложении',
};

/** Меню команд в клиенте MAX. */
export const BOT_COMMANDS = [
  { name: 'new', description: 'Новая заявка' },
  { name: 'my', description: 'Свои заявки и наряды' },
  { name: 'meters', description: 'Подать показания' },
  { name: 'bill', description: 'Квитанция за месяц' },
  { name: 'vote', description: 'Собрания и предложения' },
  { name: 'news', description: 'Объявления дома' },
  { name: 'neighbours', description: 'О чём сообщили соседи' },
  { name: 'door', description: 'Открыть домофон' },
  { name: 'house', description: 'Как работает управляющая компания' },
  { name: 'contacts', description: 'К кому обращаться по дому' },
  { name: 'support', description: 'Вопрос в управляющую компанию' },
  { name: 'visit', description: 'Записаться на приём' },
  { name: 'stickers', description: 'Наклейка с кодом объекта' },
  { name: 'duty', description: 'Принять или сдать дежурство' },
  { name: 'report', description: 'Сводка по дому' },
  { name: 'debts', description: 'Долги дома' },
  { name: 'broadcast', description: 'Рассылка жильцам' },
  { name: 'gzhi', description: 'Обращение в жилинспекцию' },
  { name: 'flat', description: 'Выбрать свою квартиру' },
  { name: 'mydata', description: 'Что о вас знает Домовой' },
  { name: 'legal', description: 'Документы и согласие' },
  { name: 'help', description: 'Что я умею' },
];

/** Команда проверки: её добавляют к меню только в режиме DEMO_ROLES. */
export const DEMO_COMMAND = { name: 'demo', description: 'Роль для проверки' };

export interface BotOptions {
  token: string;
  /** Зависимости прикладного слоя. Канал уведомлений бот подставляет себе сам. */
  deps: AppDeps;
  /** Куда сообщать о неудачной доставке уведомления. */
  onNotifyError?: (error: unknown) => void;
  /** Адрес Bot API. Подменяется на эмулятор в тестах и на разработке. */
  baseUrl?: string;
  /** Имя мини-приложения для кнопки «Открыть приложение». */
  miniAppUrl?: string;
  /** Адрес сайта: по нему открываются документы продукта. */
  siteUrl?: string;
  /** Режим проверки: в переписке доступно переключение роли. */
  demo?: boolean;
  /** Расшифровка голосовых. Без неё голосовое сохраняется как вложение без текста. */
  transcriber?: Transcriber;
  /** Распознавание показаний с фотографии табло. Без него их вводят цифрами. */
  vision?: MeterVision;
  /** Где хранится позиция в потоке апдейтов. */
  markerStore?: MarkerStore;
  /** Куда сообщать об ошибке обработки апдейта. */
  onHandlerError?: (error: unknown, update: unknown) => void;
  /** Состояние диалога вне процесса. */
  sessionMiddleware?: (context: never, next: () => Promise<void>) => Promise<void>;
}


/** Доставка уведомлений через бота. */
export const createBotNotifier = (
  bot: Bot,
  onError?: (error: unknown) => void,
  miniAppUrl?: string,
): Notifier => ({
  async send({ maxUserId, text, actions, replyTo, askAbout, signAbout, answerAbout, section, mutable, complaintFor }) {
    try {
      await bot.api.sendMessageToUser(
        maxUserId,
        text,
        askAbout
          ? alertKeyboard(askAbout)
          : signAbout
            ? initiativeKeyboard(signAbout)
            : answerAbout
              ? supportKeyboard(answerAbout)
              : section || complaintFor
                ? keyboardOf([
                    ...(complaintFor
                      ? [[Keyboard.button.callback('📄 Жилинспекция', `gzhi:${complaintFor}`)]]
                      : []),
                    ...(section
                      ? appRow(miniAppUrl, SECTION_TITLES[section] ?? 'Открыть приложение', section)
                      : []),
                    ...(mutable ? [[Keyboard.button.callback('🔕 Уведомления', `mute:${mutable}`)]] : []),
                  ], PERSONAL)
                : actionKeyboard(actions, replyTo),
      );
    } catch (error) {
      onError?.(error);
    }
  },
  async sendFile({ maxUserId, as, name, content, encoding, text }) {
    try {
      const source = { buffer: Buffer.from(content, encoding), fileName: name };

      const attachment =
        as === 'image' ? await bot.api.uploadImage({ source }) : await bot.api.uploadFile({ source });

      const message = await bot.api.sendMessageToUser(maxUserId, text ?? '', {
        attachments: [attachment.toJson()],
      });

      return message.body.mid;
    } catch (error) {
      onError?.(error);
      return undefined;
    }
  },
  async sendToChat(chatId, text) {
    try {
      const message = await bot.api.sendMessageToChat(chatId, text);

      return message.body.mid;
    } catch (error) {
      onError?.(error);
      return undefined;
    }
  },
  async pinInChat(chatId, messageId) {
    try {
      await bot.api.pinMessage(chatId, messageId, { notify: false });
    } catch (error) {
      onError?.(error);
    }
  },
  async unpinInChat(chatId) {
    try {
      const pinned = await bot.api.getPinnedMessage(chatId);

      if (pinned.message?.sender?.user_id !== bot.botInfo?.user_id) return;

      await bot.api.unpinMessage(chatId);
    } catch (error) {
      onError?.(error);
    }
  },
});

/** В чате отвечают только тому, кто обратился: команда или обращение по имени. */
const answerable = (typed: BotContext): boolean =>
  !inChat(typed) || addressed(typed) || (typed.message?.body?.text?.trimStart().startsWith('/') ?? false);

/**
 * Непредвиденный сбой не должен выглядеть как молчание: человек узнаёт, что не
 * вышло, а сама ошибка уходит наверх, в журнал.
 */
const guarded =
  (run: (typed: BotContext) => Promise<void>) =>
  async (typed: BotContext): Promise<void> => {
    try {
      await run(typed);
    } catch (error) {
      if (typed.callback?.callback_id) await toast(typed, 'Не получилось. Попробуйте ещё раз');
      else if (answerable(typed)) {
        await typed.reply('Не получилось выполнить. Попробуйте ещё раз.', menuButton(typed)).catch(() => undefined);
      }

      throw error;
    }
  };

export const createDomovoyBot = (
  options: BotOptions,
): {
  bot: Bot;
  supervisor: UpdateSupervisor;
  deps: AppDeps;
  /** Обработать один апдейт: так его приносит вебхук. */
  handleUpdate: (update: unknown) => Promise<void>;
} => {
  const bot = new Bot(options.token, {
    ...(options.baseUrl ? { clientOptions: { baseUrl: options.baseUrl } } : {}),
  });

  installResilientApi(bot, options.token, {
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    rateLimit: { rps: 30 },
    retry: { attempts: 3 },
  });

  const deps: AppDeps = {
    ...options.deps,
    notifier: options.deps.notifier ?? createBotNotifier(bot, options.onNotifyError, options.miniAppUrl),
  };

  bot.use(scenarioRecovery() as never);
  bot.use((options.sessionMiddleware ?? session({ store: new MemorySessionStore<DialogSession>() })) as never);

  const residentOf = async (context: BotContext, buildingId?: string): Promise<Resident> => {
    const user = context.user ?? context.callback?.user ?? context.message?.sender;
    const maxUserId = user?.user_id;

    if (maxUserId === undefined) throw new DomainError('user_unknown', 'Не удалось определить пользователя');

    return ensureResident(deps, { maxUserId, displayName: nameOf(user), ...(buildingId ? { buildingId } : {}) });
  };

  /** Дом, которому принадлежит этот чат. */
  const houseOf = async (context: BotContext): Promise<Building | undefined> =>
    context.chatId === undefined ? undefined : buildingByChat(deps, context.chatId);

  /** Без адреса мини-приложения сообщение остаётся с кнопкой меню, а не голым. */
  const openAppKeyboard = (startParam?: string, context?: BotContext) => {
    if (!options.miniAppUrl) return context ? menuButton(context) : undefined;

    const url = appLink(options.miniAppUrl, startParam);
    return { attachments: [Keyboard.inlineKeyboard([[Keyboard.button.openApp('📱 Открыть приложение', url)]])] };
  };

  bot.on('bot_started', (context) =>
    greet(kit, context as never as BotContext, (context.update as { payload?: string | null }).payload),
  );

  bot.command('start', (context) => greet(kit, context as never));

  /**
   * Личный ответ в общем чате: обработчик тот же, меняется только адрес ответа.
   */
  const answerPrivately = async (typed: BotContext, run: (typed: BotContext) => Promise<void>): Promise<void> => {
    const user = typed.user ?? typed.callback?.user ?? typed.message?.sender;
    const userId = user?.user_id;

    if (userId === undefined) return;

    typed.session ??= {};

    const personal = Object.create(typed) as BotContext;

    personal.reply = (text, extra) => bot.api.sendMessageToUser(userId, text, extra);

    try {
      await run(personal);
      await typed.reply(`${nameOf(user)}, ответил вам лично.`);
    } catch (error) {
      if (error instanceof DomainError) throw error;

      await typed.reply(
        `${nameOf(user)}, это видно только вам: напишите мне в личные сообщения, там и отвечу.`,
        openAppKeyboard(),
      );
    }
  };

  /** Команда и кнопка меню вызывают один обработчик. */
  const actions = new Map<string, (typed: BotContext) => Promise<void>>();

  const command = (name: string, run: (typed: BotContext) => Promise<void>): void => {
    const dispatch = guarded(async (typed: BotContext): Promise<void> => {
      // Команда отменяет начатый разговор: иначе следующее сообщение уходит
      // в прежнее ожидание, а человек уже говорит о другом.
      forget(typed);

      // До согласия с документами продукт делает только то, что без обработки
      // данных обойтись не может: здоровается, объясняет себя и даёт контакты.
      if (!inChat(typed) && !WITHOUT_LEGAL.has(name) && (await needsLegal(kit, typed, name))) return undefined;

      if (!inChat(typed) || !PRIVATE_COMMANDS.has(name)) return run(typed);

      return DIALOG_COMMANDS.has(name) ? inviteToDialog(typed, name, openAppKeyboard) : answerPrivately(typed, run);
    });

    actions.set(name, dispatch);
    bot.command(name, (context) => dispatch(context as never));
  };

  const kit: BotKit = {
    bot,
    deps,
    openApp: openAppKeyboard,
    ...(options.miniAppUrl ? { miniAppUrl: options.miniAppUrl } : {}),
    ...(options.siteUrl ? { siteUrl: options.siteUrl } : {}),
    ...(options.demo ? { demo: true } : {}),
    ...(options.transcriber ? { transcriber: options.transcriber } : {}),
    ...(options.vision ? { vision: options.vision } : {}),
    residentOf,
    houseOf,
    chatHelp,
    menuKeyboard: (resident) =>
      menuKeyboard(resident, options.miniAppUrl, { doors: Boolean(deps.hub), demo: Boolean(options.demo) }),
    answered: (typed, resident, description, startParam) =>
      answerQuestion(kit, typed, resident, description, startParam),
    announce: (typed, result, description, startParam, unheard) =>
      announce(kit, typed, result, description, startParam, unheard),
    run: async (name, typed) => {
      const action = actions.get(name);

      if (!action) return false;

      await action(typed);

      return true;
    },
  };

  // Команды разложены по областям продукта, регистрируются одинаково.
  const areas = [
    legalCommands,
    basicCommands,
    moneyCommands,
    houseCommands,
    staffCommands,
    stickerCommands,
    broadcastCommands,
    visitCommands,
  ];

  for (const area of areas) {
    for (const [name, run] of Object.entries(area(kit))) command(name, run);
  }

  /**
   * Бота добавили в чат дома. Управляющему привязываем чат сразу: он для этого
   * бота и звал. Остальным объясняем, чего не хватает.
   */
  registerChatEvents(kit);

  /** Нажатия кнопок под заявкой. */
  bot.on('message_callback', guarded((typed) => pressed(kit, typed)) as never);

  registerComments(kit, options.onNotifyError);

  /** Команду, которой нет, бот не проглатывает: человек ждёт хоть какого-то ответа. */
  const unknownCommand = async (typed: BotContext, text: string): Promise<void> => {
    const name = text.slice(1).split(/[\s@]/)[0] ?? '';

    if (actions.has(name) || name === 'start' || inChat(typed)) return;

    await typed.reply('Такой команды у меня нет. Что нужно сделать?', kit.menuKeyboard(await residentOf(typed)));
  };

  bot.on(
    'message_created',
    guarded(async (typed) => {
      const written = typed.message?.body?.text;
      const text = written?.trim();
      const attachments = toAttachments(typed.message?.body?.attachments);

      // В чате на непонятое лучше промолчать, а в переписке ответить: там ждут ответа.
      // Пустой текст и сообщение вовсе без текста, это разные случаи: первый пишет
      // человек, второй приходит от наклейки или геометки.
      if (!text && attachments.length === 0) {
        if (!inChat(typed)) {
          await continueDialog(kit, typed, { ...(written === undefined ? {} : { text: '' }), attachments: [] });
        }

        return;
      }

      if (text?.startsWith('/')) return unknownCommand(typed, text);

      if (inChat(typed)) {
        await speakInChat(kit, typed);
        return;
      }

      await continueDialog(kit, typed, { text, attachments });
    }) as never,
  );

  const supervisor = createBotSupervisor(bot, {
    timeoutSeconds: 30,
    ...(options.markerStore ? { markerStore: options.markerStore } : {}),
    onHandlerError: (error, update) => options.onHandlerError?.(error, update),
  });

  /** Один апдейт через ту же цепочку обработчиков: так его приносит вебхук. */
  const handleUpdate = async (update: unknown): Promise<void> => {
    const context = new Context(update as never, bot.api, bot.botInfo);

    await bot.middleware()(context, () => Promise.resolve());
  };

  return { bot, supervisor, deps, handleUpdate };
};

/** Код объекта из ссылки, по которой пришёл пользователь. */
export const targetFromPayload = (payload: string | null | undefined) =>
  payload ? decodeTarget(payload) : null;
