import {
  DEFAULT_LANGUAGE,
  fill,
  legalNotesFor,
  legalTextsFor,
  type Language,
  type LegalText,
} from '@domovoy/i18n';

/**
 * Документы, которые продукт показывает до обработки данных. Текст один и тот же
 * в боте, в приложении и на сайте: расхождение между копиями документа хуже, чем
 * его отсутствие. Сами тексты лежат в `@domovoy/i18n` файлом на язык.
 *
 * Обязательна из них политика обработки персональных данных: оператор публикует
 * её и обеспечивает неограниченный доступ (ч. 2 ст. 18.1 Федерального закона
 * от 27.07.2006 № 152-ФЗ). Пользовательское соглашение законом не требуется
 * и описывает правила сервиса.
 */
export type LegalDocument = LegalText;

/**
 * Версия документов. Меняется вместе с текстом: по ней продукт понимает, что
 * согласие получено на прежнюю редакцию и его нужно запросить снова.
 */
export const LEGAL_VERSION = '2026-09-17';

/** Та же редакция словами: её видит человек. */
export const LEGAL_UPDATED = '17 сентября 2026';

/**
 * Дата редакции на языке документа. По-русски она словами, на остальных языках
 * цифрами: русское «17 сентября 2026» посреди армянского или грузинского текста
 * читается как чужая вставка, а название месяца у каждого языка своё.
 */
const updatedOn = (language: Language | undefined): string => {
  if (language === undefined || language === DEFAULT_LANGUAGE) return LEGAL_UPDATED;

  const [year, month, day] = LEGAL_VERSION.split('-');

  return `${day}.${month}.${year}`;
};

/** Документы на языке человека. Без языка и без перевода, по-русски. */
export const legalDocuments = (language?: Language): readonly LegalDocument[] => legalTextsFor(language);

/** Документы по-русски: исходная редакция. */
export const LEGAL_DOCUMENTS: readonly LegalDocument[] = legalDocuments(DEFAULT_LANGUAGE);

/** Документ по имени из адреса. */
export const legalDocument = (slug: string, language?: Language): LegalDocument | undefined =>
  legalDocuments(language).find((document) => document.slug === slug);

/** Подпись редакции на языке документа. */
export const legalUpdated = (language?: Language): string =>
  fill(legalNotesFor(language).updated, { date: updatedOn(language) });

/**
 * Документ сплошным текстом: так он уходит в переписку и в файл. Под переводом
 * стоит оговорка о языке: юридическую силу имеет русская редакция.
 */
export const formatLegal = (document: LegalDocument, language?: Language): string => {
  const translated = language !== undefined && language !== DEFAULT_LANGUAGE;

  return [
    document.title,
    legalUpdated(language),
    ...(translated ? [legalNotesFor(language).prevails] : []),
    '',
    ...document.parts.flatMap((part) => [part.heading, ...part.lines, '']),
  ]
    .join('\n')
    .trim();
};

/** Уведомление перед обработкой данных: его человек видит до первого действия. */
export const LEGAL_NOTICE = [
  'Продукт «Домовой» обрабатывает персональные данные по поручению управляющей организации вашего дома.',
  'Состав данных, основания обработки и порядок их удаления определены политикой обработки персональных данных. Условия использования продукта определены пользовательским соглашением.',
].join('\n');
