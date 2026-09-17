import { useOptionalBridge } from '@maxkit/react';
import { useMemo } from 'react';

export interface Haptics {
  /** Дело сделано: заявка ушла, работа принята, показание принято. */
  done: () => void;
  /** Не получилось: отказ сервера или незаполненное поле. */
  failed: () => void;
  /** Выбор изменился: вкладка, отбор, оценка. */
  picked: () => void;
}

/** Тактильная отдача. */
export const useHaptics = (): Haptics => {
  const bridge = useOptionalBridge();

  return useMemo(
    () => ({
      done: () => bridge?.HapticFeedback.notificationOccurred('success'),
      failed: () => bridge?.HapticFeedback.notificationOccurred('error'),
      picked: () => bridge?.HapticFeedback.selectionChanged(),
    }),
    [bridge],
  );
};
