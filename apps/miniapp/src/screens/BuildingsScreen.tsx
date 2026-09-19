import { CellAction, CellInput, CellList, CellSimple } from '@maxhub/max-ui';
import { useBridgeRequest } from '@maxkit/react';
import { useState } from 'react';

import { ApiError, plural, type BuildingLineView, type DomovoyApi } from '../api.js';
import { ErrorText } from './ErrorText.js';
import { Failure } from './Failure.js';
import { Group } from './Group.js';
import { IconHome, IconPlus } from './icons.js';
import { Skeleton } from './Skeleton.js';

export interface BuildingsScreenProps {
  api: DomovoyApi;
  /** Переключить рабочий дом: дальше все списки идут по нему. */
  onPick: (buildingId: string) => void;
  /** Что открывает адрес: карточку дома или его очередь. */
  opens?: 'card' | 'queue';
  /** Управляющий заводит новые адреса сам. */
  canAdd?: boolean;
  /** Заведённый дом пустой: следом заводят список квартир. */
  onAdd?: (buildingId: string) => void;
}

/** Что с домом за месяц: просроченное первым. */
const summary = (line: BuildingLineView): string => {
  if (line.open === 0 && line.overdue === 0) return 'Заявок нет';

  const parts = [
    line.overdue > 0 ? plural(line.overdue, 'просрочена', 'просрочены', 'просрочено') : null,
    plural(line.open, 'открыта', 'открыты', 'открыто'),
    line.inTimeRate === undefined ? null : `в срок ${Math.round(line.inTimeRate * 100)}%`,
    line.averageRating === undefined ? null : `оценка ${line.averageRating}`,
  ];

  return parts.filter(Boolean).join(' · ');
};

/** Дома компании в одном списке. */
export const BuildingsScreen = ({ api, onPick, onAdd, opens = 'queue', canAdd = false }: BuildingsScreenProps) => {
  const report = useBridgeRequest((alive) => api.until(alive).buildingsReport(), [api]);
  const [card, setCard] = useState<{ code: string; address: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (report.loading && !report.data) return <Skeleton count={3} />;

  if (report.error || !report.data) {
    return <Failure title="Дома не загрузились" error={report.error} onRetry={report.reload} />;
  }

  const lines = report.data;

  const add = async (): Promise<void> => {
    if (!card) return;

    setBusy(true);
    setError(null);

    try {
      const created = await api.addBuilding({ code: card.code.trim(), address: card.address.trim() });

      setCard(null);
      (onAdd ?? onPick)(created.id);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="list">
      {lines.length === 0 && !canAdd ? (
        <Group>
          <CellSimple
            before={
              <span className="tile tile-grey">
                <IconHome />
              </span>
            }
            title="Домов нет"
            height="compact"
          />
        </Group>
      ) : null}

      {lines.length > 0 ? (
        <p className="hint aside">
          {opens === 'card' ? 'Адрес открывает карточку дома' : 'Адрес переключает работу на этот дом'}
        </p>
      ) : null}

      {lines.length > 0 ? (
        <CellList mode="island">
          {lines.map((line, index) => (
            <CellSimple
              key={line.buildingId}
              before={
                <span className={line.overdue > 0 ? 'tile tile-red' : 'tile tile-grey'}>
                  <IconHome />
                </span>
              }
              title={`${line.code} · ${line.address}`}
              subtitle={summary(line)}
              separator={index > 0}
              showChevron
              onClick={() => onPick(line.buildingId)}
            />
          ))}
        </CellList>
      ) : null}

      {canAdd && !card ? (
        <Group>
          <CellSimple
            before={
              <span className="tile tile-blue">
                <IconPlus />
              </span>
            }
            title="Завести дом"
            subtitle="Ещё один адрес компании"
            height="compact"
            showChevron
            onClick={() => setCard({ code: '', address: '' })}
          />
        </Group>
      ) : null}

      {canAdd && card ? (
        <Group title="Новый дом">
          <CellInput
            className="field-row"
            id="new-house-code"
            aria-label="Код дома"
            placeholder="Д15"
            before={<span className="cell-label">Код</span>}
            value={card.code}
            onChange={(event) => setCard({ ...card, code: event.target.value })}
          />
          <CellInput
            className="field-row"
            id="new-house-address"
            aria-label="Адрес"
            placeholder="Улица, дом"
            before={<span className="cell-label">Адрес</span>}
            value={card.address}
            onChange={(event) => setCard({ ...card, address: event.target.value })}
          />
          <CellAction mode="primary" disabled={busy || card.code.trim().length === 0} onClick={() => void add()}>
            {busy ? 'Заводим…' : 'Завести'}
          </CellAction>
          <CellAction mode="secondary" disabled={busy} onClick={() => setCard(null)}>
            Отмена
          </CellAction>
        </Group>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      {card ? <p className="hint aside">Код дома идёт в номер заявки: Д15-114</p> : null}
    </section>
  );
};
