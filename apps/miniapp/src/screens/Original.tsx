import { isLanguage, languageTitle } from '@domovoy/i18n';

import { useT } from '../i18n.js';
import type { OriginalTextView } from '../views.js';

/**
 * Исходный текст под переводом. Смена работает по русскому тексту, но видит и
 * то, что человек написал сам: перевод мог потерять деталь.
 */
export const Original = ({ original, staff }: { original?: OriginalTextView; staff?: boolean }) => {
  const t = useT();

  if (!staff || !original) return null;

  const язык = isLanguage(original.language) ? languageTitle(original.language) : original.language;

  return (
    <p className="hint aside original">
      {t('request.original', { язык })}: {original.text}
    </p>
  );
};
