import { useBridgeRequest } from '@maxkit/react';

import type { Translate } from '@domovoy/i18n';

import { type ApartmentView, type DomovoyApi } from '../api.js';
import { useT } from '../i18n.js';
import { RetryLink } from './Retry.js';

export interface ApartmentPickerProps {
  api: DomovoyApi;
  /** Выбранная квартира. Пусто означает ту, с которой человек работает сейчас. */
  value: string | null;
  onChange: (apartmentId: string) => void;
}

/**
 * Подпись выбора: номер квартиры и адрес дома. Одного номера мало, первая
 * квартира бывает в каждом доме, а человеку нужно понять, о каком он смотрит.
 */
const title = (apartment: ApartmentView, t: Translate): string =>
  apartment.address
    ? t('chrome.apartment.at', { номер: apartment.number, адрес: apartment.address })
    : t('chrome.apartment', { номер: apartment.number });

/** Выбор квартиры. Показывается, только когда квартир больше одной. */
export const ApartmentPicker = ({ api, value, onChange }: ApartmentPickerProps) => {
  const t = useT();
  const apartments = useBridgeRequest((alive) => api.until(alive).ownApartments(), [api]);
  const all = Array.isArray(apartments.data) ? apartments.data : [];

  // Одна квартира выбора не требует, но человеку нужно видеть, о какой речь:
  // вместо списка остаётся строка адреса.
  if (all.length === 1) return <span className="building building-one">{title(all[0]!, t)}</span>;

  // Отказ сети без этой строки читается как «квартир нет»: выбор просто пропадает.
  if (all.length === 0 && apartments.error) {
    return <RetryLink title={t('chrome.apartments.failed')} onRetry={apartments.reload} />;
  }

  if (all.length === 0) return null;

  const current = value ?? all.find((apartment) => apartment.current)?.id ?? '';

  return (
    <select
      className="building"
      aria-label={t('chrome.apartment.pick')}
      value={current}
      onChange={(event) => onChange(event.target.value)}
    >
      {all.map((apartment) => (
        <option key={apartment.id} value={apartment.id}>
          {title(apartment, t)}
        </option>
      ))}
    </select>
  );
};
