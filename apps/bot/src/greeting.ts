import {
  actionsFor,
  describeContext,
  languageChosen,
  legalAccepted,
  listRequestsFor,
  needsApartment,
  objectPassport,
  rememberHouseFromObject,
  type BindResult,
  type Building,
  type ContextDescription,
  type Resident,
} from '@domovoy/app';
import {
  DomainError,
  describeTarget,
  formatDate,
  isCompanyStaff,
  provesPresence,
  reportersCount,
  statusTitle,
  type Role,
} from '@domovoy/domain';
import type { Translate } from '@domovoy/i18n';

import { askApartment } from './apartment.js';
import { speak } from './i18n.js';
import {
  actionKeyboard,
  bindIfApartment,
  cancelKeyboard,
  errorText,
  ownerKeyboard,
  replyIfOpen,
} from './keyboards.js';
import { askLanguage } from './language.js';
import { expect, inChat, strong, type BotContext } from './max.js';
import { askLegal } from './commands/legal.js';
import type { BotKit } from './kit.js';

/** Что бот умеет в общем чате дома. */
export const chatHelp = (building?: Building): string =>
  (building
    ? `Чат дома ${building.address || building.code}.\n`
    : 'Чат к дому пока не привязан: /here от управляющего.\n') +
  'Напишите мне в чате «@Домовой» и что случилось, оформлю заявку и отвечу сроком.\n' +
  'Ответом на сообщение соседа оформлю по нему.\n' +
  'Так же словами спросите про объявления, собрания и работу компании: отвечу здесь.\n' +
  'Квитанция, счётчики, домофон и ваши заявки доступны в личной переписке: они видны только вам.';

/** Код из ссылки привязал квартиру. */
const bound = async (kit: BotKit, typed: BotContext, payload: string): Promise<boolean> => {
  const resident = await kit.residentOf(typed);
  let flat: BindResult | null;

  try {
    flat = await bindIfApartment(kit.deps, resident, payload);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;

    // Код квартиры не подошёл или их было слишком много: причина важнее меню.
    await typed.reply(errorText(error, speak(resident)), kit.menuKeyboard(resident));

    return true;
  }

  if (!flat) return false;

  await sayBound(kit, typed, flat);

  return true;
};

/** Ответ на удачную привязку: что теперь доступно. */
export const sayBound = async (kit: BotKit, typed: BotContext, flat: BindResult): Promise<void> => {
  const resident = await kit.residentOf(typed);
  const t = speak(resident);

  // Привязали здесь же, в переписке: прежнюю просьбу о коде убирать уже не нужно.
  if (resident.maxUserId !== undefined) kit.codeAsks.delete(resident.maxUserId);

  await typed.reply(
    flat.alreadyBound
      ? t('flat.already', { номер: flat.apartment.number })
      : t('flat.bound', { номер: flat.apartment.number }),
    kit.menuKeyboard(resident),
  );

  // Собственник или проживающий: спрашивается один раз, сразу после привязки.
  // От ответа зависит голос на собрании, и позже об этом никто не вспомнит.
  if (!flat.alreadyBound) await typed.reply(t('flat.owner_ask'), ownerKeyboard(t));

  await continueWithObject(kit, typed, flat);
};

/**
 * Объект с наклейки, отложенный до привязки: разговор о нём продолжается, если
 * он в доме квартиры. Код чужого дома заявку не открывает.
 */
const continueWithObject = async (kit: BotKit, typed: BotContext, flat: BindResult): Promise<void> => {
  const payload = typed.session?.afterBind;

  if (!payload) return;

  delete typed.session?.afterBind;

  const resident = await kit.residentOf(typed);
  const described = await describeContext(kit.deps, payload, speak(resident), resident);

  if (!described) return;

  if (described.buildingId !== flat.apartment.buildingId) {
    await typed.reply(speak(resident)('sticker.other_house'));
    return;
  }

  await askAboutObject(kit, typed, payload, described, resident);
};

/**
 * Наряд мастера по этому объекту: тот же код с наклейки, что жильцу открывает
 * заявку, мастеру подтверждает выезд. Без этого он заводил бы вторую заявку.
 */
const ownOrder = async (kit: BotKit, typed: BotContext, payload: string, resident: Resident): Promise<boolean> => {
  if (resident.role !== 'technician' && resident.role !== 'contractor') return false;

  const mine = (await listRequestsFor(kit.deps, resident, 'mine')).find(
    (request) => request.assigneeId === resident.id && provesPresence(request.target, payload),
  );

  if (!mine) return false;

  typed.session ??= {};
  typed.session.proved = { requestId: mine.id, code: payload };

  await typed.reply(
    `Вы на месте: ${describeTarget(mine.target)}.\nНаряд ${mine.number}: ${mine.title}.`,
    actionKeyboard(actionsFor(mine, resident), replyIfOpen(mine)),
  );

  return true;
};

/** Код с наклейки: бот ждёт описания того, что с объектом не так. */
const aboutObject = async (kit: BotKit, typed: BotContext, payload: string): Promise<boolean> => {
  // Наклейка называет дом. До привязки квартиры продукт не знал, где человек
  // живёт, и не показывал ему ни объявлений, ни контактов: скан это отвечает.
  const resident = await rememberHouseFromObject(kit.deps, await kit.residentOf(typed), payload);
  const described = await describeContext(kit.deps, payload, speak(resident), resident);

  if (!described) return false;

  // Жилец без квартиры: объект запоминается, а разговор начинается с документов и кода.
  if (needsApartment(resident)) {
    typed.session ??= {};
    typed.session.afterBind = payload;

    if (legalAccepted(resident)) await askApartment(kit, typed, resident);
    else await askLegal(kit, typed);

    return true;
  }

  if (await ownOrder(kit, typed, payload, resident)) return true;

  await askAboutObject(kit, typed, payload, described, resident);

  return true;
};

/** Паспорт объекта и вопрос о том, что с ним случилось. */
const askAboutObject = async (
  kit: BotKit,
  typed: BotContext,
  payload: string,
  described: ContextDescription,
  resident: Resident,
): Promise<void> => {
  expect(typed, { kind: 'description', target: payload });

  const t = speak(resident);
  const passport = await objectPassport(kit.deps, payload, resident);
  const open = passport?.open[0];

  const known = open
    ? `\n${t('object.known', { номер: open.number, состояние: statusTitle(open.status, false, t) })}` +
      `${reportersCount(open) > 1 ? ` ${t('object.reporters', { сколько: reportersCount(open) })}` : ''}` +
      `\n${t('object.same')}`
    : '';

  const repaired =
    passport?.lastRepairAt && !open
      ? `\n${t('object.repaired', { дата: formatDate(passport.lastRepairAt, undefined, t) })}`
      : '';

  await typed.reply(
    t('object.ask', { имя: resident.displayName, объект: described.target }) +
      known +
      repaired +
      `\n${t('object.describe')}`,
    cancelKeyboard(t),
  );
};

/**
 * Начало разговора. Первым делом язык: человек, который не читает по-русски,
 * иначе упирается в приветствие, которого не понимает. Код из ссылки ждёт
 * выбора и разбирается сразу после него.
 */
export const greet = async (kit: BotKit, typed: BotContext, payload?: string | null): Promise<void> => {
  typed.session ??= {};

  if (inChat(typed)) {
    await typed.reply(kit.chatHelp(await kit.houseOf(typed)), kit.openApp(undefined, typed));
    return;
  }

  const person = await kit.residentOf(typed);

  if (!languageChosen(person)) {
    typed.session.afterLang = payload ?? '';

    await askLanguage(typed, person);
    return;
  }

  await welcome(kit, typed, payload);
};

/** Приветствие после выбора языка: код из ссылки, здравствуйте и документы. */
export const welcome = async (kit: BotKit, typed: BotContext, payload?: string | null): Promise<void> => {
  if (payload && ((await bound(kit, typed, payload)) || (await aboutObject(kit, typed, payload)))) return;

  const person = await kit.residentOf(typed);
  const t = speak(person);

  // Код из ссылки мог устареть или быть набран с ошибкой: молчать об этом нельзя.
  const missed = payload ? `${t('start.code_unknown')}\n\n` : '';

  // Жилец без квартиры после согласия видит одно: просьбу о коде.
  if (legalAccepted(person) && needsApartment(person)) {
    await askApartment(kit, typed, person, missed);
    return;
  }

  // Первый разговор начинается с документов, одним сообщением с приветствием:
  // меню до согласия ничего не открывает, оно приходит после «Принимаю».
  if (!legalAccepted(person)) {
    await askLegal(kit, typed, `${missed}${strong(t('greeting.hello'))}`);
    return;
  }

  await typed.reply(`${missed}${hello(person.role, t)}`, kit.menuKeyboard(person));
};

/** Приветствие под роль: жильцу о заявке, смене о работе. */
const hello = (role: Role, t: Translate): string => {
  if (role === 'contractor') {
    return 'Здравствуйте! Здесь порученные вам наряды: суть, адрес и срок.\nВыберите, что нужно.';
  }

  if (isCompanyStaff(role)) {
    return (
      'Здравствуйте! Здесь дела смены: наряды, вопросы жильцов и сводка по дому.\n' +
      'Выберите, что нужно, или опишите обращение жильца одним сообщением.'
    );
  }

  return `${strong(t('greeting.hello'))} ${t('greeting.resident')}`;
};
