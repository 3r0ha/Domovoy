import { CATEGORY_RULES, suggestCategory, suggestPriority, type Priority, type RequestCategory } from '@domovoy/domain';

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
  /** Чем определена категория: разбором текста моделью или ключевыми словами. */
  by: 'model' | 'keywords';
}

/** Ответ модели: за границей продукта любое поле может отсутствовать или оказаться мусором. */
export interface ReasonedFields {
  category?: string;
  priority?: string;
  title?: string;
  question?: string;
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
}

/** Ответ модели помощнику: любое поле может отсутствовать. */
export interface AssistFields {
  answer?: string;
  screen?: string;
}

/** Что модель знает, когда спрашивает адрес обращения. */
export interface ClarifyInput {
  description: string;
  /** Подписи настоящих объектов дома: выбирать можно только из них. */
  candidates: string[];
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
}

const TOPICS: readonly QuestionTopic[] = ['works', 'incident', 'bill', 'request', 'unknown'];

const QUESTION_WORDS =
  /^(когда|почему|отчего|зачем|сколько|как(ой|ая|ое|ие)?|где|кто|что с|чего|будет ли|есть ли|можно ли|подскажите|скажите)\b/i;

const TOPIC_WORDS: readonly { topic: QuestionTopic; words: RegExp }[] = [
  { topic: 'incident', words: /авари|прорыв|затопил|потоп/i },
  { topic: 'request', words: /заявк|мастер|наряд|почин|когда придут/i },
  { topic: 'bill', words: /квитанц|оплат|начислен|долг|задолженност|должен|должна|тариф/i },
  { topic: 'works', words: /отключ|плановы|отоплен|лифт|(?<![а-яё])(свет|газ|вод[аыуе])(?![а-яё])/i },
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

  const intent: Intent = read.intent === 'question' ? 'question' : read.intent === 'request' ? 'request' : plain.intent;
  const topic = TOPICS.find((known) => known === read.topic) ?? plain.topic;

  return { intent, topic: intent === 'question' ? topic : 'unknown' };
};

const guessIntent = (text: string): { intent: Intent; topic: QuestionTopic } => {
  const trimmed = text.trim();
  const asks = trimmed.endsWith('?') || QUESTION_WORDS.test(trimmed);

  if (!asks) return { intent: 'request', topic: 'unknown' };

  return { intent: 'question', topic: TOPIC_WORDS.find((rule) => rule.words.test(trimmed))?.topic ?? 'unknown' };
};

const PRIORITIES: readonly string[] = ['planned', 'normal', 'emergency'];

const PLACES: readonly Place[] = ['apartment', 'entrance', 'house'];

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

/** Слишком длинный заголовок от модели не берётся. */
const phrase = (value: string | undefined, limit: number): string | undefined => {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

  return text.length > 0 && text.length <= limit ? text : undefined;
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

  const category =
    read.category && Object.hasOwn(CATEGORY_RULES, read.category)
      ? (read.category as RequestCategory)
      : plain.category;

  const named = read.priority && PRIORITIES.includes(read.priority) ? (read.priority as Priority) : undefined;
  const chosen = named ?? suggestPriority(description, category);
  const offered = phrase(read.title, TITLE_MAX);
  const title = offered && grounded(offered, description) ? offered : undefined;
  const question = phrase(read.question, QUESTION_MAX);

  // Оборудование берётся только из списка дома: выдуманный код приведёт в никуда.
  const equipment = house?.equipment?.find((item) => item.code === read.equipment)?.code;
  const place = PLACES.find((known) => known === read.place);

  return {
    category,
    priority: plain.priority === 'emergency' ? 'emergency' : chosen,
    by: 'model',
    ...(equipment ? { equipment } : {}),
    ...(place ? { place } : {}),
    ...(title ? { title } : {}),
    ...(question ? { question } : {}),
  };
};
