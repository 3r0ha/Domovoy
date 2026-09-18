import { partsIn } from './reception.js';
import { computeDeadlines, CATEGORY_RULES, type NormLimit } from './sla.js';
import {
  DEFAULT_TIME_ZONE,
  DomainError,
  type Attachment,
  type Priority,
  type RequestCategory,
  type RequestTarget,
  type ServiceRequest,
} from './types.js';

export interface CreateRequestInput {
  id: string;
  buildingId: string;
  /** Короткий код дома для номера заявки, например «Д15». */
  buildingCode: string;
  /** Порядковый номер заявки в доме за текущий месяц. */
  sequence: number;
  authorId: string;
  category: RequestCategory;
  target: RequestTarget;
  description: string;
  /** Короткая суть. Если не задана, делается из описания. */
  title?: string;
  priority?: Priority;
  createdAt: Date;
  attachments?: Attachment[];
  /** Часовой пояс дома: по нему в номере заявки считаются год и месяц. */
  timeZone?: string;
}

/** Докуда обращение читается человеком: дальше это документ, а не заявка. */
export const MAX_DESCRIPTION_LENGTH = 2000;

/** Длина заголовка. */
export const MAX_TITLE_LENGTH = 60;

/** Заголовок из описания. */
export const summarizeDescription = (description: string): string => {
  const text = description.replace(/\s+/g, ' ').trim();
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  const candidate = sentence.replace(/[.!]+$/, '');

  if (candidate.length <= MAX_TITLE_LENGTH) return candidate;

  const cut = candidate.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');

  return `${(lastSpace > MAX_TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

/**
 * Номер заявки: код дома, год и месяц, порядковый номер. Месяц берётся по
 * календарю дома: заявка от первого числа 00:30 по местному времени иначе
 * получила бы номер прошлого месяца.
 */
export const formatRequestNumber = (
  buildingCode: string,
  sequence: number,
  createdAt: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): string => {
  const local = partsIn(createdAt, timeZone);
  const year = String(local.year).slice(-2);
  const month = String(local.month).padStart(2, '0');

  return `${buildingCode}-${year}${month}-${String(sequence).padStart(4, '0')}`;
};

/** Номер заявки в тексте: «Д15-2609-0007». Код дома задаёт компания, поэтому он любой. */
const REQUEST_NUMBER = /^\s*([^\s]+-\d{4}-\d{4})\s*$/;

/** Сообщение целиком это номер заявки: человек спрашивает о ней, а не заводит новую. */
export const requestNumberIn = (text: string): string | null => REQUEST_NUMBER.exec(text)?.[1] ?? null;

/** Засор внутридомовой системы водоотведения или мусоропровода: у него свой срок. */
const BLOCKAGE = /засор|забил|забит|не уходит вода|стоит вода|мусоропровод/i;

export const isBlockage = (text: string): boolean => BLOCKAGE.test(text);

/** Какая норма ограничивает срок заявки сверху. */
export const normLimitFor = (description: string, priority: Priority): NormLimit | undefined => {
  if (isBlockage(description)) return 'blockage';

  return priority === 'emergency' ? 'emergency' : undefined;
};

/** Создаёт заявку: сроки, номер и первое событие истории. @throws {DomainError} */
export const createRequest = (input: CreateRequestInput): ServiceRequest => {
  const description = input.description.trim();

  if (description.length === 0) {
    throw new DomainError('description_required', 'Опишите, что случилось');
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new DomainError(
      'description_too_long',
      `Описание длиннее ${MAX_DESCRIPTION_LENGTH} знаков, напишите короче`,
    );
  }

  const priority = input.priority ?? CATEGORY_RULES[input.category].defaultPriority;
  const { reactionDueAt, resolutionDueAt } = computeDeadlines(
    input.category,
    priority,
    input.createdAt,
    normLimitFor(description, priority),
  );

  return {
    id: input.id,
    number: formatRequestNumber(input.buildingCode, input.sequence, input.createdAt, input.timeZone),
    buildingId: input.buildingId,
    authorId: input.authorId,
    category: input.category,
    priority,
    target: input.target,
    title: input.title?.trim() || summarizeDescription(description),
    description,
    status: 'new',
    createdAt: input.createdAt,
    reactionDueAt,
    resolutionDueAt,
    history: [{ at: input.createdAt, status: 'new', role: 'resident', actorId: input.authorId }],
    joinedBy: [],
    notAffected: [],
    attachments: input.attachments ?? [],
    reopenCount: 0,
  };
};

interface CategoryHint {
  category: RequestCategory;
  /** Слова в нижнем регистре; сравнение идёт по вхождению подстроки. */
  keywords: readonly string[];
  /** Слова, отменяющие подсказку. */
  except?: readonly string[];
}

/** Подсказки категории по тексту. */
const HINTS: readonly CategoryHint[] = [
  { category: 'safety', keywords: ['дым', 'гарь', 'пожар', 'горит про', 'запах газа', 'газом'] },
  { category: 'elevator', keywords: ['лифт', 'застрял', 'кабина'] },
  {
    category: 'document',
    keywords: ['справк', 'выписк', 'документ', 'копи', 'акт сверки', 'лицевой счёт', 'лицевой счет'],
  },
  {
    category: 'plumbing',
    keywords: ['вода', 'воды', 'теч', 'кран', 'труб', 'канализац', 'засор', 'затоп', 'смесител'],
    except: ['трубк', 'домофон'],
  },
  { category: 'heating', keywords: ['отоплен', 'батаре', 'холодно', 'радиатор', 'тепло'] },
  {
    category: 'electricity',
    keywords: ['свет', 'электрич', 'розетк', 'проводк', 'ламп', 'освещен', 'не горит', 'щиток', 'выключател'],
  },
  { category: 'cleaning', keywords: ['убор', 'мусор', 'грязн', 'подмет', 'мыть'] },
  {
    category: 'yard',
    keywords: [
      'двор',
      'детск',
      'площадк',
      'газон',
      'парков',
      'снег',
      'гололёд',
      'гололед',
      'дорог',
      'тротуар',
      'проезд',
      'асфальт',
      'яма',
      'люк',
      'урна',
      'скамейк',
      'лавочк',
      'шлагбаум',
      'контейнерн',
      'остановк',
    ],
    except: ['этаж', 'подъезд', 'лестни'],
  },
];

export const suggestCategory = (text: string): RequestCategory => {
  const normalized = text.toLowerCase();

  for (const hint of HINTS) {
    if (hint.except?.some((word) => normalized.includes(word))) continue;
    if (hint.keywords.some((keyword) => normalized.includes(keyword))) return hint.category;
  }

  return 'other';
};

/** Слова, которые однозначно означают аварию. */
const EMERGENCY_KEYWORDS = ['залив', 'затоп', 'прорыв', 'застрял', 'дым', 'искр', 'запах газа', 'без отопления'];

export const suggestPriority = (text: string, category: RequestCategory): Priority => {
  const normalized = text.toLowerCase();

  if (EMERGENCY_KEYWORDS.some((keyword) => normalized.includes(keyword))) return 'emergency';

  return CATEGORY_RULES[category].defaultPriority;
};
