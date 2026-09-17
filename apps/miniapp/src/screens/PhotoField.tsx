import { Button } from '@maxhub/max-ui';
import { useId, type ChangeEvent } from 'react';

import { ErrorText } from './ErrorText.js';
import { IconCamera } from './icons.js';

export interface PhotoFieldProps {
  /** Что снимают: подпись читает голосовой помощник, на экране остаётся значок. */
  label: string;
  /** Сколько снимков уже уехало на сервер. */
  count: number;
  uploading: boolean;
  error: string | null;
  /** Подпись рядом со значком: там, где кнопка стоит одна и её смысл неочевиден. */
  withLabel?: boolean;
  /** Размер соседней кнопки: рядом с ней камера должна быть одного роста. */
  size?: 'medium' | 'large';
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
}

/** Снимок к сообщению: значок камеры, внутри системное поле файла. */
export const PhotoField = ({ label, count, uploading, error, withLabel, size, onPick }: PhotoFieldProps) => {
  const id = useId();

  return (
    <div className="photo-field">
      <Button
        asChild
        variant="secondary"
        size={size ?? 'medium'}
        loading={uploading}
        disabled={uploading}
        aria-label={label}
      >
        <label
          className={`${withLabel ? 'photo-wide' : 'photo-pick'}${uploading ? ' photo-busy' : ''}`}
          htmlFor={id}
          title={label}
        >
          <IconCamera />
          {withLabel ? <span>{uploading ? 'Отправляем…' : label}</span> : null}
          {count > 0 && !withLabel ? <span className="photo-count">{count}</span> : null}
        </label>
      </Button>

      <input id={id} type="file" accept="image/*" onChange={onPick} />

      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
};
