import { useId, useRef } from 'react';

import { type DomovoyApi } from '../api.js';
import { useVoice } from '../use-voice.js';
import { ErrorText } from './ErrorText.js';
import { IconMic } from './icons.js';

/**
 * Короткое нажатие оставляет запись идти, долгое работает как рация. Держать
 * кнопку полминуты пожилой руке тяжело, а отпустить её случайно легко.
 */
const LOCK_MS = 700;

export interface VoiceButtonProps {
  api: DomovoyApi;
  /** Подпись поля, куда попадёт расшифровка: её читает озвучка экрана. */
  label: string;
  /** Кружком в строке ответа, рядом с камерой. */
  compact?: boolean;
  /** Что делать с расшифровкой: обычно дописать к набранному. */
  onText: (text: string) => void;
}

/** Сколько идёт запись: «0:07». */
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Запись голоса рядом с полем ввода. Расшифровка подставляется в поле, а не
 * уходит сама: человек должен увидеть, что именно распознали, и поправить.
 */
export const VoiceButton = ({ api, label, compact, onText }: VoiceButtonProps) => {
  const voice = useVoice(api, onText);
  const field = useId();
  const since = useRef(0);
  const held = useRef(false);
  // Нажатие мышью и пальцем даёт и pointer-события, и click: второй раз не считаем.
  const byPointer = useRef(false);

  const recording = voice.state === 'recording';
  const decoding = voice.state === 'decoding';

  const toggle = (): void => {
    if (recording) voice.stop();
    else voice.start();
  };

  const press = (): void => {
    byPointer.current = true;
    held.current = true;
    since.current = Date.now();
    toggle();
  };

  const release = (): void => {
    if (!held.current) return;

    held.current = false;

    if (Date.now() - since.current >= LOCK_MS) voice.stop();
  };

  const caption = recording ? 'Готово' : decoding ? 'Расшифровываем…' : 'Сказать голосом';
  const aria = recording ? `Остановить запись: ${label}` : `Записать голосом: ${label}`;
  const shape = compact ? 'voice-key voice-round' : 'voice-key voice-wide';

  return (
    <div className={compact ? 'voice voice-flat' : 'voice'}>
      {voice.live ? (
        <button
          type="button"
          className={recording ? `${shape} voice-on` : shape}
          aria-label={aria}
          aria-pressed={recording}
          title={aria}
          disabled={decoding}
          onPointerDown={press}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={release}
          onClick={() => {
            // С клавиатуры приходит только click: там кнопка работает переключателем.
            if (byPointer.current) byPointer.current = false;
            else toggle();
          }}
        >
          <IconMic />
          {recording ? <span className="voice-time">{clock(voice.seconds)}</span> : null}
          {compact ? null : <span>{caption}</span>}
        </button>
      ) : (
        <>
          {/* Запасной путь: системная запись клиента. Подпись поля файла с
              клавиатуры недостижима, поэтому у неё своя роль и свой Enter. */}
          <label
            className={decoding ? `${shape} voice-busy` : shape}
            htmlFor={field}
            title={`Записать голосом: ${label}`}
            aria-label={`Записать голосом: ${label}`}
            role="button"
            tabIndex={decoding ? -1 : 0}
            onKeyDown={(event) => {
              if (decoding || (event.key !== 'Enter' && event.key !== ' ')) return;

              event.preventDefault();
              event.currentTarget.click();
            }}
          >
            <IconMic />
            {compact ? null : <span>{decoding ? 'Расшифровываем…' : 'Сказать голосом'}</span>}
          </label>

          <input id={field} className="voice-file" type="file" accept="audio/*" capture onChange={voice.attach} />
        </>
      )}

      {decoding ? (
        <span className="voice-note" role="status">
          Расшифровываем…
        </span>
      ) : null}

      {voice.error ? (
        <span className="voice-note">
          <ErrorText className="voice-error">{voice.error}</ErrorText>

          {voice.live ? (
            <button
              type="button"
              className="link"
              onClick={() => {
                voice.dismiss();
                voice.start();
              }}
            >
              Повторить
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
};
