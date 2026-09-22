import { CATEGORY_RULES, suggestCategory, suggestPriority, type Priority, type RequestCategory } from '@domovoy/domain';

import type { Language } from '@domovoy/i18n';

import { fieldBy, fieldCode, fieldFlag, fieldText, sameAs } from './fields.js';

/** Часть дома, о которой написал человек. */
export type Place = 'apartment' | 'entrance' | 'house';

/** Что удалось понять из обращения. Сроков тут нет: их считает регламент по категории. */
export interface Understanding {
  category: RequestCategory;
  priority: Priority;
  /** Оборудование дома, о котором речь: модель выбирает его из списка дома. */
  equipment?: string;
  /** Где случилось: в квартире, в подъезде или во дворе и доме целиком. */
  place?: Place;
  /** Короткая суть для списка. */
  title?: string;
  /** Один вопрос, если из описания не понять, что случилось. */
  question?: string;
  /** Написанного не хватает на заявку: названа вещь или место, а беды нет. */
  unclear?: boolean;
  /** Чем определена категория: разбором текста моделью или ключевыми словами. */
  by: 'model' | 'keywords';
}

/** Ответ модели: за границей продукта любое поле может отсутствовать или оказаться мусором. */
export interface ReasonedFields {
  category?: string;
  priority?: string;
  title?: string;
  question?: string;
  /** Хватает ли написанного на заявку: названа вещь без беды это «нет». */
  enough?: boolean;
  /** Код оборудования дома, о котором речь: из списка, переданного модели. */
  equipment?: string;
  /** Часть дома, о которой речь: apartment, entrance или house. */
  place?: string;
}

/** О чём написал человек: сообщение о поломке или вопрос о доме. */
export type Intent = 'request' | 'question';

/** Темы, на которые продукт отвечает своими данными. */
export type QuestionTopic = 'works' | 'incident' | 'bill' | 'request' | 'unknown';

export interface ReadIntent {
  intent?: string;
  topic?: string;
}

/** Что помощник спрашивает у модели: вопрос человека и то, что о нём известно. */
export interface AssistInput {
  question: string;
  /** Факты о человеке и доме, по которым можно отвечать. */
  facts: string;
  /** Как устроен продукт: правила, которые помощник объясняет словами. */
  knowledge?: string[];
  /** Разделы, доступные этой роли: из них модель выбирает переход. */
  sections: { screen: string; title: string; about: string }[];
  /**
   * На каком языке отвечать. Та же просьба идёт и строкой в `knowledge`:
   * канал к модели о языках знать не обязан.
   */
  language?: Language;
  /**
   * Прошлые реплики разговора, от старых к новым. По ним читается «а если нет?»
   * и «сколько это стоит»: без них второй вопрос подряд теряет смысл.
   */
  history?: { asked: string; said: string }[];
  /**
   * Где человек находится прямо сейчас: экран приложения и, если он что-то
   * начал, незаконченное дело. Без этого помощник отвечает «зайдите в раздел»
   * тому, кто в этом разделе уже стоит.
   */
  where?: { screen: string; title: string; about: string; doing?: string };
}

/** Ответ модели помощнику: любое поле может отсутствовать. */
export interface AssistFields {
  answer?: string;
  screen?: string;
  /** Код языка, на котором задан вопрос: по нему продукт предлагает сменить язык. */
  language?: string;
}

/** Что модель знает, когда спрашивает адрес обращения. */
export interface ClarifyInput {
  description: string;
  /** Подписи настоящих объектов дома: выбирать можно только из них. */
  candidates: string[];
  /** Язык жильца: вопрос читает он сам, поэтому идёт на его языке. */
  language?: Language;
}

/** Уточняющий вопрос от модели: сам вопрос и подписи кнопок. */
export interface ClarifyFields {
  question?: string;
  choices?: string[];
}

/** Порт разбора обращения: в тестах заменяется заглушкой. */
export interface Reasoner {
  understand(description: string, house?: HouseContext): Promise<ReasonedFields | undefined>;
  /** Обращение это или вопрос. Модель может метод не поддерживать. */
  intent?(text: string): Promise<ReadIntent | undefined>;
  /** Пересказ чисел сводки словами. Модель может метод не поддерживать. */
  digest?(facts: string): Promise<string | undefined>;
  /** Помощник по приложению. Модель может метод не поддерживать. */
  assist?(input: AssistInput): Promise<AssistFields | undefined>;
  /**
   * О доме и продукте ли вопрос. Пусто означает «проверить нечем».
   * Роль важна: у смены свой словарь, и «что горит» у неё про сроки заявок.
   */
  onTopic?(question: string, forStaff?: boolean): Promise<boolean | undefined>;
  /**
   * По делу ли сказанное. Пусто означает «проверить нечем»: тогда доверяем
   * человеку. Спрашивается только о коротких ответах вроде «6» и «не знаю».
   */
  meaningful?(input: { asked: string; text: string }): Promise<boolean | undefined>;
  /** Уточняющий вопрос об адресе обращения и варианты кнопками. */
  clarify?(input: ClarifyInput): Promise<ClarifyFields | undefined>;
  /** Поломка это или дело другого раздела. Модель может метод не поддерживать. */
  route?(input: RouteInput): Promise<RouteFields | undefined>;
  /**
   * Дело по открытой заявке: что человек хочет сделать и с какой. Модель только
   * выбирает из переданных списков, поэтому прав она не добавляет.
   */
  doing?(input: DoingInput): Promise<DoingFields | undefined>;
  /**
   * Правка готового текста словами человека: «убери про подъезд», «добавь, что
   * течёт третий день». Модель возвращает текст целиком. Пусто означает, что
   * править нечем и человек правит руками.
   */
  edit?(input: EditInput): Promise<string | undefined>;
  /**
   * Что человек назвал временем: «завтра утром», «в среду после обеда». Модель
   * выбирает из предложенных окон, поэтому новых времён не выдумывает. Пусто
   * означает, что ни одно окно не подошло.
   */
  pickTime?(input: PickTimeInput): Promise<string | undefined>;
}

/** Правка готового текста словами. */
export interface EditInput {
  /** Что правим: обращение в надзор, объявление, письмо. */
  about: string;
  text: string;
  /** Что человек просит изменить. */
  said: string;
}

/** Выбор времени словами из предложенных окон. */
export interface PickTimeInput {
  said: string;
  /** Окна на выбор: ключ для ответа и то, как окно называется человеку. */
  slots: { key: string; title: string }[];
}

/** Что модель знает, когда разбирает дело по заявке. */
export interface DoingInput {
  text: string;
  /** Дела, доступные этому человеку прямо сейчас: из них и выбирается. */
  deeds: { deed: string; about: string }[];
  /** Заявки, с которыми он может что-то сделать: номер, суть и адрес. */
  requests: { number: string; title: string; where: string; status: string }[];
}

/** Что решила модель: любое поле может отсутствовать. */
export interface DoingFields {
  /** Имя дела из переданного списка. */
  deed?: string;
  /** Номер заявки из переданного списка. */
  number?: string;
}

/** Что модель знает, когда решает, куда отнести написанное. */
export interface RouteInput {
  text: string;
  /** Разделы, доступные этой роли: из них модель выбирает, куда это относится. */
  sections: { screen: string; title: string; about: string }[];
}

/** Куда модель относит написанное: любое поле может отсутствовать. */
export interface RouteFields {
  /** breakdown это заявка, elsewhere это другой раздел продукта. */
  kind?: string;
  screen?: string;
}

/** Что модель знает о доме, когда разбирает обращение. */
export interface HouseContext {
  address?: string;
  /** Оборудование с наклейками: лифты, домофоны, узлы учёта. */
  equipment?: { code: string; title: string }[];
  /** Подъезды дома. */
  entrances?: number[];
  /** Квартира обратившегося, если она известна. */
  apartment?: number;
  /** Язык жильца: на нём пишется уточняющий вопрос, который читает он сам. */
  language?: Language;
}

const TOPICS: readonly QuestionTopic[] = ['works', 'incident', 'bill', 'request', 'unknown'];

const QUESTION_WORDS =
  /^(когда|почему|отчего|зачем|сколько|как(ой|ая|ое|ие)?|где|кто|что с|чего|будет ли|есть ли|можно ли|подскажите|скажите)(?!\p{L})/iu;

const TOPIC_WORDS: readonly { topic: QuestionTopic; words: RegExp }[] = [
  { topic: 'incident', words: /авари|прорыв|затопил|потоп/i },
  { topic: 'request', words: /заявк|мастер|наряд|почин|когда придут/i },
  { topic: 'bill', words: /квитанц|оплат|начислен|долг|задолженност|должен|должна|тариф/i },
  { topic: 'works', words: /отключ|плановы|отоплен|лифт|(?<![а-яё])(свет|газ|вод[аыуе])(?![а-яё])/i },
];

/** Намерение чужими словами: модель отвечает то ключом, то переводом ключа. */
const INTENT_WORDS: readonly { value: Intent; words: RegExp }[] = [
  { value: 'question', words: /question|вопрос|спрашива/u },
  { value: 'request', words: /request|заявк|поломк|обращени|просьб/u },
];

/** То же для темы вопроса: ответ «начисления» значит bill. */
const TOPIC_SAID: readonly { value: QuestionTopic; words: RegExp }[] = [
  { value: 'incident', words: /incident|авари|прорыв/u },
  { value: 'bill', words: /bill|квитанц|начислен|оплат|долг/u },
  { value: 'request', words: /request|заявк|наряд/u },
  { value: 'works', words: /works|работ|отключ/u },
  { value: 'unknown', words: /unknown|друг|неизвестн/u },
];

/** Вопрос это или сообщение о поломке. Без модели разбор идёт по ключевым словам. */
export const classifyIntent = async (
  text: string,
  reasoner?: Reasoner,
): Promise<{ intent: Intent; topic: QuestionTopic }> => {
  const plain = guessIntent(text);

  if (!reasoner?.intent) return plain;

  const read = await reasoner.intent(text).catch(() => undefined);

  if (!read) return plain;

  const said = fieldCode(read.intent);
  const named: Intent | undefined = said === 'question' || said === 'request' ? said : fieldBy(read.intent, INTENT_WORDS);
  const intent = named ?? plain.intent;

  const code = fieldCode(read.topic);
  const topic = TOPICS.find((known) => known === code) ?? fieldBy(read.topic, TOPIC_SAID) ?? plain.topic;

  return { intent, topic: intent === 'question' ? topic : 'unknown' };
};

/**
 * Правка готового текста словами. Пусто означает, что править нечем: тогда
 * человек правит руками, а продукт не делает вид, что понял.
 */
export const editByWords = async (
  reasoner: Reasoner | undefined,
  input: EditInput,
): Promise<string | undefined> => {
  if (!reasoner?.edit) return undefined;

  const said = fieldText(await reasoner.edit(input).catch(() => undefined));

  // Ответ короче трети исходного это не правка, а потеря текста: письмо
  // в орган власти так отправлять нельзя.
  return said && said.length >= input.text.length / 3 ? said : undefined;
};

/**
 * Время, названное словами: «завтра утром», «в среду после обеда». Выбор идёт
 * из предложенных окон, поэтому новых времён модель не выдумывает.
 */
export const pickTimeByWords = async (
  reasoner: Reasoner | undefined,
  input: PickTimeInput,
): Promise<string | undefined> => {
  if (!reasoner?.pickTime || input.slots.length === 0) return undefined;

  const said = fieldCode(await reasoner.pickTime(input).catch(() => undefined));

  return input.slots.find((slot) => slot.key === said)?.key;
};

const guessIntent = (text: string): { intent: Intent; topic: QuestionTopic } => {
  const trimmed = text.trim();
  const asks = trimmed.endsWith('?') || QUESTION_WORDS.test(trimmed);

  if (!asks) return { intent: 'request', topic: 'unknown' };

  return { intent: 'question', topic: TOPIC_WORDS.find((rule) => rule.words.test(trimmed))?.topic ?? 'unknown' };
};

const PRIORITIES: readonly string[] = ['planned', 'normal', 'emergency'];

const PLACES: readonly Place[] = ['apartment', 'entrance', 'house'];

/** Срочность чужими словами: «аварийная», «urgent», «высокий». */
const PRIORITY_SAID: readonly { value: Priority; words: RegExp }[] = [
  { value: 'emergency', words: /emergency|urgent|critical|high|авари|срочн|высок/u },
  { value: 'planned', words: /planned|low|планов|низк/u },
  { value: 'normal', words: /normal|medium|обычн|средн/u },
];

/** Часть дома чужими словами: «квартира», «flat», «подъезд». */
const PLACE_SAID: readonly { value: Place; words: RegExp }[] = [
  { value: 'apartment', words: /apartment|flat|кварти|жиль/u },
  { value: 'entrance', words: /entrance|подъезд|лестниц|площадк|тамбур/u },
  { value: 'house', words: /house|building|yard|дом|двор|подвал|крыш/u },
];

const TITLE_MAX = 80;
const QUESTION_MAX = 120;

/** Значимые слова строки без окончаний: по ним заголовок сверяется с обращением. */
const significant = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).map((word) => word.slice(0, 4));

/** Числа строки: этажи и подъезды модель дописывает охотнее всего. */
const numbers = (text: string): string[] => text.match(/\d+/g) ?? [];

/** Сколько незнакомых слов допускается в заголовке: одно на пересказ своими словами. */
const FREE_WORDS = 1;

/**
 * Заголовок держится обращения: модель любит дописывать этажи, подъезды и причины,
 * которых человек не называл. Пересказ своими словами допустим, выдумка нет.
 */
const grounded = (title: string, description: string): boolean => {
  const known = new Set(significant(description));
  const said = new Set(numbers(description));
  const unknown = significant(title).filter((word) => !known.has(word));

  return unknown.length <= FREE_WORDS && numbers(title).every((digits) => said.has(digits));
};

/** Слишком длинный заголовок от модели не берётся, разметка из него снимается. */
const phrase = (value: unknown, limit: number): string | undefined => {
  const text = fieldText(value)?.replace(/\s+/gu, ' ') ?? '';

  return text.length > 0 && text.length <= limit ? text : undefined;
};

/**
 * Код оборудования из ответа модели. Кроме кода она дописывает название,
 * поэтому сверяется и всё значение целиком, и его начало до знака.
 */
const equipmentOf = (value: unknown, house: HouseContext | undefined): string | undefined => {
  const marked = sameAs(value);

  if (!marked || !house?.equipment?.length) return undefined;

  return house.equipment.find((item) => {
    const code = item.code.toLowerCase();

    return marked === code || marked.startsWith(`${code} `) || marked.startsWith(`${code},`);
  })?.code;
};

export const understandRequest = async (
  description: string,
  reasoner?: Reasoner,
  house?: HouseContext,
): Promise<Understanding> => {
  const guessed = suggestCategory(description);
  const plain: Understanding = { category: guessed, priority: suggestPriority(description, guessed), by: 'keywords' };

  if (!reasoner) return plain;

  const read = await reasoner.understand(description, house).catch(() => undefined);

  if (!read) return plain;

  const said = fieldCode(read.category);
  const category = said && Object.hasOwn(CATEGORY_RULES, said) ? (said as RequestCategory) : plain.category;

  const code = fieldCode(read.priority);
  const named = code && PRIORITIES.includes(code) ? (code as Priority) : fieldBy(read.priority, PRIORITY_SAID);
  const chosen = named ?? suggestPriority(description, category);
  const offered = phrase(read.title, TITLE_MAX);
  const title = offered && grounded(offered, description) ? offered : undefined;
  const question = phrase(read.question, QUESTION_MAX);

  // Оборудование берётся только из списка дома: выдуманный код приведёт в никуда.
  const equipment = equipmentOf(read.equipment, house);

  const where = fieldCode(read.place);
  const place = PLACES.find((known) => known === where) ?? fieldBy(read.place, PLACE_SAID);

  // Названа вещь без беды: «труба», «лифт». Заявку по такому не заводят, пока
  // человек не скажет, что случилось, иначе мастер едет в никуда.
  const unclear = fieldFlag(read.enough) === false && question !== undefined;

  return {
    category,
    priority: plain.priority === 'emergency' ? 'emergency' : chosen,
    by: 'model',
    ...(equipment ? { equipment } : {}),
    ...(place ? { place } : {}),
    ...(title ? { title } : {}),
    ...(question ? { question } : {}),
    ...(unclear ? { unclear } : {}),
  };
};
