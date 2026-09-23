import { useEffect } from 'react';

import { useTrapped } from '../focus.js';
import { useT } from '../i18n.js';
import { ErrorText } from './ErrorText.js';

export interface ConfirmProps {
  /** О чём спрашивают: «Отправить рассылку?». */
  title: string;
  /** Что случится после согласия. */
  text?: string;
  /** Подпись согласия: словами о самом действии, а не «Да». */
  confirmLabel: string;
  busy?: boolean;
  /** Что написано на кнопке, пока действие идёт. */
  busyLabel?: string;
  /** Действие необратимо: согласие красное. */
  danger?: boolean;
  /** Отказ сервера. Окно остаётся открытым, и под затемнением текст страницы не виден. */
  error?: string | null;
  /** Поле, без которого соглашаться нечем: причина отказа или вопрос жильцу. */
  field?: {
    value: string;
    placeholder: string;
    label: string;
    /** Сколько строк ждут в ответ. Имя и номер это одна, причина отказа три. */
    rows?: number;
    onChange: (value: string) => void;
  };
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Окно согласия: действие, которое нельзя отменить, спрашивают отдельно,
 * а не вторым нажатием той же кнопки. Второе нажатие незаметно, а окно
 * говорит, что именно сейчас произойдёт.
 */
export const Confirm = ({
  title,
  text,
  confirmLabel,
  busy,
  busyLabel,
  danger,
  error,
  field,
  onConfirm,
  onCancel,
}: ConfirmProps) => {
  const sheet = useTrapped<HTMLElement>(true);
  const t = useT();

  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };

    globalThis.addEventListener('keydown', close);

    return () => globalThis.removeEventListener('keydown', close);
  }, [onCancel]);

  const ready = busy !== true && (!field || field.value.trim().length > 0);

  return (
    <div className="guide" role="dialog" aria-modal="true" aria-label={title}>
      {/* Отказ от действия называется отдельно: рядом с «Отменить запись»
          кнопка «Отмена» читается тем же самым. */}
      <button type="button" className="guide-veil" aria-label={t('request.keep')} onClick={onCancel} />

      <section className="guide-sheet confirm" ref={sheet}>
        <h2 className="guide-title">{title}</h2>
        {text ? <p className="guide-hint">{text}</p> : null}

        {field ? (
          <textarea
            className="confirm-field"
            aria-label={field.label}
            rows={field.rows ?? 3}
            autoFocus
            maxLength={2000}
            value={field.value}
            placeholder={field.placeholder}
            onChange={(event) => field.onChange(event.target.value)}
          />
        ) : null}

        {error ? <ErrorText className="confirm-error">{error}</ErrorText> : null}

        <div className="confirm-keys">
          <button
            type="button"
            className={danger ? 'confirm-do confirm-danger' : 'confirm-do'}
            disabled={!ready}
            onClick={onConfirm}
          >
            {busy ? (busyLabel ?? t('request.sending')) : confirmLabel}
          </button>

          <button type="button" className="inline-btn" disabled={busy} onClick={onCancel}>
            {t('request.keep')}
          </button>
        </div>
      </section>
    </div>
  );
};
