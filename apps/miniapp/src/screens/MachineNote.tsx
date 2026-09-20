import type { Translate } from '@domovoy/i18n';

import { useT } from '../i18n.js';

/**
 * Пометка о машинном переводе. Текст написан другим человеком и переведён
 * службой: человек должен знать, что читает не то, что было написано.
 */
export const MachineNote = ({ shown }: { shown?: boolean }) => {
  const t = useT();

  if (!shown) return null;

  return <p className="hint aside machine-note">{t('translation.machine')}</p>;
};

/** Та же пометка в строке списка, где отдельному абзацу места нет. */
export const noted = (t: Translate, machine?: boolean): string =>
  machine ? ` · ${t('translation.machine')}` : '';
