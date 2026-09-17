import { type DomovoyApi } from '../api.js';
import { ApartmentPicker } from './ApartmentPicker.js';
import { AssistantButton } from './Assistant.js';
import { BuildingPicker } from './BuildingPicker.js';
import { IconRefresh } from './icons.js';

export interface TopBarProps {
  api: DomovoyApi;
  title: string;
  /** Уехала ли страница под шапку: от этого зависит разделитель. */
  scrolled: boolean;
  /** Сохранённый ответ вместо свежего: связи нет. */
  offline: boolean;
  /** Дом смены, если его выбирают на этом экране. */
  building?: { value: string | null; onChange: (buildingId: string | null) => void };
  /** Своя квартира, если экран про неё. */
  apartment?: { value: string | null; onChange: (apartmentId: string) => void };
  onRefresh: () => void;
  /** Помощник: до согласия с документами его в шапке нет. */
  onAssistant?: () => void;
}

/** Шапка: название экрана, переключатели дома и квартиры, обновление. */
export const TopBar = ({
  api,
  title,
  scrolled,
  offline,
  building,
  apartment,
  onRefresh,
  onAssistant,
}: TopBarProps) => (
  <header className={scrolled ? 'topbar topbar-scrolled' : 'topbar'}>
    <h1 className="screen-title">{title}</h1>

    {building ? <BuildingPicker api={api} value={building.value} onChange={building.onChange} /> : null}

    {apartment ? <ApartmentPicker api={api} value={apartment.value} onChange={apartment.onChange} /> : null}

    {offline ? (
      <span className="badge badge-offline" role="status">
        нет связи
      </span>
    ) : null}

    <div className="topbar-acts">
      {onAssistant ? <AssistantButton onOpen={onAssistant} /> : null}

      <button type="button" className="refresh" aria-label="Обновить" onClick={onRefresh}>
        <IconRefresh />
      </button>
    </div>
  </header>
);
