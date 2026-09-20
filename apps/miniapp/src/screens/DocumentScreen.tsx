import { Button, CellAction, CellList } from '@maxhub/max-ui';
import { useState } from 'react';

import { useHaptics } from '../haptics.js';
import { useT } from '../i18n.js';
import { ErrorText } from './ErrorText.js';

export interface DocumentScreenProps {
  text: string;
  onBack: () => void;
}

/** Кладёт текст в буфер обмена: пробуются оба доступных в вебвью способа. */
const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
};

const legacyCopy = (text: string): boolean => {
  const field = document.createElement('textarea');

  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
};

/**
 * Длинный текст отдельным экраном: с него копируют целиком.
 */
export const DocumentScreen = ({ text, onBack }: DocumentScreenProps) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const haptics = useHaptics();

  const copy = async (): Promise<void> => {
    const done = await copyText(text);

    if (done) haptics.done();
    else haptics.failed();

    setCopied(done);
    setFailed(!done);
  };

  return (
    <div className="list">

      <section className="block">
        <pre className="document">{text}</pre>
      </section>

      <div className="actions">
        <Button type="button" stretched size="large" onClick={() => void copy()}>
          {copied ? t('document.copied') : t('document.copy')}
        </Button>
      </div>

      <CellList className="actions-more" mode="island">
        <CellAction mode="secondary" onClick={onBack}>
          {t('app.back')}
        </CellAction>
      </CellList>

      {copied ? (
        <p className="hint aside" role="status">
          {t('document.copied')}
        </p>
      ) : null}

      {failed ? <ErrorText className="aside">{t('document.clipboard.failed')}</ErrorText> : null}
    </div>
  );
};
