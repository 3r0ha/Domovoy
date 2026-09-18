import { useBridgeRequest, useClosingConfirmation } from '@maxkit/react';
import { useState } from 'react';

import {
  ApiError,
  formatDeadline,
  statusTitle,
  type DomovoyApi,
  type PlannedWorkView,
  type SubmitResult,
} from '../api.js';
import { useHaptics } from '../haptics.js';
import { usePhotos } from '../use-photos.js';
import { Composer } from './Composer.js';
import { ErrorText } from './ErrorText.js';
import { objectHistory } from './ObjectScreen.js';
import { ScanCode } from './ScanCode.js';

export interface NewRequestScreenProps {
  api: DomovoyApi;
  /** Код объекта с наклейки, если приложение открыто по ссылке. */
  startParam?: string;
  /** Куда уйдёт заявка, если кода объекта нет. */
  where?: string;
  /** Смене доступен выбор квартиры, от которой заводится заявка. */
  staff?: boolean;
  /** Заявка заведена: приложение открывает её карточку. */
  onCreated: (requestId?: string) => void;
  /** Вопрос ушёл в управляющую организацию: приложение открывает переписку. */
  onSupport?: () => void;
}

/** С чего чаще всего начинают: нажатие ставит начало фразы в поле ввода. */
const COMMON = [
  'Нет горячей воды',
  'Не работает лифт',
  'Не горит свет на площадке',
  'Течёт труба',
  'Не работает домофон',
  'Грязно в подъезде',
];

/** Оформление заявки: обязательное поле одно, что случилось. */
export const NewRequestScreen = ({
  api,
  startParam: opened,
  where,
  staff = false,
  onCreated,
  onSupport,
}: NewRequestScreenProps) => {
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<SubmitResult | null>(null);
  const [sent, setSent] = useState('');
  const photos = usePhotos(api);
  const haptics = useHaptics();
  const [scanned, setScanned] = useState<string | null>(null);
  const startParam = scanned ?? opened;
  const [planned, setPlanned] = useState<{ work: PlannedWorkView; description: string } | null>(null);
  const [answered, setAnswered] = useState<{ text: string; description: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [asked, setAsked] = useState<{ requestId: string; question: string } | null>(null);
  const [answer, setAnswer] = useState('');

  useClosingConfirmation(description.trim().length > 0);

  const context = useBridgeRequest(
    async () => (startParam ? api.context(startParam) : null),
    [api, startParam],
  );

  const passport = useBridgeRequest(
    async () => (startParam ? api.objectPassport(startParam).catch(() => null) : null),
    [api, startParam],
  );

  const flats = useBridgeRequest(async () => (staff ? api.apartments().catch(() => []) : []), [api, staff]);
  const [apartmentId, setApartmentId] = useState('');

  const send = async (text: string, anyway: boolean): Promise<void> => {
    setSending(true);
    setError(null);
    setSent(text);
    setAnswered(null);

    try {
      const result = await api.createRequest({
        description: text,
        ...(startParam && !context.error ? { startParam } : {}),
        ...(apartmentId ? { apartmentId } : {}),
        // Смена не назвала квартиру: заявка о доме, а не о квартире сотрудника.
        ...(staff && !apartmentId ? { house: true } : {}),
        ...(photos.photos.length > 0 ? { attachments: photos.photos } : {}),
        ...(anyway ? { anyway: true } : {}),
      });

      // Отправленное уходит из поля сразу: оно уже стоит в переписке.
      setDescription('');
      haptics.done();

      if (result.planned) {
        setPlanned({ work: result.planned, description: text });
        return;
      }

      // Написанное оказалось вопросом: продукт ответил, а заявку человек
      // заведёт сам, если ответ его не устроил.
      if (result.answered) {
        setAnswered({ text: result.answered, description: text });
        return;
      }

      setPlanned(null);
      photos.reset();

      if (result.joined && result.request) {
        setJoined(result);
        return;
      }

      if (result.question && result.request) {
        setAsked({ requestId: result.request.id, question: result.question });
        return;
      }

      onCreated(result.request?.id);
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : 'Не удалось отправить заявку');
    } finally {
      setSending(false);
    }
  };

  /** Вопрос уходит в переписку с управляющей организацией, а не заявкой. */
  const toSupport = async (text: string): Promise<void> => {
    setSending(true);
    setError(null);

    try {
      await api.askSupport(text);
      haptics.done();
      onSupport?.();
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : 'Не удалось отправить вопрос');
    } finally {
      setSending(false);
    }
  };

  /** Ответ на уточнение уходит сообщением по заявке. */
  const reply = async (): Promise<void> => {
    const text = answer.trim();

    if (!asked || text.length === 0) {
      onCreated(asked?.requestId);
      return;
    }

    setSending(true);
    setError(null);

    try {
      await api.comment(asked.requestId, text);

      haptics.done();
      onCreated(asked.requestId);
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : 'Не удалось отправить ответ');
    } finally {
      setSending(false);
    }
  };

  /** Подтверждение уже открытой заявки без единого слова. */
  const confirmSame = async (requestId: string): Promise<void> => {
    setConfirming(requestId);
    setError(null);

    try {
      const request = await api.answerAlert(requestId, true);

      haptics.done();
      setJoined({ joined: true, request });
    } catch (reason) {
      haptics.failed();
      setError(reason instanceof ApiError ? reason.message : 'Не удалось подтвердить');
    } finally {
      setConfirming(null);
    }
  };

  const known = passport.data?.open ?? [];
  const target = context.data?.target ?? where;

  /** Что уходит из строки ответа: описание проблемы или уточнение по заведённой заявке. */
  const push = (): void => {
    if (asked) {
      void reply();
      return;
    }

    if (description.trim().length === 0) return;

    void send(description.trim(), false);
  };

  /** Разговор ещё не начался: подсказки видно, а место под ними не пустует. */
  const fresh = !sent && !asked && !joined && !planned && !answered;

  return (
    <section className={fresh ? 'chat chat-fresh' : 'chat'}>
      <div className="chat-flow">
        <article className="said said-bot">
          {target ? <span className="said-who">{target}</span> : null}
          <p className="description">Что случилось?</p>
        </article>

        {fresh ? <p className="hint chat-note">Выберите частое или опишите своими словами</p> : null}

        {fresh ? (
          <div className="chips chat-common">
            {COMMON.map((problem) => (
              <button
                key={problem}
                type="button"
                className="chip"
                onClick={() => {
                  haptics.picked();
                  setDescription(description.trim().length > 0 ? description : problem);
                }}
              >
                {problem}
              </button>
            ))}
          </div>
        ) : null}

        {context.error ? (
          <article className="said said-bot">
            <p className="description">Код с наклейки не распознан, заявку заведу по вашей квартире.</p>
          </article>
        ) : null}

        {known.length === 0 && passport.data && passport.data.totalRequests > 0 ? (
          <article className="said said-bot">
            <p className="description">
              {objectHistory(passport.data.totalRequests, passport.data.lastRepairAt, passport.data.averageDays)}
            </p>
          </article>
        ) : null}

        {known.map((request) => (
          <div key={request.id} className="turn turn-bot">
            <article className="said said-bot">
              <p className="description">
                Об этом уже сообщили: {request.title}. {statusTitle(request.status)},{' '}
                {formatDeadline(request.resolutionDueAt)}.
              </p>

              {request.mine ? <p className="hint">Вы сообщили</p> : null}
            </article>

            {request.mine ? null : (
              <button
                type="button"
                className="inline-btn"
                disabled={confirming !== null}
                onClick={() => void confirmSame(request.id)}
              >
                {confirming === request.id ? '…' : 'У меня то же самое'}
              </button>
            )}
          </div>
        ))}

        {/* Отправленное видно там же, где ответ: это переписка, а не форма. */}
        {sent ? (
          <article className="said said-own">
            <p className="description">{sent}</p>
          </article>
        ) : null}

        {answered ? (
          <div className="turn turn-bot">
            <article className="said said-bot">
              {answered.text.split('\n').map((line, index) => (
                <p key={index} className="description">
                  {line}
                </p>
              ))}
            </article>

            <button
              type="button"
              className="inline-btn"
              disabled={sending}
              onClick={() => void send(answered.description, true)}
            >
              {sending ? '…' : 'Всё равно оформить'}
            </button>

            <button
              type="button"
              className="inline-btn"
              disabled={sending}
              onClick={() => void toSupport(answered.description)}
            >
              Спросить в поддержке
            </button>
          </div>
        ) : null}

        {planned ? (
          <div className="turn turn-bot">
            <article className="said said-bot">
              {planned.work.message.split('\n').map((line, index) => (
                <p key={index} className="description">
                  {line}
                </p>
              ))}
            </article>

            <button
              type="button"
              className="inline-btn"
              onClick={() => onCreated(joined?.request?.id ?? asked?.requestId)}
            >
              Подожду
            </button>

            <button
              type="button"
              className="inline-btn"
              disabled={sending}
              onClick={() => void send(planned.description, true)}
            >
              {sending ? '…' : 'Это другое'}
            </button>
          </div>
        ) : null}

        {joined?.request ? (
          <div className="turn turn-bot">
            <article className="said said-bot">
              <p className="description">
                Уже чиним: {joined.request.title}. {statusTitle(joined.request.status)},{' '}
                {formatDeadline(joined.request.resolutionDueAt)}. Сообщили: {joined.request.reporters}.
              </p>
            </article>

            <button type="button" className="inline-btn" onClick={() => onCreated(joined.request?.id)}>
              К заявкам
            </button>

            <button
              type="button"
              className="inline-btn"
              disabled={sending}
              onClick={() => {
                setJoined(null);
                if (sent) void send(sent, true);
              }}
            >
              {sending ? '…' : 'Это другое'}
            </button>
          </div>
        ) : null}

        {asked ? (
          <div className="turn turn-bot">
            <article className="said said-bot">
              <p className="description">Заявка принята. {asked.question}</p>
            </article>

            <button type="button" className="inline-btn" onClick={() => onCreated(asked.requestId)}>
              Пропустить
            </button>
          </div>
        ) : null}
      </div>

      <div className="chat-foot">
        {error ? <ErrorText>{error}</ErrorText> : null}

        {staff && Array.isArray(flats.data) && flats.data.length > 0 ? (
          <select
            className="chat-flat"
            aria-label="От какой квартиры"
            value={apartmentId}
            onChange={(event) => setApartmentId(event.target.value)}
          >
            <option value="">Квартира не указана</option>
            {flats.data.map((flat) => (
              <option key={flat.id} value={flat.id}>
                {`кв. ${flat.number}`}
              </option>
            ))}
          </select>
        ) : null}

        <Composer
          id="description"
          label={asked ? 'Уточнение' : 'Что случилось'}
          placeholder="Опишите, что случилось"
          value={asked ? answer : description}
          busy={sending}
          photos={photos}
          requireText
          {...(context.data || asked ? {} : { extra: <ScanCode compact onScanned={setScanned} /> })}
          onChange={asked ? setAnswer : setDescription}
          onSend={push}
        />
      </div>
    </section>
  );
};
