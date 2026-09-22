import { translatorFor, type Language } from '@domovoy/i18n';
import { useBridgeRequest } from '@maxkit/react';
import { useEffect, useRef, useState } from 'react';

import { describeFailure, type DomovoyApi } from '../api.js';
import { useTrapped } from '../focus.js';
import { useHaptics } from '../haptics.js';
import { useT } from '../i18n.js';
import { useFit } from './Composer.js';
import { Domovoy } from './Domovoy.js';
import { ErrorText } from './ErrorText.js';
import { IconHelp, IconSend } from './icons.js';
import { VoiceButton } from './VoiceButton.js';

export interface AssistantProps {
  api: DomovoyApi;
  /** Куда уводить по кнопке из ответа. */
  onGo: (screen: string) => void;
  /** Человек спросил на другом языке и выбрал перейти на него. */
  onLanguage: (language: Language) => void;
  /**
   * Откуда позвали помощника. Человек застревает на конкретном экране, и ответ
   * «зайдите в раздел» тому, кто в разделе уже стоит, помощи не даёт.
   */
  at?: string;
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
  /** Язык вопроса: на него предлагается перейти. */
  language?: Language;
  /** Подпись кнопки перехода, на том же языке. */
  languageTitle?: string;
  /** Ответ собрала модель, а не подбор по разделам продукта. */
  byModel?: boolean;
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
export const AssistantButton = ({ onOpen }: { onOpen: () => void }) => {
  const t = useT();

  return (
    <button type="button" className="ask" data-guide="assistant" aria-label={t('assistant.ask')} onClick={onOpen}>
      <IconHelp />
      <span className="ask-word">{t('assistant.button')}</span>
    </button>
  );
};

/**
 * Помощник по приложению: разговор, в котором можно спрашивать дальше.
 * Ответ приходит с готовым переходом в раздел, а пока помощник думает,
 * это видно. Без модели отвечает подбором по разделам, поэтому есть всегда.
 */
export const Assistant = ({ api, onGo, onLanguage, at, onClose }: AssistantProps) => {
  const t = useT();
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

  /** Переход на язык вопроса: ответ остаётся на месте, меняется весь интерфейс. */
  const switchTo = async (language: Language): Promise<void> => {
    try {
      await api.setLanguage(language);
      onLanguage(language);

      // Переход виден сразу: предложение снимается, а продукт отвечает строкой
      // на новом языке. Без неё нажатие выглядело как будто ничего не случилось.
      setLines((said) => [
        ...said.map((line) => ({ ...line, language: undefined, languageTitle: undefined })),
        { from: 'bot', text: translatorFor(language)('miniapp.language.switched') },
      ]);
      haptics.done();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    }
  };

  const ask = async (asked: string): Promise<void> => {
    const text = asked.trim();

    if (text.length === 0 || busy) return;

    setLines((said) => [...said, { from: 'you', text }]);
    setQuestion('');
    setBusy(true);
    setFailed(null);

    try {
      const answer = await api.assistant(text, pairs(lines), at ? { screen: at } : {});

      setLines((said) => [
        ...said,
        {
          from: 'bot',
          text: answer.answer,
          ...(answer.screen ? { screen: answer.screen } : {}),
          ...(answer.title ? { title: answer.title } : {}),
          ...(answer.offerLanguage ? { language: answer.offerLanguage } : {}),
          ...(answer.offerTitle ? { languageTitle: answer.offerTitle } : {}),
          ...(answer.by === 'model' ? { byModel: true } : {}),
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
    <div className="guide" role="dialog" aria-modal="true" aria-label={t('assistant.title')}>
      <button type="button" className="guide-veil" aria-label={t('assistant.close.veil')} onClick={onClose} />

      <section className="guide-sheet assistant" ref={sheet}>
        <header className="assistant-head">
          {/* Портрет здесь значок собеседника, а не иллюстрация: в полный
              размер он перевешивал и вопрос, и сам разговор. */}
          <Domovoy mood="walking" size={48} />

          <h2>{t('assistant.lead')}</h2>

          <button type="button" className="assistant-close" aria-label={t('assistant.close')} onClick={onClose}>
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
                  {line.screen === 'tour'
                    ? t('assistant.tour')
                    : line.title
                      ? t('assistant.open.titled', { раздел: line.title })
                      : t('assistant.open')}
                </button>
              ) : null}

              {line.language && line.languageTitle ? (
                <button
                  type="button"
                  className="inline-btn"
                  onClick={() => void switchTo(line.language as Language)}
                >
                  {line.languageTitle}
                </button>
              ) : null}

              {/* Откуда ответ: разделы продукта человек проверит сам, а собранное
                  моделью это пересказ, а не выписка из правил дома. */}
              {line.byModel ? <p className="hint aside machine-note">{t('assistant.byModel')}</p> : null}
            </div>
          ))}

          {busy ? (
            <div className="turn turn-bot">
              <p className="said said-bot thinking">{t('assistant.thinking')}</p>
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
            label={t('assistant.question')}
            onText={(said) =>
              setQuestion((current) => (current.trim().length === 0 ? said : `${current.trimEnd()} ${said}`))
            }
          />

          <textarea
            ref={field}
            className="composer-field"
            aria-label={t('assistant.question')}
            rows={1}
            maxLength={500}
            value={question}
            placeholder={t('assistant.placeholder')}
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
            aria-label={t('assistant.send')}
            title={t('assistant.send')}
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
