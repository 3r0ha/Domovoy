import { useBridgeRequest } from '@maxkit/react';
import { useEffect, useRef, useState } from 'react';

import { describeFailure, type DomovoyApi } from '../api.js';
import { useTrapped } from '../focus.js';
import { useHaptics } from '../haptics.js';
import { useFit } from './Composer.js';
import { Domovoy } from './Domovoy.js';
import { ErrorText } from './ErrorText.js';
import { IconHelp, IconSend } from './icons.js';
import { VoiceButton } from './VoiceButton.js';

export interface AssistantProps {
  api: DomovoyApi;
  /** Куда уводить по кнопке из ответа. */
  onGo: (screen: string) => void;
  onClose: () => void;
}


/** Одна реплика разговора: вопрос человека или ответ помощника. */
interface Line {
  from: 'you' | 'bot';
  text: string;
  /** Раздел, который помощник предлагает открыть. */
  screen?: string;
  /** Название раздела для подписи кнопки. */
  title?: string;
}

/** Сколько прошлых реплик уходит модели: дальше разговор уходит в сторону. */
const TALK_DEPTH = 6;

/**
 * Разговор парами «спросили, ответили»: по ним модель читает продолжение вроде
 * «а если нет». Незаконченная пара не отправляется, у неё нет ответа.
 */
const pairs = (lines: readonly Line[]): { asked: string; said: string }[] => {
  const said: { asked: string; said: string }[] = [];

  for (let at = 0; at + 1 < lines.length; at += 1) {
    if (lines[at]?.from === 'you' && lines[at + 1]?.from === 'bot') {
      said.push({ asked: lines[at]!.text, said: lines[at + 1]!.text });
    }
  }

  return said.slice(-TALK_DEPTH);
};

/**
 * Кнопка помощника: она в шапке любого экрана и подписана словом. Значок без
 * подписи человек, который редко берёт телефон в руки, просто не замечает.
 */
export const AssistantButton = ({ onOpen }: { onOpen: () => void }) => (
  <button type="button" className="ask" data-guide="assistant" aria-label="Спросить помощника" onClick={onOpen}>
    <IconHelp />
    <span className="ask-word">Спросить</span>
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
  const sheet = useTrapped<HTMLElement>(true);

  // Подсказки зависят от роли, поэтому приходят с сервера. Без них помощник работает.
  const opening = useBridgeRequest(
    (alive) => api.until(alive).assistantStarters().catch(() => ({ starters: [] })),
    [api],
  );
  const starters = opening.data?.starters ?? [];

  // Свежая реплика всегда на виду: разговор прокручивается сам. Первый показ
  // пропускается, иначе открытие помощника утягивает страницу под накладкой.
  const talked = useRef(false);

  useEffect(() => {
    if (talked.current) tail.current?.scrollIntoView({ block: 'end' });
    else talked.current = true;
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
      const answer = await api.assistant(text, pairs(lines));

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

      <section className="guide-sheet assistant" ref={sheet}>
        <header className="assistant-head">
          <Domovoy mood="walking" />

          <div>
            <h2>Чем помочь?</h2>
            <p className="hint">Отвечу и открою нужный раздел</p>
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
                  {line.screen === 'tour' ? 'Показать тур' : line.title ? `Открыть: ${line.title}` : 'Открыть раздел'}
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
              {starters.map((starter) => (
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
          {/* Сказанное попадает в поле, а не уходит вопросом само: человек
              должен увидеть, что распознали, и поправить. */}
          <VoiceButton
            api={api}
            compact
            label="Вопрос помощнику"
            onText={(said) =>
              setQuestion((current) => (current.trim().length === 0 ? said : `${current.trimEnd()} ${said}`))
            }
          />

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
