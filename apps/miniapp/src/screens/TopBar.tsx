import { formatPublished, type DomovoyApi } from '../api.js';
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

/** Нет связи: что показано на экране и насколько оно старое. */
const Saved = ({ api }: { api: DomovoyApi }) => {
  const at = api.savedAt();

  return (
    <p className="offline-note" role="status">
      Нет связи. {at ? `Показываем сохранённое ${formatPublished(at)}` : 'Показывать пока нечего'}
    </p>
  );
};

/** С какой длины название экрана уже не помещается в строку рядом с помощником. */
const LONG_TITLE = 16;

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
  <header
    className={['topbar', scrolled ? 'topbar-scrolled' : '', title.length > LONG_TITLE ? 'topbar-long' : '']
      .filter(Boolean)
      .join(' ')}
  >
    <div className="topbar-line">
      <h1 className="screen-title">{title}</h1>

      <div className="topbar-acts">
        {onAssistant ? <AssistantButton onOpen={onAssistant} /> : null}

        <button type="button" className="refresh" aria-label="Обновить" onClick={onRefresh}>
          <IconRefresh />
        </button>
      </div>
    </div>

    {/* Связи нет: важно не только это, но и на какой момент показано то, что
        на экране. Значком в углу такое не сказать, поэтому строкой и словами. */}
    {offline ? <Saved api={api} /> : null}

    {/* Дом и квартира идут своей строкой: адрес длинный, а название экрана
        и помощник не должны из-за него ужиматься. */}
    {building || apartment ? (
      <div className="topbar-pickers">
        {building ? <BuildingPicker api={api} value={building.value} onChange={building.onChange} /> : null}
        {apartment ? <ApartmentPicker api={api} value={apartment.value} onChange={apartment.onChange} /> : null}
      </div>
    ) : null}
  </header>
);
