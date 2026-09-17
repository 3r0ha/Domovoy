import { useRef, useState } from 'react';

import { type DomovoyApi } from './api.js';

export interface ApartmentSwitch {
  /** Выбранная квартира; null означает «как решит сервер». */
  apartment: string | null;
  pick: (apartmentId: string) => void;
}

/**
 * Переключение своей квартиры. Запросы идут по очереди, чтобы два быстрых
 * нажатия не разошлись с тем, что показано на экране.
 */
export const useApartment = (api: DomovoyApi, onSwitched: () => void): ApartmentSwitch => {
  const [apartment, setApartment] = useState<string | null>(null);
  const switching = useRef<Promise<void>>(Promise.resolve());

  const pick = (apartmentId: string): void => {
    setApartment(apartmentId);

    switching.current = switching.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await api.useApartment(apartmentId);
          onSwitched();
        } catch {
          const [mine] = await api.ownApartments().catch(() => []);

          setApartment(mine?.id ?? null);
        }
      });
  };

  return { apartment, pick };
};
