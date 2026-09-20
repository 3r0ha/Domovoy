import { CellList, CellSimple } from '@maxhub/max-ui';
import { useLaunchParams } from '@maxkit/react';
import { useState } from 'react';

import { LANGUAGES, languageFrom, translatorFor, type Language } from '@domovoy/i18n';

import { describeFailure, type DomovoyApi } from '../api.js';
import { useTrapped } from '../focus.js';
import { useHaptics } from '../haptics.js';
import { useT } from '../i18n.js';
import { Domovoy } from './Domovoy.js';
import { ErrorText } from './ErrorText.js';
import { IconCheck } from './icons.js';

export interface LanguagePickerProps {
  api: DomovoyApi;
  /** Язык, на котором человек читает сейчас. */
  current?: Language | null;
  onPicked: (language: Language) => void;
}

/** Язык клиента впереди: остальные в порядке списка продукта. */
const ordered = (preferred: Language | undefined): readonly { code: Language; title: string }[] => {
  const all = LANGUAGES.map((language) => ({ code: language.code, title: language.title }));
  const first = all.find((language) => language.code === preferred);

  return first ? [first, ...all.filter((language) => language.code !== preferred)] : all;
};

/** Список языков: выбор уходит на сервер и сразу меняет язык приложения. */
const LanguagePicker = ({ api, current, onPicked }: LanguagePickerProps) => {
  const t = useT();
  const haptics = useHaptics();
  // Язык клиента MAX: человек читает на нём всё остальное, значит с него и начинают.
  const preferred = languageFrom(useLaunchParams().initDataUnsafe.user?.language_code);
  const [busy, setBusy] = useState<Language | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const pick = async (language: Language): Promise<void> => {
    if (busy) return;

    setBusy(language);
    setFailed(null);

    try {
      await api.setLanguage(language);

      haptics.done();
      onPicked(language);
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {failed ? <ErrorText>{failed}</ErrorText> : null}

      <CellList mode="island">
        {ordered(preferred).map((language, index) => (
          <CellSimple
            key={language.code}
            title={language.title}
            aria-current={language.code === current}
            separator={index > 0}
            height="compact"
            after={
              busy === language.code ? (
                <span className="hint">{t('language.saving')}</span>
              ) : language.code === current ? (
                <IconCheck />
              ) : undefined
            }
            onClick={() => void pick(language.code)}
          />
        ))}
      </CellList>
    </>
  );
};

/** Раздел «Язык»: сменить его можно в любой момент. */
export const LanguageScreen = (props: LanguagePickerProps) => (
  <div className="list">
    <LanguagePicker {...props} />
  </div>
);

/**
 * Первый вход: язык спрашивают до документов, иначе их не прочитать. Сам вопрос
 * не переводится: его читает человек, который языка ещё не выбирал.
 */
export const LanguageSheet = (props: LanguagePickerProps) => {
  const sheet = useTrapped<HTMLElement>(true);
  // Клиент MAX присылает язык человека: вопрос задают и на нём тоже.
  const spoken = languageFrom(useLaunchParams().initDataUnsafe.user?.language_code);
  const own = spoken ? translatorFor(spoken)('app.lang.ask') : undefined;
  const third = own && own !== 'Выберите язык' && own !== 'Choose your language' ? own : undefined;

  return (
    <div className="guide" role="dialog" aria-modal="true" aria-label="Выберите язык">
      <div className="guide-veil" aria-hidden="true" />

      <section className="guide-sheet language-sheet" ref={sheet}>
        <Domovoy mood="walking" size={72} />

        <h2 className="guide-title">Выберите язык</h2>
        <p className="guide-hint">Choose your language</p>
        {third ? <p className="guide-hint">{third}</p> : null}

        <div className="language-list">
          <LanguagePicker {...props} />
        </div>
      </section>
    </div>
  );
};
