import { knowsHouse, needsApartment, type Resident } from '@domovoy/app';

import { speak } from './i18n.js';
import { APARTMENT_CODE_LENGTH, isApartmentCode, normalizeApartmentCode } from '@domovoy/domain';

import { expect, type BotContext } from './max.js';
import type { BotKit } from './kit.js';

/**
 * Сообщение состоит из одного кода и ничего больше. Без этой проверки кодом
 * оказывалось любое сообщение с восемью знаками: «хвс 99999999» отвечало
 * отказом в привязке вместо показания.
 */
const codeAlone = (text: string): boolean =>
  new RegExp(`^[a-z0-9]{${APARTMENT_CODE_LENGTH}}$`, 'iu').test(text.trim().replace(/[\s-]/gu, ''));

/**
 * Код в сообщении: один или внутри фразы, «код квартиры ACEFHK34», «мой код
 * PRTM4837». Из фразы берётся только слово, которое целиком проходит проверку
 * кода: восемь знаков его алфавита. Сообщение из одного кода отдаётся как
 * есть, чтобы ошибку в знаке объяснили, а не промолчали.
 */
export const codeIn = (text: string): string | undefined => {
  if (codeAlone(text)) return text;

  return text.split(/[^\p{L}\p{N}-]+/u).find((word) => isApartmentCode(normalizeApartmentCode(word)));
};

/** Просьба о коде квартиры: до привязки бот отвечает ею на всё. */
export const askApartment = async (
  kit: BotKit,
  typed: BotContext,
  resident?: Resident,
  prefix = '',
): Promise<void> => {
  const person = resident ?? (await kit.residentOf(typed));

  expect(typed, { kind: 'code' });

  await typed.reply(`${prefix}${speak(person)('flat.ask')}`, kit.menuKeyboard(person));
};

/**
 * Нужна ли сначала квартира: жильцу без неё продукт закрыт, и вместо дела он
 * получает просьбу о коде. Сам код проходит: набранный отдельно, внутри фразы
 * или в ответ на уже заданный вопрос о нём.
 */
export const needsFlat = async (
  kit: BotKit,
  typed: BotContext,
  text?: string,
  houseIsEnough = false,
): Promise<boolean> => {
  const resident = await kit.residentOf(typed);

  if (!needsApartment(resident)) return false;

  // Объявления и контакты принадлежат дому: человеку, назвавшему дом сканом
  // наклейки, они открыты и без квартиры.
  if (houseIsEnough && knowsHouse(resident)) return false;

  if (text && (typed.session?.awaiting?.kind === 'code' || codeIn(text) !== undefined)) return false;

  await askApartment(kit, typed, resident);

  return true;
};
