import { Button, CellInput, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { ApiError, decimal, type DomovoyApi, formatDay, parseDecimal, type TariffView } from '../api.js';
import { Amount } from './Amount.js';
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
  tariff.kind === 'key_rate' ? number(tariff.value * 100) : number(tariff.value);

/**
 * Знак при числе: он и есть единица. Остальное от «₽ за м³» это уточнение
 * и стоит под названием, а не в числовой колонке.
 */
const sign = (tariff: TariffView): string => (tariff.kind === 'key_rate' ? '%' : '₽');

/** Что вводится в поле: ставку правят теми же процентами, какими она показана в списке. */
const entered = (tariff: TariffView, value: number): number => (tariff.kind === 'key_rate' ? value / 100 : value);

/** Единица рядом с полем: без неё «16» у ставки и «43,5» у воды читаются одинаково. */
const inputUnit = (tariff: TariffView): string => (tariff.kind === 'key_rate' ? '% годовых' : tariff.unit);

/** Свой тариф подписан датой, базовый только единицей: про них говорит сноска. */
const since = (tariff: TariffView): string => {
  const about = tariff.unit.replace(/^₽\s+/u, '');

  return tariff.own && tariff.since ? `${about} · с ${formatDay(tariff.since)}` : about;
};

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
      await api.setTariff(tariff.kind, entered(tariff, parsed));
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
              {/* Название над полем: в строке правки число стояло одно, и было не видно, чей это тариф. */}
              <p className="tariff-edit-title">
                {tariff.title}
                <span className="hint">{inputUnit(tariff)}</span>
              </p>

              <div className="tariff-edit-line">
                <CellInput
                  autoFocus
                  inputMode="decimal"
                  aria-label={`${tariff.title}, ${inputUnit(tariff)}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !busy) void save(tariff);
                    if (event.key === 'Escape' && !busy) setEditing(null);
                  }}
                />
                <Button className="tariff-save" type="button" size="small" disabled={busy} onClick={() => void save(tariff)}>
                  {busy ? 'Сохраняем…' : 'Сохранить'}
                </Button>
              </div>

              {error ? <ErrorText>{error}</ErrorText> : null}

              <button type="button" className="link" disabled={busy} onClick={() => setEditing(null)}>
                Отмена
              </button>
            </div>
          ) : (
            <CellSimple
              key={tariff.kind}
              className="tariff-row"
              title={tariff.title}
              subtitle={since(tariff)}
              /* Что тариф правится, видно по шеврону: слово «Изменить» стояло
                 в каждой строке и превращало столбец чисел в столбец ссылок. */
              after={<Amount value={shown(tariff)} unit={sign(tariff)} />}
              separator={index > 0}
              {...(editable
                ? {
                    showChevron: true,
                    onClick: () => {
                      setDraft(shown(tariff));
                      setEditing(tariff.kind);
                      setError(null);
                    },
                  }
                : {})}
            />
          ),
        )}
      </CellList>

      {/* Откуда взялось значение: заданное организацией и умолчание продукта различаются. */}
      {bases.map((basis) => (
        <p key={basis} className="hint aside">
          {basis}
        </p>
      ))}
    </div>
  );
};
