import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/** Итог действия одной строкой. Ошибку видно по цвету. */
export type ToastTone = 'ok' | 'error';

type Show = (text: string, tone?: ToastTone) => void;

const ToastContext = createContext<Show>(() => undefined);

/** Сказать человеку, чем закончилось действие. */
export const useToast = (): Show => useContext(ToastContext);

/** Сколько держится сообщение. Дольше держать нечего: оно короткое. */
const LIFETIME_MS = 2600;

interface Shown {
  text: string;
  tone: ToastTone;
  /** Номер показа: по нему сообщение появляется заново, даже если текст тот же. */
  seq: number;
}

/**
 * Итог действия поверх экрана. Нужен там, где изменение не видно на месте:
 * дверь открылась, работа принята, платёж прошёл.
 */
export const Toasts = ({ children }: { children: ReactNode }) => {
  const [shown, setShown] = useState<Shown | null>(null);
  const seq = useRef(0);

  const show = useCallback<Show>((text, tone = 'ok') => {
    seq.current += 1;
    setShown({ text, tone, seq: seq.current });
  }, []);

  useEffect(() => {
    if (!shown) return undefined;

    const timer = setTimeout(() => setShown(null), LIFETIME_MS);

    return () => clearTimeout(timer);
  }, [shown]);

  return (
    <ToastContext.Provider value={show}>
      {children}

      {shown ? (
        <output
          key={shown.seq}
          className={shown.tone === 'error' ? 'toast toast-bad' : 'toast'}
          onClick={() => setShown(null)}
        >
          {shown.text}
        </output>
      ) : null}
    </ToastContext.Provider>
  );
};
