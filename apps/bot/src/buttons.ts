import {
  actionsFor,
  answerAlert,
  apartmentsOf,
  arrearsFor,
  bindApartment,
  chargesForResident,
  counted,
  devicesFor,
  errorTextFor,
  exportPersonalData,
  formatPersonalData,
  homeOf,
  personalDataSummary,
  roleTitle,
  setLanguage,
  takeDemoRole,
  forgetResident,
  unbindApartment,
  choiceTitle,
  dropVisit,
  escalationFor,
  formatHandoff,
  formatPollResult,
  getRequestFor,
  inviteGuest,
  listAssignable,
  listOwnApartments,
  metersFor,
  setNotice,
  openDevice,
  passRequest,
  payArrears,
  payCharges,
  responsibilityOf,
  retargetRequest,
  sendComplaint,
  sendSnapshot,
  submitProblem,
  supportInitiative,
  supportRequest,
  transitionRequest,
  translateForReading,
  useApartment,
  vote,
  zoneOf,
} from '@domovoy/app';
import {
  DomainError,
  describeTarget,
  formatClock,
  isHandoffTarget,
  formatMoney,
  isCompanyStaff,
  sectionParam,
  statusTitle,
  targetName,
  verificationState,
  type NoticeKind,
} from '@domovoy/domain';
import { languageTitle } from '@domovoy/i18n';

import { speak } from './i18n.js';
import {
  actionKeyboard,
  afterError,
  appRow,
  assignable,
  errorAction,
  assignKeyboard,
  cancelKeyboard,
  COMMENT_PROMPTS,
  confirmKeyboard,
  copyKeyboard,
  doorKeyboard,
  errorText,
  flatTitle,
  formatInitiative,
  guestKeyboard,
  handoffKeyboard,
  keyboardOf,
  menuButton,
  oneKeyboard,
  passKeyboard,
  pollKeyboard,
  rateKeyboard,
  readingKeyboard,
  readingPrompt,
  replyIfOpen,
  visitKeyboard,
} from './keyboards.js';
import { sayBound, welcome } from './greeting.js';
import { takeReading } from './readings.js';
import { inApp } from './commands/in-app.js';
import { takeLegal } from './commands/legal.js';
import { freeHours } from './commands/visits.js';
import { groupFor, groupKeyboard, groupWith, itemFor } from './menu.js';
import { showNews, showSupport } from './pages.js';
import { askStarter } from './talk.js';
import {
  endTalk,
  expect,
  forget,
  inChat,
  morphing,
  plain,
  pressedMid,
  speaking,
  strong,
  toast,
  type BotContext,
} from './max.js';
import type { Resident } from '@domovoy/app';
import type { BotKit, Extra } from './kit.js';

/** Нажатие кнопки: имя действия и его данные приходят одной строкой через двоеточие. */
export type Button = (kit: BotKit, typed: BotContext, args: string[]) => Promise<void>;

/** Отказ правил объясняется словами, всё остальное поднимается выше. */
const explain = async (typed: BotContext, error: unknown, prefix?: string): Promise<void> => {
  if (!(error instanceof DomainError)) throw error;

  const t = speaking(typed);
  const said = prefix ?? t('error.failed_short');
  const fix = errorAction(error, t);

  // Отказ на нажатие показывается сразу уведомлением, а следом остаётся
  // сообщением: всплывающее живёт пару секунд, и человек, который читает
  // медленно, решает, что кнопка не сработала. В общем чате остаётся
  // уведомление: разбирательство при соседях никому не нужно.
  if (!fix && typed.callback?.callback_id) {
    await toast(typed, `${said}: ${errorTextFor(t, error)}`);

    if (inChat(typed)) return;
  }

  await typed.reply(`${said}: ${errorText(error, t)}`, fix ?? menuButton(typed, t));
};

/**
 * Кнопка из старого сообщения. Всплывающее уведомление живёт пару секунд, и
 * человек, который читает медленно, остаётся ни с чем: поэтому меню приходит
 * сообщением, а не советом его открыть.
 */
const stale = async (typed: BotContext, kit?: BotKit): Promise<void> => {
  await toast(typed, speaking(typed)('button.stale'));

  if (!kit || inChat(typed)) return;

  const resident = await kit.residentOf(typed);

  await typed.reply(speak(resident)('button.stale_more'), kit.menuKeyboard(resident));
};

/** «Рассылка должникам» из списка долгов: письмо собирается там же, где и остальные. */
const cast: Button = async (kit, typed) => {
  await kit.run('broadcast', typed);
};

/**
 * Пункт меню, который живёт в приложении. В переписке он рассказывает, что там
 * делают, и открывает нужный раздел: иначе о половине продукта человек
 * не узнает, а делать это в чате мучительно.
 */
const app: Button = async (kit, typed, [name]) => {
  if (!name) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const item = itemFor(resident, name, { doors: Boolean(kit.deps.hub) });

  if (!item?.app) return stale(typed, kit);

  const t = speak(resident);

  await inApp(kit, typed, `${strong(t(item.title))}\n${t(item.app.about)}`, item.app.screen, undefined, t);
};

/**
 * Кнопка меню повторяет команду. Заодно запоминается, откуда пришли: из группы
 * или с первого экрана. По этому отмена и возвращает туда же, а не в меню.
 */
const menu: Button = async (kit, typed, [name]) => {
  if (!name) {
    await stale(typed, kit);
    return;
  }

  const resident = await kit.residentOf(typed);
  const where = groupWith(resident, name, { doors: Boolean(kit.deps.hub) });

  typed.session ??= {};

  if (where) typed.session.menu = where;
  else delete typed.session.menu;

  if (await kit.run(name, typed)) return;

  await stale(typed, kit);
};

/** Группа меню: её пункты показываются вторым экраном, с возвратом назад. */
const group: Button = async (kit, typed, [key]) => {
  if (inChat(typed)) {
    await typed.reply(speaking(typed)('menu.in_chat'), kit.openApp(undefined, typed));
    return;
  }

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  if (!key || key === 'back') {
    typed.session ??= {};
    delete typed.session.menu;

    await typed.reply(await menuTitle(kit, resident), kit.menuKeyboard(resident));
    return;
  }

  const chosen = groupFor(resident, key, { doors: Boolean(kit.deps.hub) });

  if (!chosen) return stale(typed, kit);

  // Группа запоминается: отмена начатого возвращает туда, откуда его начали.
  typed.session ??= {};
  typed.session.menu = chosen.key;

  // Заголовка группы человеку мало: строка объясняет, что тут делают.
  await typed.reply(
    chosen.about ? `${strong(t(chosen.title))}\n${t(chosen.about)}` : strong(t(chosen.title)),
    groupKeyboard(chosen, t),
  );
};

/**
 * Первый экран: кто я, чей это дом и чья квартира. Без этого человек видит
 * набор кнопок и не понимает, куда попал и за какой адрес отвечает бот.
 */
export const menuTitle = async (kit: BotKit, resident: Resident): Promise<string> => {
  const t = speak(resident);
  const home = await homeOf(kit.deps, resident).catch(() => undefined);
  const building = home ? await kit.deps.repository.findBuilding(home) : undefined;
  const apartment = resident.apartmentId
    ? await kit.deps.repository.findApartment(resident.apartmentId).catch(() => undefined)
    : undefined;

  const where = [building?.address, apartment ? t('flat.short', { номер: apartment.number }) : '']
    .filter(Boolean)
    .join(', ');

  const who = resident.role === 'resident' ? '' : roleTitle(resident.role);

  return [
    strong(
      `${t('menu.title')}${where ? `: ${plain(where)}` : ''}${who ? ` · ${who}` : ''}`,
    ),
    // Кнопки это короткий путь, а не единственный: словами делается то же самое,
    // и человеку проще написать «открыть дверь», чем искать её в меню.
    t('menu.words'),
  ].join('\n');
};

/** Экран, с которого человек ушёл в разговор: группа меню либо первый экран. */
const backTo = async (kit: BotKit, typed: BotContext): Promise<{ title: string; extra: Extra | undefined }> => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);
  const key = typed.session?.menu;
  const chosen = key ? groupFor(resident, key, { doors: Boolean(kit.deps.hub) }) : undefined;

  if (!chosen) return { title: await menuTitle(kit, resident), extra: kit.menuKeyboard(resident) };

  return {
    title: chosen.about ? `${strong(t(chosen.title))}\n${t(chosen.about)}` : strong(t(chosen.title)),
    extra: groupKeyboard(chosen, t),
  };
};

/**
 * Отказ от начатого разговора: ожидание снимается, ничего не создаётся.
 * Экран разговора переписывается на месте, а чек заявки или код гостя нет:
 * их правкой стирать нельзя, поэтому возврат приходит отдельным сообщением.
 */
const cancel: Button = async (kit, typed) => {
  forget(typed);

  if (inChat(typed)) {
    await toast(typed, speaking(typed)('dialog.cancelled_toast'));
    return;
  }

  const back = await backTo(kit, typed);
  const here = pressedMid(typed);
  const onScreen = here !== undefined && here === typed.session?.screen;

  await (onScreen ? morphing(typed) : typed).reply(back.title, back.extra);
};

/**
 * Выход из разговора с помощником. Отдельной кнопкой, а не отменой: отмена
 * стёрла бы сам разговор, а его человек может перечитать.
 */
const talk: Button = async (kit, typed, [what]) => {
  if (what !== 'stop') return stale(typed, kit);

  forget(typed);
  endTalk(typed);

  const back = await backTo(kit, typed);

  await typed.reply(back.title, back.extra);
};

/** Готовый вопрос кнопкой: с него начинают те, кто не знает, что спросить. */
const starter: Button = async (kit, typed, [at]) => {
  const asked = await askStarter(kit, typed, Number(at));

  if (asked === undefined) await stale(typed, kit);
};

/** Выбранный язык: дальше продукт говорит на нём. */
const language: Button = async (kit, typed, [code]) => {
  if (!code) return stale(typed, kit);

  const resident = await kit.residentOf(typed);

  try {
    const saved = await setLanguage(kit.deps, resident, code);

    typed.session ??= {};
    typed.session.lang = saved.language;

    // Первый выбор: за ним идёт само начало разговора вместе с кодом из ссылки,
    // который его дожидался.
    const started = typed.session.afterLang;

    if (started !== undefined) {
      delete typed.session.afterLang;

      await welcome(kit, typed, started || undefined);
      return;
    }

    await typed.reply(
      speak(saved)('lang.chosen', { язык: languageTitle(saved.language ?? 'ru') }),
      kit.menuKeyboard(saved),
    );
  } catch (error) {
    await explain(typed, error);
  }
};

/** «Всё равно оставить заявку»: обращение, на которое ответили работами или советом. */
const anyway: Button = async (kit, typed) => {
  const description = typed.session?.plannedDescription;
  const author = await kit.residentOf(typed);
  const t = speak(author);

  if (!description) {
    expect(typed, { kind: 'description' });

    await typed.reply(t('dialog.forgot'), cancelKeyboard(t));
    return;
  }

  const startParam = typed.session?.plannedTarget;

  delete typed.session?.plannedDescription;
  delete typed.session?.plannedTarget;

  const result = await submitProblem(kit.deps, {
    resident: author,
    description,
    anyway: true,
    ...(startParam ? { startParam } : {}),
  });

  await kit.announce(typed, result, description, startParam);
};

/** Голос на собрании. В чате виден результат, а сам голос уходит в переписку. */
const ballot: Button = async (kit, typed, [pollId, choice]) => {
  if (!pollId || !choice) return stale(typed, kit);

  const voter = await kit.residentOf(typed);
  const t = speak(voter);

  try {
    const view = await vote(kit.deps, { resident: voter, pollId, choice: choice as never });
    const publicly = inChat(typed);

    // В общем чате итоги читают все соседи: там они остаются на языке дома.
    await typed.reply(
      formatPollResult(view, { personal: !publicly, ...(publicly ? {} : { t }) }),
      view.open ? pollKeyboard(view.poll.id, t) : undefined,
    );

    if (publicly && voter.maxUserId !== undefined) {
      await kit.bot.api
        .sendMessageToUser(
          voter.maxUserId,
          t('vote.counted', {
            собрание: view.poll.title,
            ответ: choiceTitle(t, choice as never).toLowerCase(),
          }),
        )
        .catch(() => undefined);
    }
  } catch (error) {
    await explain(typed, error, t('vote.refused'));
  }
};

/** Выбор своей квартиры: по ней идут показания и квитанция. */
const flat: Button = async (kit, typed, [apartmentId]) => {
  if (!apartmentId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  try {
    const saved = await useApartment(kit.deps, resident, apartmentId);
    const apartment = (await listOwnApartments(kit.deps, saved)).find((item) => item.current);

    await toast(
      typed,
      apartment ? t('flat.used', { квартира: flatTitle(apartment, t) }) : t('flat.used_plain'),
    );
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    await typed.reply(errorText(error, t), afterError(error, typed, t));
  }
};

/**
 * Привязка по коду, подтверждённая кнопкой. Своя квартира у человека уже есть,
 * и код уводит счётчики с квитанцией в другую: без его ответа этого не делают.
 */
const bind: Button = async (kit, typed, [code]) => {
  if (!code) return stale(typed, kit);

  const resident = await kit.residentOf(typed);

  try {
    await sayBound(kit, typed, await bindApartment(kit.deps, resident, code));
  } catch (error) {
    await explain(typed, error);
  }
};

/**
 * Показание, прочитанное с фотографии табло, подтверждено человеком. Само оно
 * не подаётся: ошибиться в цифре на снимке легко, а начисление идёт по ней.
 */
const meterRead: Button = async (kit, typed, [meterId, value]) => {
  if (!meterId || value === undefined) return stale(typed, kit);

  await takeReading(kit, typed, meterId, value);
};

/** Подпись под предложением соседа. */
const sign: Button = async (kit, typed, [initiativeId]) => {
  if (!initiativeId) return stale(typed, kit);

  const signer = await kit.residentOf(typed);
  const t = speak(signer);

  try {
    await typed.reply(
      formatInitiative(await supportInitiative(kit.deps, { resident: signer, initiativeId }), t),
      menuButton(typed, t),
    );
  } catch (error) {
    await explain(typed, error, t('sign.refused'));
  }
};

/**
 * Деньги списываются без возврата, поэтому сумма называется до нажатия.
 * Первое нажатие показывает, за что и сколько, второе платит.
 */
const payMonth: Button = async (kit, typed, [step]) => {
  const payer = await kit.residentOf(typed);
  const t = speak(payer);

  if (step !== 'yes') {
    const charges = await chargesForResident(kit.deps, payer);
    const left = Math.max(0, charges.total - charges.paid);

    await typed.reply(
      t('pay.month_ask', { сумма: formatMoney(left, t) }),
      confirmKeyboard(t('button.pay_month_yes', { сумма: formatMoney(left, t) }), 'pay:yes', t),
    );
    return;
  }

  try {
    const receipt = await payCharges(kit.deps, payer);

    await typed.reply(t('pay.month_done', { сумма: formatMoney(receipt.amount, t) }), menuButton(typed, t));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    await typed.reply(errorText(error, t), afterError(error, typed, t));
  }
};

const payDebt: Button = async (kit, typed, [step]) => {
  const payer = await kit.residentOf(typed);
  const t = speak(payer);

  if (step !== 'yes') {
    const debt = await arrearsFor(kit.deps, payer);
    const total = debt.total + debt.penalty;

    await typed.reply(
      t('pay.debt_ask', { сумма: formatMoney(total, t) }),
      confirmKeyboard(t('button.pay_debt_yes', { сумма: formatMoney(total, t) }), 'pay-debt:yes', t),
    );
    return;
  }

  try {
    const receipts = await payArrears(kit.deps, payer);
    const total = receipts.reduce((sum, receipt) => sum + receipt.amount, 0);

    await typed.reply(
      t('pay.debt_done', { сумма: formatMoney(total, t), месяцы: counted(t, 'months', receipts.length) }),
      menuButton(typed, t),
    );
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    await typed.reply(errorText(error, t), afterError(error, typed, t));
  }
};

const door: Button = async (kit, typed, [deviceId]) => {
  if (!deviceId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  try {
    const device = await openDevice(kit.deps, resident, deviceId);
    const apartment = resident.apartmentId
      ? await kit.deps.repository.findApartment(resident.apartmentId)
      : undefined;

    // Двери остаются на экране: человек мог нажать не ту, и возвращаться
    // за списком назад ему некогда, дверь уже закрывается.
    const devices = await devicesFor(kit.deps, resident, apartment?.entrance).catch(() => []);

    await typed.reply(
      t('door.opened', { дверь: device.title }),
      devices.length > 1
        ? doorKeyboard(
            devices.filter((item) => item.kind !== 'camera'),
            devices.filter((item) => item.kind === 'camera'),
            device.id,
            t,
          )
        : guestKeyboard(device.id, t),
    );
  } catch (error) {
    await explain(typed, error);
  }
};

/** Кадр с камеры приходит прямо в переписку: это проверка, а не работа с экраном. */
const camera: Button = async (kit, typed, [deviceId]) => {
  if (!deviceId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  try {
    const sent = await sendSnapshot(kit.deps, resident, deviceId);

    await toast(typed, t('door.snapshot', { камера: sent.title }));
  } catch (error) {
    await explain(typed, error, t('door.no_snapshot'));
  }
};

const guest: Button = async (kit, typed, [deviceId]) => {
  if (!deviceId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  try {
    const issued = await inviteGuest(kit.deps, resident, deviceId);

    await typed.reply(
      t('door.guest_code', { код: strong(issued.code), время: formatClock(issued.expiresAt, undefined, t) }),
      copyKeyboard(t('button.copy_code'), issued.code),
    );
  } catch (error) {
    await explain(typed, error);
  }
};

/** Ответ соседа на вопрос об аварии: «у меня то же самое» или «у меня работает». */
const alarmAnswer =
  (affected: boolean): Button =>
  async (kit, typed, [requestId]) => {
    if (!requestId) return stale(typed, kit);

    const neighbour = await kit.residentOf(typed);
    const t = speak(neighbour);

    try {
      const { request: updated, counted } = await answerAlert(kit.deps, {
        resident: neighbour,
        requestId,
        affected,
      });

      // Ответ виден сообщением, а не всплывающим уведомлением: его человек
      // читает две секунды и решает, что нажатие не сработало.
      if (!counted) {
        await typed.reply(t('request.answered_already', { номер: updated.number }), menuButton(typed, t));
        return;
      }

      if (!affected) {
        await typed.reply(t('request.fine'), menuButton(typed, t));
        return;
      }

      await typed.reply(
        t('request.same_here', { номер: strong(updated.number) }),
        actionKeyboard([], replyIfOpen(updated), undefined, undefined, t),
      );
    } catch (error) {
      // Заявку соседа могли уже закрыть: человеку это говорят словами, иначе
      // нажатие выглядит сломанным.
      if (error instanceof DomainError && error.code === 'request_closed') {
        await typed.reply(t('request.closed_already'), menuButton(typed, t));
        return;
      }

      await explain(typed, error);
    }
  };

/** «И у меня»: жилец присоединяется к заявке соседа. */
const support: Button = async (kit, typed, [requestId]) => {
  if (!requestId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  // Свой вопрос сотрудника: он идёт тем же путём, что и вопрос жильца.
  if (requestId === 'own') {
    expect(typed, { kind: 'support' });

    await typed.reply(t('support.ask'), cancelKeyboard(t));

    return;
  }

  try {
    const { request: updated, reporters } = await supportRequest(kit.deps, resident, requestId);

    await typed.reply(
      t('request.same_counted', { номер: updated.number, сообщили: counted(t, 'reporters', reporters) }),
      actionKeyboard([], replyIfOpen(updated), undefined, undefined, t),
    );
  } catch (error) {
    await explain(typed, error);
  }
};

/** «Ответить» под обращением в поддержку: следующее сообщение уходит в него. */
const ticket: Button = async (kit, typed, [ticketId]) => {
  if (!ticketId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  typed.session ??= {};
  expect(typed, { kind: 'support', ticketId });

  await typed.reply(
    isCompanyStaff(resident.role) ? 'Напишите ответ жильцу одним сообщением.' : t('support.reply_ask'),
    cancelKeyboard(t),
  );
};

/** Ответ на уточняющий вопрос: нажатая кнопка ставит заявке настоящий адрес. */
const where: Button = async (kit, typed, [requestId, index]) => {
  const asked = typed.session?.where;
  const mine = Boolean(requestId) && asked?.requestId === requestId;
  const option = mine ? asked?.options[Number(index)] : undefined;

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  // Адрес человек не знает: заявка от этого не пропадает, и сказать об этом
  // надо словами. Иначе кнопка читается как отказ от самой заявки.
  if (mine && index === 'skip') {
    delete typed.session?.where;
    forget(typed);

    await typed.reply(t('request.where_skipped'), kit.menuKeyboard(resident));

    return;
  }

  if (!requestId || !option) return stale(typed, kit);

  try {
    const updated = await retargetRequest(kit.deps, { resident, requestId, startParam: option.startParam });

    delete typed.session?.where;

    // Объект назван справочником дома: жилец читает его на своём языке, как
    // и на кнопке, которую он только что нажал.
    const machine = await translateForReading(kit.deps, resident, [targetName(updated.target)]);

    await typed.reply(
      t('request.where_set', { где: machine.of(describeTarget(updated.target, undefined, t)), номер: updated.number }),
      actionKeyboard(actionsFor(updated, resident), replyIfOpen(updated), undefined, undefined, t),
    );
  } catch (error) {
    await explain(typed, error, t('request.where_refused'));
  }
};

/** «Передать»: смена выбирает организацию из заведённых в доме. */
const pass: Button = async (kit, typed, [requestId]) => {
  if (!requestId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);

  if (!isCompanyStaff(resident.role)) {
    await toast(typed, 'Передаёт обращение управляющая организация');
    return;
  }

  const request = await getRequestFor(kit.deps, resident, requestId);

  if (!request) return stale(typed, kit);

  const view = await responsibilityOf(kit.deps, request);

  if (view.targets.length === 0) {
    // Раздел есть только у управляющего: диспетчеру незачем искать кнопку,
    // которой у него нет.
    await typed.reply(
      resident.role === 'manager'
        ? 'Смежных организаций в карточке дома нет. Заведите их в разделе «🏠 Карточка дома».'
        : 'Смежных организаций в карточке дома нет. Попросите управляющего их завести.',
      resident.role === 'manager' ? oneKeyboard('🏠 Карточка дома', 'app:card') : menuButton(typed),
    );
    return;
  }

  await typed.reply(
    `Отвечает: ${view.responsibility.title}.\n${view.responsibility.basis}\nКому передать обращение?`,
    passKeyboard(request.id, view.targets),
  );
};

/** Организация выбрана: обращение уходит и срок ответа называется сразу. */
const passTo: Button = async (kit, typed, [requestId, to]) => {
  if (!requestId || !to || !isHandoffTarget(to)) return stale(typed, kit);

  const staff = await kit.residentOf(typed);

  try {
    const handoff = await passRequest(kit.deps, { staff, requestId, to });

    await typed.reply(
      `Передано: ${handoff.organization}.\n${formatHandoff(handoff, kit.deps.now())}`,
      handoffKeyboard(handoff.id),
    );
  } catch (error) {
    await explain(typed, error, 'Не передали');
  }
};

/** «Ответ получен»: текст ответа приходит следующим сообщением. */
const handoffAnswer: Button = async (kit, typed, [handoffId]) => {
  if (!handoffId) return stale(typed, kit);

  typed.session ??= {};
  expect(typed, { kind: 'handoff', handoffId });

  await typed.reply('Что ответила организация? Напишите одним сообщением.', cancelKeyboard());
};

/** Час приёма выбран: остаётся спросить, с чем человек придёт. */
const visit: Button = async (kit, typed, parts) => {
  const at = parts.join(':');

  if (!at) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  try {
    // Пока сообщение висело в переписке, час мог занять сосед: тему спрашивать поздно.
    const { hours } = await freeHours(kit, resident);

    if (!hours.some((hour) => hour.at === at)) {
      await typed.reply(
        hours.length === 0 ? t('visit.taken_none') : t('visit.taken'),
        hours.length === 0 ? menuButton(typed, t) : visitKeyboard(hours, undefined, t),
      );
      return;
    }
  } catch (error) {
    await explain(typed, error, t('visit.not_opened'));
    return;
  }

  expect(typed, { kind: 'visit', at });

  await typed.reply(t('visit.topic_ask'), cancelKeyboard(t));
};

/** Отмена своей записи на приём. */
const visitCancel: Button = async (kit, typed, [visitId]) => {
  if (!visitId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  try {
    await dropVisit(kit.deps, resident, visitId);
    await typed.reply(t('visit.cancelled'), kit.menuKeyboard(resident));
  } catch (error) {
    await explain(typed, error, t('visit.not_cancelled'));
  }
};

/** «Написать по заявке»: следующее сообщение уходит в переписку по ней. */
const say: Button = async (kit, typed, [requestId]) => {
  if (!requestId) return stale(typed, kit);

  const t = speak(await kit.residentOf(typed));

  typed.session ??= {};
  expect(typed, { kind: 'message', requestId });

  await typed.reply(t('request.reply_ask'), cancelKeyboard(t));
};

/**
 * Обращение в жилинспекцию по конкретной заявке. Текст продукт составляет сам
 * и сам же отправляет каналом надзора: переписывать его в чужую форму жилец
 * не должен. Отправка идёт по согласию, отдельной кнопкой.
 */
const complaint: Button = async (kit, typed, [requestId, what]) => {
  if (!requestId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  try {
    // Обращение уходит в надзорный орган и отзыву не подлежит: между чтением
    // текста и отправкой стоит ответ человека.
    if (what === 'send') {
      await typed.reply(
        t('gzhi.confirm'),
        confirmKeyboard(t('button.complaint_yes'), `gzhi:${requestId}:yes`, t),
      );

      return;
    }

    if (what === 'yes') {
      const { handoff } = await sendComplaint(kit.deps, resident, requestId);

      await typed.reply(
        t('gzhi.sent', { организация: handoff.organization }) +
          `${handoff.externalId ? `\n${t('gzhi.number_full', { номер: handoff.externalId })}` : ''}\n` +
          t('gzhi.answer_days'),
        menuButton(typed, t),
      );

      return;
    }

    const offer = await escalationFor(kit.deps, resident, requestId);

    if (!offer.possible || !offer.complaint) {
      await typed.reply(t('gzhi.no_ground'), menuButton(typed, t));
      return;
    }

    if (offer.sent) {
      await typed.reply(
        t('gzhi.sent_before', { организация: offer.sent.organization }) +
          `${offer.sent.externalId ? ` ${t('gzhi.number', { номер: offer.sent.externalId })}` : ''}`,
        menuButton(typed, t),
      );

      return;
    }

    await typed.reply(t('gzhi.reason_short', { основание: offer.reason }));
    await typed.reply(offer.complaint, oneKeyboard(t('button.complaint'), `gzhi:${requestId}:send`));
  } catch (error) {
    await explain(typed, error);
  }
};

/** Список смены под заявкой: имена и сколько нарядов уже на человеке. */
const offerAssignees = async (
  kit: BotKit,
  typed: BotContext,
  requestId: string,
  resident: Awaited<ReturnType<BotKit['residentOf']>>,
): Promise<void> => {
  const staff = await listAssignable(kit.deps, resident);

  if (staff.length === 0) {
    await typed.reply(
      'Некому поручить: в доме нет мастеров. Роли назначают в разделе «Люди дома».',
      keyboardOf([...appRow(kit.miniAppUrl, 'Люди дома в приложении', 'residents')], typed),
    );
    return;
  }

  await typed.reply(
    'Кому поручить? Рядом с именем, сколько нарядов уже на человеке.',
    assignKeyboard(requestId, staff, kit.miniAppUrl),
  );
};

/** Кому поручить наряд: список смены с загрузкой, выбор одним нажатием. */
const assign: Button = async (kit, typed, [requestId, staffId]) => {
  if (!requestId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);

  try {
    if (!staffId) {
      await offerAssignees(kit, typed, requestId, resident);
      return;
    }

    // Новую заявку сначала принимают, и только принятую поручают. Иначе выбор
    // мастера заканчивался отказом «из принята нельзя в выполняется», а работа
    // диспетчера откатывалась в ноль.
    const known = await kit.deps.repository.findRequest(requestId);

    if (known?.status === 'new') {
      await transitionRequest(kit.deps, { resident, requestId, to: 'accepted', quiet: true });
    }

    const updated = await transitionRequest(kit.deps, {
      resident,
      requestId,
      to: 'in_progress',
      assigneeId: staffId,
    });

    const master = (await listAssignable(kit.deps, resident)).find((person) => person.id === staffId);

    await typed.reply(
      `Заявка ${updated.number} поручена: ${master?.displayName ?? 'исполнителю'}.`,
      actionKeyboard(actionsFor(updated, resident), replyIfOpen(updated)),
    );
  } catch (error) {
    await explain(typed, error);
  }
};

/** Отказ от уведомлений этого вида и возврат их обратно. */
const notice =
  (on: boolean): Button =>
  async (kit, typed, [kind]) => {
    if (!kind) return stale(typed, kit);

    const resident = await kit.residentOf(typed);
    const t = speak(resident);

    try {
      const list = await setNotice(kit.deps, resident, kind as NoticeKind, on);
      const changed = list.find((item) => item.kind === kind);
      const what = changed?.title.toLowerCase() ?? t('notice.such');

      await typed.reply(
        on ? t('notice.on', { что: what }) : t('notice.off', { что: what }),
        oneKeyboard(t(on ? 'button.mute' : 'button.notices'), `${on ? 'mute' : 'unmute'}:${kind}`),
      );
    } catch (error) {
      await explain(typed, error);
    }
  };

/** «Показать ещё»: следующая страница того же списка. */
const more: Button = async (kit, typed, [what, from]) => {
  const offset = Number(from ?? 0);
  // Листаются только объявления и вопросы: остальные списки живут в приложении.
  const pages: Record<string, (kit: BotKit, typed: BotContext, offset: number) => Promise<unknown>> = {
    news: showNews,
    support: showSupport,
  };

  const page = what ? pages[what] : undefined;

  if (!page) return stale(typed, kit);

  await page(kit, typed, Number.isFinite(offset) ? offset : 0);
};

/** Отвязка квартиры: сначала вопрос, потом действие. */
const leave: Button = async (kit, typed, [step]) => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);
  const own = apartmentsOf(resident);

  if (own.length === 0) {
    await toast(typed, t('flat.not_bound'));
    return;
  }

  if (step !== 'yes') {
    await typed.reply(t('flat.unbind_ask'), confirmKeyboard(t('button.unbind_yes'), 'leave:yes', t));
    return;
  }

  try {
    const unbound = await unbindApartment(kit.deps, resident, resident.id);

    await toast(typed, t('flat.unbound_toast'));
    await typed.reply(t('flat.unbound'), kit.menuKeyboard(unbound));
  } catch (error) {
    await explain(typed, error);
  }
};

/** Удаление профиля: имя стирается, квартира отвязывается, дела дома остаются. */
const forgetMe: Button = async (kit, typed, [step]) => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  if (step !== 'yes') {
    await typed.reply(t('forget.ask'), confirmKeyboard(t('button.forget_yes'), 'forget:yes', t));
    return;
  }

  try {
    await forgetResident(kit.deps, resident);

    await typed.reply(t('forget.done'), menuButton(typed, t));
  } catch (error) {
    await explain(typed, error);
  }
};

/** Примерка роли на проверке: продукт дальше ведёт себя как для этой роли. */
const demo: Button = async (kit, typed, [role]) => {
  if (!kit.demo || !role) return;

  const resident = await kit.residentOf(typed);

  try {
    const saved = await takeDemoRole(kit.deps, resident, role as never);

    await typed.reply(`Роль: ${roleTitle(saved.role)}.`, kit.menuKeyboard(saved));
  } catch (error) {
    await explain(typed, error, 'Роль не примерилась');
  }
};

/** Выгрузка своих данных: файл уходит по просьбе, а не сам собой. */
const mydata: Button = async (kit, typed, [what]) => {
  if (what !== 'file') return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);
  const data = await exportPersonalData(kit.deps, resident);
  const text = formatPersonalData(data, await zoneOf(kit.deps, resident.buildingId));

  const sent =
    resident.maxUserId !== undefined && kit.deps.notifier?.sendFile
      ? await kit.deps.notifier
          .sendFile({
            maxUserId: resident.maxUserId,
            as: 'document',
            name: 'domovoy-data.txt',
            contentType: 'text/plain; charset=utf-8',
            content: text,
            encoding: 'utf8',
            text: t('data.file', { сводка: personalDataSummary(data) }),
          })
          .catch(() => undefined)
      : undefined;

  // Файл не ушёл: выгрузка целиком в переписку не помещается, поэтому
  // остаётся сводка и приложение, где эти же данные видны разделами.
  if (!sent) {
    await typed.reply(
      `${personalDataSummary(data)}\n${t('data.file_failed')}`,
      kit.openApp(sectionParam('profile'), typed),
    );
  }
};

/** Оценка при приёмке: ноль означает «принять без оценки». */
const rate: Button = async (kit, typed, [requestId, stars]) => {
  if (!requestId || stars === undefined) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);
  const rating = Number(stars);

  try {
    const updated = await transitionRequest(kit.deps, {
      resident,
      requestId,
      to: 'confirmed',
      ...(rating > 0 ? { rating } : {}),
    });

    await typed.reply(
      t('request.state', { номер: updated.number, состояние: statusTitle(updated.status, false, t) }) +
        `${rating > 0 ? t('request.rating', { оценка: rating }) : ''}.`,
      menuButton(typed, t),
    );
  } catch (error) {
    await explain(typed, error);
  }
};

/** Выбранный счётчик: бот спрашивает показание именно по нему. */
const meter: Button = async (kit, typed, [meterId]) => {
  if (!meterId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);
  const state = (await metersFor(kit.deps, resident)).find((item) => item.meter.id === meterId);

  if (!state) return stale(typed, kit);

  expect(typed, { kind: 'reading', meterId });

  await typed.reply(readingPrompt(state, t), readingKeyboard(meterId, false, t));
};

/** Прибор пропускают: бот переходит к следующему, за который ещё не подали. */
const meterSkip: Button = async (kit, typed, [meterId]) => {
  if (!meterId) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  try {
    const meters = await metersFor(kit.deps, resident);
    const now = kit.deps.now();
    const pending = meters.filter(
      (state) =>
        !state.submittedThisMonth &&
        verificationState(state.meter, now) !== 'expired' &&
        state.meter.id !== meterId,
    );

    const next = pending[0];

    if (!next) {
      forget(typed);

      await typed.reply(t('meters.no_others'), kit.menuKeyboard(resident));
      return;
    }

    expect(typed, { kind: 'reading', meterId: next.meter.id });

    await typed.reply(readingPrompt(next, t), readingKeyboard(next.meter.id, pending.length > 1, t));
  } catch (error) {
    await explain(typed, error);
  }
};

/** Переход, которому нужна причина: её спрашивают одним сообщением. */
const ask: Button = async (kit, typed, [requestId, to]) => {
  if (!requestId || !to) return stale(typed, kit);

  const t = speak(await kit.residentOf(typed));

  typed.session ??= {};
  expect(typed, { kind: 'comment', requestId, to });

  await typed.reply(t(COMMENT_PROMPTS[to] ?? 'comment.other'), cancelKeyboard(t));
};

/** Перевод заявки в другое состояние прямо из сообщения. */
/**
 * Дело, названное словами и подтверждённое кнопкой. Слова человека уходят
 * отчётом о работе или причиной перехода: писать то же самое второй раз
 * ради формы незачем.
 */
const doIt: Button = async (kit, typed, [token, requestId]) => {
  if (!token || !requestId) return stale(typed, kit);

  const said = typed.session?.doing;
  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  // Предложение одноразовое: второе нажатие по той же кнопке дело не повторяет,
  // а слова из нового предложения в старую заявку не уходят.
  if (!said || said.token !== token) {
    await typed.reply(t('doing.gone'), menuButton(typed, t));

    return;
  }

  delete typed.session?.doing;

  try {
    const updated = await transitionRequest(kit.deps, {
      resident,
      requestId,
      to: said.to as never,
      comment: said.comment,
    });

    await typed.reply(
      `${t('request.state', { номер: strong(updated.number), состояние: statusTitle(updated.status, false, t) })}.` +
        (said.comment ? `\n${t('doing.written', { что: plain(said.comment) })}` : ''),
      actionKeyboard(
        actionsFor(updated, resident),
        replyIfOpen(updated),
        assignable(updated, resident.role),
        undefined,
        t,
      ),
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === 'assignee_required') {
      await offerAssignees(kit, typed, requestId, resident);
      return;
    }

    await explain(typed, error);
  }
};

const move: Button = async (kit, typed, [requestId, to, step]) => {
  if (!requestId || !to) return stale(typed, kit);

  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  // Работу принимают с оценкой: спросить её здесь дешевле, чем потом
  // собирать по жильцам, а смене видно, чем закончился наряд.
  if (to === 'confirmed' && resident.role === 'resident') {
    await typed.reply(t('request.rate_ask'), rateKeyboard(requestId, t));
    return;
  }

  // Отзыв возврата не имеет, а кнопка стоит рядом с «Назад»: нужен ответ.
  if (to === 'withdrawn' && step !== 'yes') {
    const request = await getRequestFor(kit.deps, resident, requestId).catch(() => undefined);

    await typed.reply(
      t('request.withdraw_ask', { номер: request ? ` ${request.number}` : '' }),
      confirmKeyboard(t('button.withdraw_yes'), `req:${requestId}:withdrawn:yes`, t),
    );

    return;
  }

  try {
    const updated = await transitionRequest(kit.deps, { resident, requestId, to: to as never });

    await typed.reply(
      t('request.state', { номер: updated.number, состояние: statusTitle(updated.status, false, t) }),
      actionKeyboard(
        actionsFor(updated, resident),
        replyIfOpen(updated),
        assignable(updated, resident.role),
        undefined,
        t,
      ),
    );
  } catch (error) {
    // Наряд в работу уходит с мастером: вместо отказа сразу спрашиваем, кому поручить.
    if (error instanceof DomainError && error.code === 'assignee_required') {
      await offerAssignees(kit, typed, requestId, await kit.residentOf(typed));
      return;
    }

    await explain(typed, error);
  }
};

/** Кнопка по её имени. Имена те же, что стоят в `callback`. */
/** Согласие с документами: дальше разговор идёт обычным порядком. */
const legal: Button = async (kit, typed, [step]) => {
  if (step !== 'accept') return stale(typed, kit);

  await takeLegal(kit, typed);
};

export const BUTTONS: Record<string, Button> = {
  app,
  meter,
  mydata,
  rate,
  legal,
  lang: language,
  menu,
  group,
  cast,
  cancel,
  anyway,
  vote: ballot,
  flat,
  bind,
  sign,
  pay: payMonth,
  'pay-debt': payDebt,
  door,
  camera,
  guest,
  same: alarmAnswer(true),
  fine: alarmAnswer(false),
  support,
  say,
  ticket,
  more,
  'meter-skip': meterSkip,
  'meter-read': meterRead,
  ask,
  req: move,
  assign,
  gzhi: complaint,
  mute: notice(false),
  unmute: notice(true),
  demo,
  visit,
  'visit-cancel': visitCancel,
  where,
  pass,
  'pass-to': passTo,
  handoff: handoffAnswer,
  leave,
  forget: forgetMe,
  talk,
  starter,
  do: doIt,
};
