import { useEffect, useRef, useState } from 'react';

import { describeFailure, type DomovoyApi } from '../api.js';
import { useHaptics } from '../haptics.js';
import { useFit } from './Composer.js';
import { Domovoy } from './Domovoy.js';
import { ErrorText } from './ErrorText.js';
import { IconHelp, IconSend } from './icons.js';

export interface AssistantProps {
  api: DomovoyApi;
  /** Куда уводить по кнопке из ответа. */
  onGo: (screen: string) => void;
  onClose: () => void;
}

/** С чего начинают те, кто не знает, что спросить. */
const STARTERS = ['Как сообщить о поломке?', 'Где передать показания?', 'Что с моей заявкой?', 'Как открыть подъезд?'];

/** Одна реплика разговора: вопрос человека или ответ помощника. */
interface Line {
  from: 'you' | 'bot';
  text: string;
  /** Раздел, который помощник предлагает открыть. */
  screen?: string;
  /** Название раздела для подписи кнопки. */
  title?: string;
}

/** Кнопка помощника: она в шапке любого экрана, поэтому спросить можно всегда. */
export const AssistantButton = ({ onOpen }: { onOpen: () => void }) => (
  <button type="button" className="refresh" data-guide="assistant" aria-label="Помощник" onClick={onOpen}>
    <IconHelp />
  </button>
);

/**
 * Помощник по приложению: разговор, в котором можно спрашивать дальше.
 * Ответ приходит с готовым переходом в раздел, а пока помощник думает,
 * это видно. Без модели отвечает подбором по разделам, поэтому есть всегда.
 */
export const Assistant = ({ api, onGo, onClose }: AssistantProps) => {
  const [question, setQuestion] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const haptics = useHaptics();
  const tail = useRef<HTMLDivElement>(null);
  const field = useFit(question);

  // Свежая реплика всегда на виду: разговор прокручивается сам.
  useEffect(() => {
    tail.current?.scrollIntoView({ block: 'end' });
  }, [lines, busy]);

  useEffect(() => {
    const shut = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    globalThis.addEventListener('keydown', shut);

    return () => globalThis.removeEventListener('keydown', shut);
  }, [onClose]);

  const ask = async (asked: string): Promise<void> => {
    const text = asked.trim();

    if (text.length === 0 || busy) return;

    setLines((said) => [...said, { from: 'you', text }]);
    setQuestion('');
    setBusy(true);
    setFailed(null);

    try {
      const answer = await api.assistant(text);

      setLines((said) => [
        ...said,
        {
          from: 'bot',
          text: answer.answer,
          ...(answer.screen ? { screen: answer.screen } : {}),
          ...(answer.title ? { title: answer.title } : {}),
        },
      ]);
      haptics.done();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="guide" role="dialog" aria-modal="true" aria-label="Помощник">
      <button type="button" className="guide-veil" aria-label="Закрыть помощника" onClick={onClose} />

      <section className="guide-sheet assistant">
        <header className="assistant-head">
          <Domovoy mood="walking" />

          <div>
            <h2>Чем помочь?</h2>
            <p className="hint">Спросите словами, я подскажу и открою нужный раздел.</p>
          </div>

          <button type="button" className="assistant-close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="assistant-talk" aria-live="polite">
          {lines.map((line, index) => (
            <div key={`${line.from}-${index}`} className={line.from === 'you' ? 'turn turn-you' : 'turn turn-bot'}>
              <p className={line.from === 'you' ? 'said said-you' : 'said said-bot'}>{line.text}</p>

              {line.screen ? (
                <button
                  type="button"
                  className="inline-btn"
                  onClick={() => {
                    onClose();
                    onGo(line.screen as string);
                  }}
                >
                  {line.title ? `Открыть: ${line.title}` : 'Открыть раздел'}
                </button>
              ) : null}
            </div>
          ))}

          {busy ? (
            <div className="turn turn-bot">
              <p className="said said-bot thinking">Думаю…</p>
            </div>
          ) : null}

          {lines.length === 0 && !busy ? (
            <div className="assistant-starters">
              {STARTERS.map((starter) => (
                <button key={starter} type="button" className="chip" onClick={() => void ask(starter)}>
                  {starter}
                </button>
              ))}
            </div>
          ) : null}

          <div ref={tail} />
        </div>

        {failed ? <ErrorText>{failed}</ErrorText> : null}

        <div className="composer assistant-ask">
          <textarea
            ref={field}
            className="composer-field"
            aria-label="Вопрос помощнику"
            rows={1}
            maxLength={500}
            value={question}
            placeholder="Спросите словами"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;

              event.preventDefault();
              void ask(question);
            }}
          />

          <button
            type="button"
            className="composer-send"
            aria-label="Отправить"
            title="Отправить"
            disabled={busy || question.trim().length === 0}
            onClick={() => void ask(question)}
          >
            <IconSend />
          </button>
        </div>
      </section>
    </div>
  );
};
