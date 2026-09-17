import { useBridgeRequest } from '@maxkit/react';

import { type ApartmentView, type DomovoyApi } from '../api.js';

export interface ApartmentPickerProps {
  api: DomovoyApi;
  /** Выбранная квартира. Пусто означает ту, с которой человек работает сейчас. */
  value: string | null;
  onChange: (apartmentId: string) => void;
}

const title = (apartment: ApartmentView): string =>
  apartment.address ? `кв. ${apartment.number} · ${apartment.address}` : `кв. ${apartment.number}`;

/** Выбор квартиры. Показывается, только когда квартир больше одной. */
export const ApartmentPicker = ({ api, value, onChange }: ApartmentPickerProps) => {
  const apartments = useBridgeRequest(() => api.ownApartments().catch(() => []), [api]);
  const all = Array.isArray(apartments.data) ? apartments.data : [];

  if (all.length < 2) return null;

  const current = value ?? all.find((apartment) => apartment.current)?.id ?? '';

  return (
    <select
      className="building"
      aria-label="Квартира"
      value={current}
      onChange={(event) => onChange(event.target.value)}
    >
      {all.map((apartment) => (
        <option key={apartment.id} value={apartment.id}>
          {title(apartment)}
        </option>
      ))}
    </select>
  );
};
