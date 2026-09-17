import {
  MaxBridgeError,
  type InitData,
  type InitDataUser,
  type MaxFeature,
  type MaxPlatform,
  type ViewportSize,
} from '@maxkit/bridge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBridge } from './provider.js';

export interface LaunchInfo {
  /** Сырая строка запуска: её отправляют на сервер для проверки подписи. */
  initData: string | null;
  /** Разобранные данные. Непроверенные: решения по доступу принимает сервер. */
  initDataUnsafe: InitData;
  platform: MaxPlatform | null;
  version: string | null;
  deviceName: string | null;
  isInsideMax: boolean;
}

/** Параметры запуска приложения. Не меняются за время жизни приложения. */
export const useLaunchParams = (): LaunchInfo => {
  const bridge = useBridge();

  return useMemo(
    () => ({
      initData: bridge.initData,
      initDataUnsafe: bridge.initDataUnsafe,
      platform: bridge.platform,
      version: bridge.version,
      deviceName: bridge.deviceName,
      isInsideMax: bridge.isInsideMax,
    }),
    [bridge],
  );
};

/** Пользователь из параметров запуска. */
export const useMaxUser = (): InitDataUser | undefined => useLaunchParams().initDataUnsafe.user;

/** Поддерживается ли возможность текущим клиентом. */
export const useSupports = (feature: MaxFeature): boolean => {
  const bridge = useBridge();
  return useMemo(() => bridge.supports(feature), [bridge, feature]);
};

export interface BackButtonOptions {
  /** Показывать ли кнопку. */
  visible?: boolean;
  onClick?: () => void;
}

/** Системная кнопка «назад». */
export const useBackButton = ({ visible = true, onClick }: BackButtonOptions = {}): void => {
  const bridge = useBridge();
  const handler = useRef(onClick);
  handler.current = onClick;

  useEffect(() => {
    if (!visible) {
      bridge.BackButton.hide();
      return undefined;
    }

    bridge.BackButton.show();
    const off = bridge.BackButton.onClick(() => handler.current?.());

    return () => {
      off();
      bridge.BackButton.hide();
    };
  }, [bridge, visible]);
};

/** Подтверждение закрытия: включается, пока на экране есть несохранённые изменения. */
export const useClosingConfirmation = (enabled: boolean): void => {
  const bridge = useBridge();

  useEffect(() => {
    if (!enabled) return undefined;

    bridge.enableClosingConfirmation();
    return () => bridge.disableClosingConfirmation();
  }, [bridge, enabled]);
};

export interface AsyncState<T> {
  data: T | undefined;
  /** Причина неудачи, какой бы она ни была. */
  error: unknown;
  loading: boolean;
}

/** Запрос к клиенту MAX с отменой при размонтировании. */
export const useBridgeRequest = <T>(
  request: (signal: AbortSignal) => Promise<T>,
  dependencies: unknown[] = [],
): AsyncState<T> & { reload: () => void } => {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: true });
  const [attempt, setAttempt] = useState(0);
  const call = useRef(request);
  call.current = request;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setState((previous) => ({ ...previous, loading: true }));

    call
      .current(controller.signal)
      .then((data) => {
        if (active) setState({ data, error: undefined, loading: false });
      })
      .catch((error: unknown) => {
        if (!active) return;

        if (error instanceof MaxBridgeError && error.isAborted) return;

        // Неудачное обновление не стирает показанное.
        setState((previous) => ({ data: previous.data, error, loading: false }));
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, ...dependencies]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { ...state, reload };
};

/** Размер области, доступной приложению. */
export const useViewportSize = (): AsyncState<ViewportSize> => {
  const bridge = useBridge();
  return useBridgeRequest((signal) => bridge.getViewportSize({ signal }), [bridge]);
};

export interface StorageState {
  value: string | null;
  loading: boolean;
  error: MaxBridgeError | undefined;
  save: (next: string) => Promise<void>;
  remove: () => Promise<void>;
}

type StorageKind = 'device' | 'secure';

/** Значение из хранилища клиента. */
export const useStorageValue = (key: string, kind: StorageKind = 'device'): StorageState => {
  const bridge = useBridge();
  const storage = kind === 'secure' ? bridge.SecureStorage : bridge.DeviceStorage;

  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MaxBridgeError | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setLoading(true);

    storage
      .getItem(key)
      .then((stored) => {
        if (!active) return;
        setValue(stored);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof MaxBridgeError ? reason : undefined);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [storage, key]);

  const save = useCallback(
    async (next: string) => {
      await storage.setItem(key, next);
      setValue(next);
    },
    [storage, key],
  );

  const remove = useCallback(async () => {
    await storage.removeItem(key);
    setValue(null);
  }, [storage, key]);

  return { value, loading, error, save, remove };
};
