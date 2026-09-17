import { describeContext, legalAccepted, objectPassport, type BindResult, type Building } from '@domovoy/app';
import { DomainError, STATUS_TITLES, formatDate, isCompanyStaff, reportersCount, type Role } from '@domovoy/domain';
import { fmt } from '@maxkit/max-bot-api';

import { bindIfApartment, cancelKeyboard } from './keyboards.js';
import { expect, inChat, type BotContext } from './max.js';
import { askLegal } from './commands/legal.js';
import type { BotKit } from './kit.js';

/** Что бот умеет в общем чате дома. */
export const chatHelp = (building?: Building): string =>
  (building
    ? `Чат дома ${building.address || building.code}.\n`
    : 'Чат к дому пока не привязан: /here от управляющего.\n') +
  'Напишите мне в чате «@Домовой» и что случилось, оформлю заявку и отвечу сроком.\n' +
  'Ответом на сообщение соседа оформлю по нему.\n' +
  'Здесь же: /news объявления, /vote собрания, /neighbours о чём уже сообщили, /house как работает компания.\n' +
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
    await typed.reply(error.message, kit.menuKeyboard(resident));

    return true;
  }

  if (!flat) return false;

  await sayBound(kit, typed, flat);

  return true;
};

/** Ответ на удачную привязку: что теперь доступно. */
export const sayBound = async (kit: BotKit, typed: BotContext, flat: BindResult): Promise<void> => {
  await typed.reply(
    flat.alreadyBound
      ? `Вы уже привязаны к квартире ${flat.apartment.number}.`
      : `Готово: вы привязаны к квартире ${flat.apartment.number}.\n` +
        'Теперь можно подавать показания счётчиков (/meters), голосовать на собраниях (/vote)\n' +
        'и оформлять заявки без сканирования кода.',
    kit.openApp(undefined, typed),
  );
};

/** Код с наклейки: бот ждёт описания того, что с объектом не так. */
const aboutObject = async (kit: BotKit, typed: BotContext, payload: string): Promise<boolean> => {
  const described = await describeContext(kit.deps, payload);

  if (!described) return false;

  const resident = await kit.residentOf(typed);

  expect(typed, { kind: 'description', target: payload });

  const passport = await objectPassport(kit.deps, payload, resident);
  const open = passport?.open[0];

  const known = open
    ? `\nОб этом уже сообщили: заявка ${fmt.bold(open.number)}, ` +
      `${STATUS_TITLES[open.status]}.` +
      `${reportersCount(open) > 1 ? ` Обращений: ${reportersCount(open)}.` : ''}` +
      '\nЕсли проблема та же, просто опишите её, я добавлю вас к этой заявке.'
    : '';

  const repaired = passport?.lastRepairAt && !open ? `\nПоследний ремонт: ${formatDate(passport.lastRepairAt)}` : '';

  await typed.reply(
    `${resident.displayName}, вы обратились по объекту: ${described.target}.` +
      known +
      repaired +
      '\nОпишите одним сообщением, что случилось, и заявку оформлю сам.',
    cancelKeyboard(),
  );

  return true;
};

/** Начало разговора: с кодом объекта сразу к делу, без него короткое меню. */
export const greet = async (kit: BotKit, typed: BotContext, payload?: string | null): Promise<void> => {
  typed.session ??= {};

  if (inChat(typed)) {
    await typed.reply(kit.chatHelp(await kit.houseOf(typed)), kit.openApp(undefined, typed));
    return;
  }

  if (payload && ((await bound(kit, typed, payload)) || (await aboutObject(kit, typed, payload)))) return;

  const person = await kit.residentOf(typed);

  // Код из ссылки мог устареть или быть набран с ошибкой: молчать об этом нельзя.
  const missed = payload ? 'Код из ссылки не подошёл: такого объекта в доме нет.\n\n' : '';

  await typed.reply(`${missed}${hello(person.role)}`, kit.menuKeyboard(person));

  // Первый разговор начинается с документов: дальше продукт сохраняет данные.
  if (!legalAccepted(person)) await askLegal(kit, typed);
};

/** Приветствие под роль: жильцу о заявке, смене о работе. */
const hello = (role: Role): string => {
  if (role === 'contractor') {
    return 'Здравствуйте! Здесь порученные вам наряды: суть, адрес и срок.\nВыберите, что нужно.';
  }

  if (isCompanyStaff(role)) {
    return (
      'Здравствуйте! Здесь дела смены: наряды, вопросы жильцов и сводка по дому.\n' +
      'Выберите, что нужно, или опишите обращение жильца одним сообщением.'
    );
  }

  return (
    'Здравствуйте! Здесь можно оставить заявку в управляющую компанию и следить за её выполнением.\n' +
    'Опишите одним сообщением, что случилось, или выберите, что нужно.'
  );
};
