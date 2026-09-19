import { useBridgeRequest } from '@maxkit/react';

import { type BuildingView, type DomovoyApi } from '../api.js';
import { RetryLink } from './Retry.js';

export interface BuildingPickerProps {
  api: DomovoyApi;
  /** Выбранный дом. Пусто означает дом, к которому человек привязан. */
  value: string | null;
  onChange: (buildingId: string | null) => void;
}

const title = (building: BuildingView): string => `${building.code} · ${building.address}`;

/** Выбор дома. Показывается, только когда домов больше одного. */
export const BuildingPicker = ({ api, value, onChange }: BuildingPickerProps) => {
  const buildings = useBridgeRequest((alive) => api.until(alive).buildings(), [api]);
  const all = buildings.data ?? [];

  // С одним домом выбирать нечего, но адрес на экране нужен: по нему видно,
  // за какой дом идёт очередь и сводка.
  if (all.length === 1) return <span className="building building-one">{title(all[0]!)}</span>;

  // Отказ сети без этой строки читается как «домов нет»: выбор просто пропадает.
  if (all.length === 0 && buildings.error) {
    return <RetryLink title="Дома не загрузились" onRetry={buildings.reload} />;
  }

  if (all.length === 0) return null;

  const current = value ?? all.find((building) => building.current)?.id ?? '';

  return (
    <select
      className="building"
      aria-label="Дом"
      value={current}
      onChange={(event) => onChange(event.target.value)}
    >
      {all.map((building) => (
        <option key={building.id} value={building.id}>
          {title(building)}
        </option>
      ))}
    </select>
  );
};
