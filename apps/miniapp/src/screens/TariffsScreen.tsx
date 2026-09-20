import { Button, CellInput, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { ApiError, decimal, type DomovoyApi, formatDay, parseDecimal, type TariffView } from '../api.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Skeleton } from './Skeleton.js';

export interface TariffsScreenProps {
  api: DomovoyApi;
  /** Менять тарифы может только управляющий. */
  editable?: boolean;
}

const number = (value: number): string => decimal(value, 4);

/** Ставка хранится долей, а читается процентами: 0,16 это 16% годовых. */
const shown = (tariff: TariffView): string =>
  tariff.kind === 'key_rate' ? `${number(tariff.value * 100)}%` : number(tariff.value);

/** Свой тариф подписан датой, базовый только единицей: про них говорит сноска. */
const since = (tariff: TariffView): string =>
  tariff.own && tariff.since ? `${tariff.unit} · с ${formatDay(tariff.since)}` : tariff.unit;

/** Тарифы дома: из них складывается квитанция. */
export const TariffsScreen = ({ api, editable }: TariffsScreenProps) => {
  const tariffs = useBridgeRequest((alive) => api.until(alive).tariffs(), [api]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (tariffs.loading && !tariffs.data) return <Skeleton count={3} />;

  if (tariffs.error || !tariffs.data) {
    return <Failure title="Тарифы недоступны" error={tariffs.error} onRetry={tariffs.reload} />;
  }

  const list = tariffs.data;
  const bases = [...new Set(list.map((tariff) => tariff.basis).filter((basis): basis is string => Boolean(basis)))];

  const save = async (tariff: TariffView): Promise<void> => {
    // Повтор по Enter, пока тариф ещё сохраняется, отправил бы его дважды.
    if (busy) return;

    const parsed = parseDecimal(draft);

    if (parsed === null || parsed < 0) {
      setError('Тариф должен быть неотрицательным числом');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await api.setTariff(tariff.kind, parsed);
      setEditing(null);
      tariffs.reload();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Тариф не сохранён');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="list">
      <CellList mode="island">
        {list.map((tariff, index) =>
          editing === tariff.kind ? (
            <div key={tariff.kind} className="tariff-edit">
              <CellInput
                autoFocus
                inputMode="decimal"
                aria-label={tariff.title}
                value={draft}
                before={<span className="hint">{tariff.title}</span>}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !busy) void save(tariff);
                }}
              />
              <Button className="tariff-save" type="button" size="small" disabled={busy} onClick={() => void save(tariff)}>
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          ) : (
            <CellSimple
              key={tariff.kind}
              className="tariff-row"
              title={tariff.title}
              subtitle={since(tariff)}
              after={
                <span className="tariff-after">
                  <span className="report-value">{shown(tariff)}</span>
                  {/* Что число правится нажатием, видно по слову, а не угадывается. */}
                  {editable ? <span className="tariff-change">Изменить</span> : null}
                </span>
              }
              separator={index > 0}
              {...(editable
                ? {
                    showChevron: true,
                    onClick: () => {
                      setDraft(String(tariff.value));
                      setEditing(tariff.kind);
                      setError(null);
                    },
                  }
                : {})}
            />
          ),
        )}
      </CellList>

      {error ? <ErrorText>{error}</ErrorText> : null}

      {/* Откуда взялось значение: заданное организацией и умолчание продукта различаются. */}
      {bases.map((basis) => (
        <p key={basis} className="hint aside">
          {basis}
        </p>
      ))}
    </div>
  );
};
