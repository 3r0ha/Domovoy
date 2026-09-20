import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '../languages.js';
import { az, azNotes } from './az.js';
import { en, enNotes } from './en.js';
import { hy, hyNotes } from './hy.js';
import { ka, kaNotes } from './ka.js';
import { kk, kkNotes } from './kk.js';
import { ky, kyNotes } from './ky.js';
import { ro, roNotes } from './ro.js';
import { ru, ruNotes } from './ru.js';
import { tg, tgNotes } from './tg.js';
import { tk, tkNotes } from './tk.js';
import { tt, ttNotes } from './tt.js';
import { uz, uzNotes } from './uz.js';
import { zh, zhNotes } from './zh.js';
import type { LegalNotes, LegalText } from './text.js';

/**
 * Тексты документов по языкам. Русский обязателен: он исходный и запасной.
 * Перевод добавляется файлом `<код>.ts` и строкой здесь, после чего язык сам
 * появляется на сайте и в ссылках продукта.
 */
export const LEGAL_TEXTS: Readonly<Partial<Record<Language, LegalText[]>>> & { ru: LegalText[] } = {
  ru,
  en,
  tt,
  uz,
  tg,
  ky,
  kk,
  az,
  hy,
  tk,
  ka,
  ro,
  zh,
};

/** Подписи вокруг документа. Без перевода берутся русские. */
export const LEGAL_NOTES: Readonly<Partial<Record<Language, LegalNotes>>> & { ru: LegalNotes } = {
  ru: ruNotes,
  en: enNotes,
  tt: ttNotes,
  uz: uzNotes,
  tg: tgNotes,
  ky: kyNotes,
  kk: kkNotes,
  az: azNotes,
  hy: hyNotes,
  tk: tkNotes,
  ka: kaNotes,
  ro: roNotes,
  zh: zhNotes,
};

/** Языки, на которых документы есть. Порядок общий с перечнем языков продукта. */
export const legalLanguages = (): Language[] =>
  LANGUAGES.map((language) => language.code).filter((code) => LEGAL_TEXTS[code] !== undefined);

/** Язык, на котором документ будет показан: без перевода это русский. */
export const legalLanguage = (language: Language | undefined): Language =>
  language && LEGAL_TEXTS[language] ? language : DEFAULT_LANGUAGE;

/** Документы на языке человека. Нет перевода, отдаётся русский. */
export const legalTextsFor = (language: Language | undefined): LegalText[] =>
  (language ? LEGAL_TEXTS[language] : undefined) ?? LEGAL_TEXTS.ru;

/** Подписи на языке человека. */
export const legalNotesFor = (language: Language | undefined): LegalNotes =>
  (language ? LEGAL_NOTES[language] : undefined) ?? LEGAL_NOTES.ru;

export type { LegalNotes, LegalText } from './text.js';
