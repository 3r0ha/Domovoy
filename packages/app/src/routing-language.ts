import { DEFAULT_LANGUAGE } from '@domovoy/i18n';

import { languageOf } from './language.js';
import { textFingerprint, TRANSLATION_TIMEOUT_MS } from './machine-translation.js';
import type { Resident } from './repository.js';
import { isRussianText } from './translation.js';
import type { AppDeps } from './use-cases.js';

const HAS_LETTER = /\p{L}/u;

const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const limit = new Promise<undefined>((done) => {
    timer = setTimeout(() => done(undefined), ms);
  });

  try {
    return await Promise.race([work.catch(() => undefined), limit]);
  } finally {
    clearTimeout(timer);
  }
};

/** Перевод одной строки: сначала машинная служба, потом модель. */
const said = async (deps: AppDeps, text: string, from: string): Promise<string | undefined> => {
  const language = from as Parameters<NonNullable<AppDeps['machine']>['translate']>[2];

  if (deps.machine) {
    const [byService] = (await withTimeout(
      deps.machine.translate([text], DEFAULT_LANGUAGE, language),
      TRANSLATION_TIMEOUT_MS,
    )) ?? [undefined];

    if (byService?.trim()) return byService.trim();
  }

  const byModel = await withTimeout(
    deps.translate?.translate(text, DEFAULT_LANGUAGE, language) ?? Promise.resolve(undefined),
    TRANSLATION_TIMEOUT_MS,
  );

  return byModel?.trim() || undefined;
};

/**
 * Написанное жильцом по-русски: по русскому тексту продукт узнаёт свои дела.
 * Разбор просьбы, подбор категории и слова о готовой работе написаны по-русски,
 * и без этого шага «I want to open the door» становится заявкой о поломке.
 * Перевод запоминается вместе с остальными: ту же фразу переводить дважды незачем.
 */
export const forRouting = async (deps: AppDeps, resident: Resident, text: string): Promise<string> => {
  const language = languageOf(resident);
  const trimmed = text.trim();

  if (language === DEFAULT_LANGUAGE || !HAS_LETTER.test(trimmed) || isRussianText(trimmed)) return text;

  const fingerprint = textFingerprint(trimmed);
  const [known] = await deps.repository.listTranslations([fingerprint], DEFAULT_LANGUAGE).catch(() => []);

  if (known?.text) return known.text;
  if (known) return text;

  const russian = await said(deps, trimmed, language);

  await deps.repository
    .saveTranslations([
      { fingerprint, language: DEFAULT_LANGUAGE, ...(russian ? { text: russian } : {}), at: deps.now() },
    ])
    .catch(() => undefined);

  return russian ?? text;
};
