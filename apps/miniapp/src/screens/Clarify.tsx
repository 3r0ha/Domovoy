import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { describeFailure, type DomovoyApi } from '../api.js';
import { useHaptics } from '../haptics.js';
import { ErrorText } from './ErrorText.js';
import { Group } from './Group.js';
import { RetryLink } from './Retry.js';

export interface ClarifyProps {
  api: DomovoyApi;
  requestId: string;
  onChanged?: () => void;
}

/**
 * Уточнение адреса заявки: продукт спрашивает, где случилось, и даёт готовые
 * варианты кнопками. Набирать адрес руками не нужно, а варианты всегда
 * настоящие: они собраны из объектов этого дома. Смене к вариантам добавляется
 * список квартир: заявку по телефону она заводит за жильца.
 */
export const Clarify = ({ api, requestId, onChanged }: ClarifyProps) => {
  const asked = useBridgeRequest((alive) => api.until(alive).clarify(requestId), [api, requestId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [flat, setFlat] = useState('');
  const haptics = useHaptics();

  const anyApartment = asked.data?.anyApartment === true;
  const flats = useBridgeRequest(
    async (alive) => (anyApartment ? api.until(alive).apartments() : []),
    [api, anyApartment],
  );

  const options = asked.data?.options ?? [];
  const all = Array.isArray(flats.data) ? flats.data : [];

  if (done || !asked.data?.question || (options.length === 0 && !anyApartment)) return null;

  const choose = async (startParam: string): Promise<void> => {
    setBusy(startParam);
    setFailed(null);

    try {
      await api.setTarget(requestId, startParam);
      haptics.done();
      setDone(true);
      onChanged?.();
    } catch (error: unknown) {
      setFailed(describeFailure(error));
      haptics.failed();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Group title="Уточните адрес">
      <div className="block">
        <p className="description">{asked.data.question}</p>

        {/* Список квартир не дошёл: без этой строки выбор просто отсутствует,
            и заявку не к чему привязать. */}
        {anyApartment && all.length === 0 && flats.error ? (
          <RetryLink title="Список квартир не загрузился" onRetry={flats.reload} />
        ) : null}

        {anyApartment && all.length > 0 ? (
          <div className="clarify-flat">
            <select className="chat-flat" aria-label="Квартира" value={flat} onChange={(event) => setFlat(event.target.value)}>
              <option value="">Выберите квартиру</option>
              {all.map((apartment) => (
                <option key={apartment.id} value={apartment.id}>
                  {`кв. ${apartment.number}`}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="inline-btn"
              disabled={flat === '' || busy !== null}
              onClick={() => void choose(`apt_${flat}`)}
            >
              {busy === `apt_${flat}` ? 'Отправляем…' : 'Указать квартиру'}
            </button>
          </div>
        ) : null}

        <div className="inline-keys">
          {options.map((option) => (
            <button
              key={option.startParam}
              type="button"
              className="inline-btn"
              disabled={busy !== null}
              onClick={() => void choose(option.startParam)}
            >
              {busy === option.startParam ? 'Отправляем…' : option.label}
            </button>
          ))}
        </div>

        {failed ? <ErrorText>{failed}</ErrorText> : null}
      </div>
    </Group>
  );
};
