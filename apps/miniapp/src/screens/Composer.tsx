import { useClosingConfirmation } from '@maxkit/react';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

import type { PhotoUpload } from '../use-photos.js';
import { ErrorText } from './ErrorText.js';
import { IconCamera, IconSend } from './icons.js';

export interface ComposerProps {
  value: string;
  /** Что написано в пустом поле. */
  placeholder: string;
  /** Подпись поля для голосового помощника. */
  label: string;
  /** Идентификатор поля: на экране их может быть несколько. */
  id: string;
  busy?: boolean;
  photos: PhotoUpload;
  /** Что ещё стоит в строке рядом с камерой: например, чтение кода наклейки. */
  extra?: ReactNode;
  /** Одного снимка мало: без слов не отправить. */
  requireText?: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}

/** Докуда растёт поле, дальше оно прокручивается. */
const MAX_HEIGHT = 120;

/** Поле растёт под текст, пока не упрётся в потолок. */
const fit = (node: HTMLTextAreaElement | null): void => {
  if (!node) return;

  node.style.height = 'auto';
  node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
};

/**
 * Высота поля держится за текстом, а не за последним нажатием клавиши: после
 * отправки строка сжимается обратно, хотя набранное убрал сам продукт.
 */
export const useFit = (value: string): RefObject<HTMLTextAreaElement | null> => {
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fit(field.current);
  }, [value]);

  return field;
};

/** Строка ответа: поле во всю ширину, кнопки внутри него, как в переписке. */
export const Composer = ({
  value,
  placeholder,
  label,
  id,
  busy,
  photos,
  extra,
  requireText,
  onChange,
  onSend,
}: ComposerProps) => {
  const pick = useId();
  const field = useFit(value);

  // Закрытие с непустым полем клиент MAX переспросит.
  useClosingConfirmation(value.trim().length > 0);
  const written = value.trim().length > 0;
  const empty = requireText ? !written : !written && photos.photos.length === 0;
  const ready = !empty && busy !== true && !photos.uploading;

  return (
    <div className="composer">
      {photos.error ? <ErrorText className="composer-error">{photos.error}</ErrorText> : null}

      <label
        className={photos.uploading ? 'composer-icon composer-busy' : 'composer-icon'}
        htmlFor={pick}
        title="Приложить фото"
        aria-label="Приложить фото"
      >
        <IconCamera />
        {photos.photos.length > 0 ? <span className="photo-count">{photos.photos.length}</span> : null}
      </label>

      <input id={pick} className="composer-file" type="file" accept="image/*" onChange={photos.attach} />

      {extra}

      <textarea
        ref={field}
        className="composer-field"
        id={id}
        aria-label={label}
        rows={1}
        maxLength={2000}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Enter отправляет, перенос строки остаётся на Shift+Enter, как в переписке.
          if (event.key !== 'Enter' || event.shiftKey) return;

          event.preventDefault();
          if (ready) onSend();
        }}
      />

      <button
        type="button"
        className="composer-send"
        aria-label="Отправить"
        title="Отправить"
        disabled={!ready}
        onClick={onSend}
      >
        <IconSend />
      </button>
    </div>
  );
};
