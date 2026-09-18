import {
  actionsFor,
  answerAlert,
  apartmentsOf,
  arrearsFor,
  chargesForResident,
  exportPersonalData,
  formatPersonalData,
  homeOf,
  personalDataSummary,
  roleTitle,
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
  sendSnapshot,
  submitProblem,
  supportInitiative,
  supportRequest,
  transitionRequest,
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
  months,
  verificationState,
  plural,
  STATUS_TITLES,
  type NoticeKind,
} from '@domovoy/domain';

import {
  actionKeyboard,
  afterError,
  assignable,
  errorAction,
  assignKeyboard,
  cancelKeyboard,
  COMMENT_PROMPTS,
  confirmKeyboard,
  copyKeyboard,
  errorText,
  flatTitle,
  formatInitiative,
  guestKeyboard,
  handoffKeyboard,
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
import { inApp } from './commands/in-app.js';
import { takeLegal } from './commands/legal.js';
import { freeHours } from './commands/visits.js';
import { groupFor, groupKeyboard, groupWith, itemFor } from './menu.js';
import { showNews, showSupport } from './pages.js';
import { expect, forget, inChat, morphing, pressedMid, toast, type BotContext } from './max.js';
import type { Resident } from '@domovoy/app';
import type { BotKit, Extra } from './kit.js';

/** Нажатие кнопки: имя действия и его данные приходят одной строкой через двоеточие. */
export type Button = (kit: BotKit, typed: BotContext, args: string[]) => Promise<void>;

/** Отказ правил объясняется словами, всё остальное поднимается выше. */
const explain = async (typed: BotContext, error: unknown, prefix = 'Не получилось'): Promise<void> => {
  if (!(error instanceof DomainError)) throw error;

  const fix = errorAction(error);

  // Отказ на нажатие показывается уведомлением: исправлять его кнопкой обычно нечем.
  if (!fix && typed.callback?.callback_id) {
    await toast(typed, `${prefix}: ${error.message}`);
    return;
  }

  await typed.reply(`${prefix}: ${errorText(error)}`, fix ?? menuButton(typed));
};

/** Кнопка из старого сообщения: в ней нет того, чем она была. */
const stale = (typed: BotContext): Promise<void> => toast(typed, 'Кнопка устарела, откройте меню');

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
  if (!name) return stale(typed);

  const resident = await kit.residentOf(typed);
  const item = itemFor(resident, name, { doors: Boolean(kit.deps.hub) });

  if (!item?.app) return stale(typed);

  await inApp(kit, typed, `${item.title}\n${item.app.about}`, item.app.screen);
};

/**
 * Кнопка меню повторяет команду. Заодно запоминается, откуда пришли: из группы
 * или с первого экрана. По этому отмена и возвращает туда же, а не в меню.
 */
const menu: Button = async (kit, typed, [name]) => {
  if (!name) {
    await toast(typed, 'Этого раздела больше нет');
    return;
  }

  const resident = await kit.residentOf(typed);
  const where = groupWith(resident, name, { doors: Boolean(kit.deps.hub) });

  typed.session ??= {};

  if (where) typed.session.menu = where;
  else delete typed.session.menu;

  if (await kit.run(name, typed)) return;

  await toast(typed, 'Этого раздела больше нет');
};

/** Группа меню: её пункты показываются вторым экраном, с возвратом назад. */
const group: Button = async (kit, typed, [key]) => {
  if (inChat(typed)) {
    await typed.reply(
      'Меню открывается в переписке со мной: там ответы видны только вам.',
      kit.openApp(undefined, typed),
    );
    return;
  }

  const resident = await kit.residentOf(typed);

  if (!key || key === 'back') {
    typed.session ??= {};
    delete typed.session.menu;

    await typed.reply(await menuTitle(kit, resident), kit.menuKeyboard(resident));
    return;
  }

  const chosen = groupFor(resident, key, { doors: Boolean(kit.deps.hub) });

  if (!chosen) return stale(typed);

  // Группа запоминается: отмена начатого возвращает туда, откуда его начали.
  typed.session ??= {};
  typed.session.menu = chosen.key;

  await typed.reply(chosen.title, groupKeyboard(chosen));
};

/**
 * Первый экран: кто я, чей это дом и чья квартира. Без этого человек видит
 * набор кнопок и не понимает, куда попал и за какой адрес отвечает бот.
 */
export const menuTitle = async (kit: BotKit, resident: Resident): Promise<string> => {
  const home = await homeOf(kit.deps, resident).catch(() => undefined);
  const building = home ? await kit.deps.repository.findBuilding(home) : undefined;
  const apartment = resident.apartmentId
    ? await kit.deps.repository.findApartment(resident.apartmentId).catch(() => undefined)
    : undefined;

  const where = [building?.address, apartment ? `кв. ${apartment.number}` : '']
    .filter(Boolean)
    .join(', ');

  const who = resident.role === 'resident' ? '' : roleTitle(resident.role);

  return [
    `Домовой${where ? `: ${where}` : ''}${who ? ` · ${who}` : ''}`,
    'Что нужно сделать? Можно просто написать словами.',
  ].join('\n');
};

/** Экран, с которого человек ушёл в разговор: группа меню либо первый экран. */
const backTo = async (kit: BotKit, typed: BotContext): Promise<{ title: string; extra: Extra | undefined }> => {
  const resident = await kit.residentOf(typed);
  const key = typed.session?.menu;
  const chosen = key ? groupFor(resident, key, { doors: Boolean(kit.deps.hub) }) : undefined;

  if (!chosen) return { title: await menuTitle(kit, resident), extra: kit.menuKeyboard(resident) };

  return { title: chosen.title, extra: groupKeyboard(chosen) };
};

/**
 * Отказ от начатого разговора: ожидание снимается, ничего не создаётся.
 * Экран разговора переписывается на месте, а чек заявки или код гостя нет:
 * их правкой стирать нельзя, поэтому возврат приходит отдельным сообщением.
 */
const cancel: Button = async (kit, typed) => {
  forget(typed);

  if (inChat(typed)) {
    await toast(typed, 'Отменил');
    return;
  }

  const back = await backTo(kit, typed);
  const here = pressedMid(typed);
  const onScreen = here !== undefined && here === typed.session?.screen;

  await (onScreen ? morphing(typed) : typed).reply(back.title, back.extra);
};

/** «Всё равно оставить заявку»: обращение, на которое ответили работами или советом. */
const anyway: Button = async (kit, typed) => {
  const description = typed.session?.plannedDescription;

  if (!description) {
    expect(typed, { kind: 'description' });

    await typed.reply('Не помню, о чём было обращение. Напишите ещё раз, что случилось.', cancelKeyboard());
    return;
  }

  const startParam = typed.session?.plannedTarget;
  const author = await kit.residentOf(typed);

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
  if (!pollId || !choice) return stale(typed);

  const voter = await kit.residentOf(typed);

  try {
    const view = await vote(kit.deps, { resident: voter, pollId, choice: choice as never });
    const publicly = inChat(typed);

    await typed.reply(
      formatPollResult(view, { personal: !publicly }),
      view.open ? pollKeyboard(view.poll.id) : undefined,
    );

    if (publicly && voter.maxUserId !== undefined) {
      await kit.bot.api
        .sendMessageToUser(
          voter.maxUserId,
          `Собрание «${view.poll.title}». Голос квартиры: ${choiceTitle(choice as never).toLowerCase()}.`,
        )
        .catch(() => undefined);
    }
  } catch (error) {
    await explain(typed, error, 'Голос не принят');
  }
};

/** Выбор своей квартиры: по ней идут показания и квитанция. */
const flat: Button = async (kit, typed, [apartmentId]) => {
  if (!apartmentId) return stale(typed);

  const resident = await kit.residentOf(typed);

  try {
    const saved = await useApartment(kit.deps, resident, apartmentId);
    const apartment = (await listOwnApartments(kit.deps, saved)).find((item) => item.current);

    await toast(typed, apartment ? `Показания и квитанция: ${flatTitle(apartment)}` : 'Квартира выбрана');
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    await typed.reply(errorText(error), afterError(error, typed));
  }
};

/** Подпись под предложением соседа. */
const sign: Button = async (kit, typed, [initiativeId]) => {
  if (!initiativeId) return stale(typed);

  const signer = await kit.residentOf(typed);

  try {
    await typed.reply(
      formatInitiative(await supportInitiative(kit.deps, { resident: signer, initiativeId })),
      menuButton(typed),
    );
  } catch (error) {
    await explain(typed, error, 'Подпись не принята');
  }
};

/**
 * Деньги списываются без возврата, поэтому сумма называется до нажатия.
 * Первое нажатие показывает, за что и сколько, второе платит.
 */
const payMonth: Button = async (kit, typed, [step]) => {
  const payer = await kit.residentOf(typed);

  if (step !== 'yes') {
    const charges = await chargesForResident(kit.deps, payer);
    const left = Math.max(0, charges.total - charges.paid);

    await typed.reply(
      `Оплатить за месяц ${formatMoney(left)}?`,
      confirmKeyboard(`💳 Да, оплатить ${formatMoney(left)}`, 'pay:yes'),
    );
    return;
  }

  try {
    const receipt = await payCharges(kit.deps, payer);

    await typed.reply(
      `Оплачено ${formatMoney(receipt.amount)}. Квитанция придёт в приложение.`,
      menuButton(typed),
    );
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    await typed.reply(errorText(error), afterError(error, typed));
  }
};

const payDebt: Button = async (kit, typed, [step]) => {
  const payer = await kit.residentOf(typed);

  if (step !== 'yes') {
    const debt = await arrearsFor(kit.deps, payer);
    const total = debt.total + debt.penalty;

    await typed.reply(
      `Погасить долг за прошлые месяцы ${formatMoney(total)}?`,
      confirmKeyboard(`💰 Да, погасить ${formatMoney(total)}`, 'pay-debt:yes'),
    );
    return;
  }

  try {
    const receipts = await payArrears(kit.deps, payer);
    const total = receipts.reduce((sum, receipt) => sum + receipt.amount, 0);

    await typed.reply(`Долг погашен: ${formatMoney(total)} за ${months(receipts.length)}.`, menuButton(typed));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    await typed.reply(errorText(error), afterError(error, typed));
  }
};

const door: Button = async (kit, typed, [deviceId]) => {
  if (!deviceId) return stale(typed);

  const resident = await kit.residentOf(typed);

  try {
    const device = await openDevice(kit.deps, resident, deviceId);

    await typed.reply(`${device.title}: открыто.`, guestKeyboard(device.id));
  } catch (error) {
    await explain(typed, error);
  }
};

/** Кадр с камеры приходит прямо в переписку: это проверка, а не работа с экраном. */
const camera: Button = async (kit, typed, [deviceId]) => {
  if (!deviceId) return stale(typed);

  const resident = await kit.residentOf(typed);

  try {
    const sent = await sendSnapshot(kit.deps, resident, deviceId);

    await toast(typed, `${sent.title}: кадр отправлен`);
  } catch (error) {
    await explain(typed, error, 'Кадр не пришёл');
  }
};

const guest: Button = async (kit, typed, [deviceId]) => {
  if (!deviceId) return stale(typed);

  const resident = await kit.residentOf(typed);

  try {
    const issued = await inviteGuest(kit.deps, resident, deviceId);

    await typed.reply(
      `Код для гостя: ${issued.code}\nДействует до ${formatClock(issued.expiresAt)}.`,
      copyKeyboard('Скопировать код', issued.code),
    );
  } catch (error) {
    await explain(typed, error);
  }
};

/** Ответ соседа на вопрос об аварии: «у меня то же самое» или «у меня работает». */
const alarmAnswer =
  (affected: boolean): Button =>
  async (kit, typed, [requestId]) => {
    if (!requestId) return stale(typed);

    const neighbour = await kit.residentOf(typed);

    try {
      const { request: updated, counted } = await answerAlert(kit.deps, {
        resident: neighbour,
        requestId,
        affected,
      });

      if (!counted) {
        await toast(typed, `Вы уже отвечали по заявке ${updated.number}`);
        return;
      }

      if (!affected) {
        await toast(typed, 'Спасибо, это важно: значит, причина не в общем стояке');
        return;
      }

      await typed.reply(
        `Записал: у вас то же самое. Заявка ${updated.number}, об изменениях сообщу.`,
        actionKeyboard([], replyIfOpen(updated)),
      );
    } catch (error) {
      await explain(typed, error);
    }
  };

/** «И у меня»: жилец присоединяется к заявке соседа. */
const support: Button = async (kit, typed, [requestId]) => {
  if (!requestId) return stale(typed);

  try {
    const { request: updated, reporters } = await supportRequest(
      kit.deps,
      await kit.residentOf(typed),
      requestId,
    );

    await typed.reply(
      `Записал: у вас то же самое. Заявка ${updated.number}, ` +
        `${plural(reporters, 'сообщил', 'сообщили', 'сообщили')}, об изменениях сообщу.`,
      actionKeyboard([], replyIfOpen(updated)),
    );
  } catch (error) {
    await explain(typed, error);
  }
};

/** «Ответить» под обращением в поддержку: следующее сообщение уходит в него. */
const ticket: Button = async (kit, typed, [ticketId]) => {
  if (!ticketId) return stale(typed);

  const resident = await kit.residentOf(typed);

  typed.session ??= {};
  expect(typed, { kind: 'support', ticketId });

  await typed.reply(
    isCompanyStaff(resident.role)
      ? 'Напишите ответ жильцу одним сообщением.'
      : 'Напишите сообщение по этому обращению.',
    cancelKeyboard(),
  );
};

/** Ответ на уточняющий вопрос: нажатая кнопка ставит заявке настоящий адрес. */
const where: Button = async (kit, typed, [requestId, index]) => {
  const asked = typed.session?.where;
  const option = requestId && asked?.requestId === requestId ? asked.options[Number(index)] : undefined;

  if (!requestId || !option) return stale(typed);

  const resident = await kit.residentOf(typed);

  try {
    const updated = await retargetRequest(kit.deps, { resident, requestId, startParam: option.startParam });

    delete typed.session?.where;

    await typed.reply(
      `Записал: ${describeTarget(updated.target)}. Заявка ${updated.number} уже у смены.`,
      actionKeyboard(actionsFor(updated, resident), replyIfOpen(updated)),
    );
  } catch (error) {
    await explain(typed, error, 'Адрес не уточнили');
  }
};

/** «Передать»: смена выбирает организацию из заведённых в доме. */
const pass: Button = async (kit, typed, [requestId]) => {
  if (!requestId) return stale(typed);

  const resident = await kit.residentOf(typed);

  if (!isCompanyStaff(resident.role)) {
    await toast(typed, 'Передаёт обращение управляющая организация');
    return;
  }

  const request = await getRequestFor(kit.deps, resident, requestId);

  if (!request) return stale(typed);

  const view = await responsibilityOf(kit.deps, request);

  if (view.targets.length === 0) {
    await typed.reply(
      'В карточке дома нет смежных организаций. Их заводит управляющий в разделе «Дом».',
      menuButton(typed),
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
  if (!requestId || !to || !isHandoffTarget(to)) return stale(typed);

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
const handoffAnswer: Button = async (_kit, typed, [handoffId]) => {
  if (!handoffId) return stale(typed);

  typed.session ??= {};
  expect(typed, { kind: 'handoff', handoffId });

  await typed.reply('Что ответила организация? Напишите одним сообщением.', cancelKeyboard());
};

/** Час приёма выбран: остаётся спросить, с чем человек придёт. */
const visit: Button = async (kit, typed, parts) => {
  const at = parts.join(':');

  if (!at) return stale(typed);

  const resident = await kit.residentOf(typed);

  try {
    // Пока сообщение висело в переписке, час мог занять сосед: тему спрашивать поздно.
    const { hours } = await freeHours(kit, resident);

    if (!hours.some((hour) => hour.at === at)) {
      await typed.reply(
        hours.length === 0 ? 'Этот час заняли, свободных пока нет.' : 'Этот час заняли. Выберите другой.',
        hours.length === 0 ? menuButton(typed) : visitKeyboard(hours),
      );
      return;
    }
  } catch (error) {
    await explain(typed, error, 'Запись не открылась');
    return;
  }

  expect(typed, { kind: 'visit', at });

  await typed.reply('С чем придёте? Напишите одной строкой.', cancelKeyboard());
};

/** Отмена своей записи на приём. */
const visitCancel: Button = async (kit, typed, [visitId]) => {
  if (!visitId) return stale(typed);

  const resident = await kit.residentOf(typed);

  try {
    await dropVisit(kit.deps, resident, visitId);
    await typed.reply('Запись на приём отменена.', kit.menuKeyboard(resident));
  } catch (error) {
    await explain(typed, error, 'Запись не отменилась');
  }
};

/** «Написать по заявке»: следующее сообщение уходит в переписку по ней. */
const say: Button = async (_kit, typed, [requestId]) => {
  if (!requestId) return stale(typed);

  typed.session ??= {};
  expect(typed, { kind: 'message', requestId });

  await typed.reply('Напишите ответ одним сообщением, передам по этой заявке.', cancelKeyboard());
};

/** Готовое обращение в жилинспекцию по конкретной заявке. */
const complaint: Button = async (kit, typed, [requestId]) => {
  if (!requestId) return stale(typed);

  const resident = await kit.residentOf(typed);

  try {
    const offer = await escalationFor(kit.deps, resident, requestId);

    if (!offer.possible || !offer.complaint) {
      await typed.reply('По этой заявке оснований для обращения нет.', menuButton(typed));
      return;
    }

    await typed.reply(`Основание: ${offer.reason}.\nПроверьте текст и отправьте в жилищную инспекцию.`);
    await typed.reply(offer.complaint, menuButton(typed));
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
    await typed.reply('Некому поручить: в доме нет мастеров.', menuButton(typed));
    return;
  }

  await typed.reply('Кому поручить? Рядом с именем, сколько нарядов уже на человеке.', assignKeyboard(requestId, staff));
};

/** Кому поручить наряд: список смены с загрузкой, выбор одним нажатием. */
const assign: Button = async (kit, typed, [requestId, staffId]) => {
  if (!requestId) return stale(typed);

  const resident = await kit.residentOf(typed);

  try {
    if (!staffId) {
      await offerAssignees(kit, typed, requestId, resident);
      return;
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
    if (!kind) return stale(typed);

    const resident = await kit.residentOf(typed);

    try {
      const list = await setNotice(kit.deps, resident, kind as NoticeKind, on);
      const changed = list.find((item) => item.kind === kind);

      await typed.reply(
        on
          ? `Снова буду присылать: ${changed?.title.toLowerCase() ?? 'такие уведомления'}.`
          : `Больше не пришлю: ${changed?.title.toLowerCase() ?? 'такие уведомления'}. Об авариях и своих заявках сообщу всё равно.`,
        oneKeyboard(on ? '🔕 Уведомления' : '🔔 Уведомления', `${on ? 'mute' : 'unmute'}:${kind}`),
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

  if (!page) return stale(typed);

  await page(kit, typed, Number.isFinite(offset) ? offset : 0);
};

/** Отвязка квартиры: сначала вопрос, потом действие. */
const leave: Button = async (kit, typed, [step]) => {
  const resident = await kit.residentOf(typed);
  const own = apartmentsOf(resident);

  if (own.length === 0) {
    await toast(typed, 'Квартира и так не привязана');
    return;
  }

  if (step !== 'yes') {
    await typed.reply(
      'Отвязать квартиру? Заявки и показания останутся у дома, привязать снова можно кодом из квитанции.',
      confirmKeyboard('🚪 Да, отвязать', 'leave:yes'),
    );
    return;
  }

  try {
    const unbound = await unbindApartment(kit.deps, resident, resident.id);

    await toast(typed, 'Квартира отвязана');
    await typed.reply(
      'Квартира отвязана. Привязать снова можно кодом из квитанции.',
      kit.menuKeyboard(unbound),
    );
  } catch (error) {
    await explain(typed, error);
  }
};

/** Удаление профиля: имя стирается, квартира отвязывается, дела дома остаются. */
const forgetMe: Button = async (kit, typed, [step]) => {
  const resident = await kit.residentOf(typed);

  if (step !== 'yes') {
    await typed.reply(
      'Удалить профиль? Имя сотрётся, квартира отвяжется, уведомления перестанут приходить. ' +
        'Заявки, показания и голоса останутся у дома обезличенными.',
      confirmKeyboard('🗑 Да, удалить', 'forget:yes'),
    );
    return;
  }

  try {
    await forgetResident(kit.deps, resident);

    await typed.reply(
      'Профиль удалён. Если понадоблюсь снова, просто напишите мне: заведу новый.',
      menuButton(typed),
    );
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
  if (what !== 'file') return stale(typed);

  const resident = await kit.residentOf(typed);
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
            text: `Ваши данные файлом. ${personalDataSummary(data)}`,
          })
          .catch(() => undefined)
      : undefined;

  if (!sent) await typed.reply(text, menuButton(typed));
};

/** Оценка при приёмке: ноль означает «принять без оценки». */
const rate: Button = async (kit, typed, [requestId, stars]) => {
  if (!requestId || stars === undefined) return stale(typed);

  const resident = await kit.residentOf(typed);
  const rating = Number(stars);

  try {
    const updated = await transitionRequest(kit.deps, {
      resident,
      requestId,
      to: 'confirmed',
      ...(rating > 0 ? { rating } : {}),
    });

    await typed.reply(
      `Заявка ${updated.number}: ${STATUS_TITLES[updated.status]}${rating > 0 ? `, ваша оценка ${rating}` : ''}.`,
      menuButton(typed),
    );
  } catch (error) {
    await explain(typed, error);
  }
};

/** Выбранный счётчик: бот спрашивает показание именно по нему. */
const meter: Button = async (kit, typed, [meterId]) => {
  if (!meterId) return stale(typed);

  const resident = await kit.residentOf(typed);
  const state = (await metersFor(kit.deps, resident)).find((item) => item.meter.id === meterId);

  if (!state) return stale(typed);

  expect(typed, { kind: 'reading', meterId });

  await typed.reply(readingPrompt(state), readingKeyboard(meterId, false));
};

/** Прибор пропускают: бот переходит к следующему, за который ещё не подали. */
const meterSkip: Button = async (kit, typed, [meterId]) => {
  if (!meterId) return stale(typed);

  const resident = await kit.residentOf(typed);

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

      await typed.reply('Других приборов без показаний нет.', kit.menuKeyboard(resident));
      return;
    }

    expect(typed, { kind: 'reading', meterId: next.meter.id });

    await typed.reply(readingPrompt(next), readingKeyboard(next.meter.id, pending.length > 1));
  } catch (error) {
    await explain(typed, error);
  }
};

/** Переход, которому нужна причина: её спрашивают одним сообщением. */
const ask: Button = async (_kit, typed, [requestId, to]) => {
  if (!requestId || !to) return stale(typed);

  typed.session ??= {};
  expect(typed, { kind: 'comment', requestId, to });

  await typed.reply(COMMENT_PROMPTS[to] ?? 'Опишите причину одним сообщением.', cancelKeyboard());
};

/** Перевод заявки в другое состояние прямо из сообщения. */
const move: Button = async (kit, typed, [requestId, to]) => {
  if (!requestId || !to) {
    await toast(typed, 'Кнопка устарела, откройте заявку');
    return;
  }

  const resident = await kit.residentOf(typed);

  // Работу принимают с оценкой: спросить её здесь дешевле, чем потом
  // собирать по жильцам, а смене видно, чем закончился наряд.
  if (to === 'confirmed' && resident.role === 'resident') {
    await typed.reply('Как приняли работу?', rateKeyboard(requestId));
    return;
  }

  try {
    const updated = await transitionRequest(kit.deps, { resident, requestId, to: to as never });

    await typed.reply(
      `Заявка ${updated.number}: ${STATUS_TITLES[updated.status]}`,
      actionKeyboard(actionsFor(updated, resident), replyIfOpen(updated), assignable(updated, resident.role)),
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
  if (step !== 'accept') return stale(typed);

  await takeLegal(kit, typed);
};

export const BUTTONS: Record<string, Button> = {
  app,
  meter,
  mydata,
  rate,
  legal,
  menu,
  group,
  cast,
  cancel,
  anyway,
  vote: ballot,
  flat,
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
};
