import { type MaxBridge, createBridge, type BridgeOptions } from '@maxkit/bridge';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const BridgeContext = createContext<MaxBridge | null>(null);

export interface MaxProviderProps extends BridgeOptions {
  children: ReactNode;
  /** Готовый мост: подставляется в тестах и на стенде. */
  bridge?: MaxBridge;
  /** Сообщать клиенту о готовности приложения автоматически. */
  autoReady?: boolean;
}

/** Держит единственный мост на всё приложение. */
export const MaxProvider = ({ children, bridge, autoReady = true, ...options }: MaxProviderProps) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const created = useMemo(() => bridge ?? createBridge(options), [bridge]);

  const [instance, setInstance] = useState(created);

  useEffect(() => {
    if (instance.isDestroyed && !bridge) {
      setInstance(createBridge(options));
      return undefined;
    }

    if (autoReady) instance.ready();

    return () => {
      if (!bridge) instance.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, autoReady, bridge]);

  return <BridgeContext.Provider value={instance}>{children}</BridgeContext.Provider>;
};

/** @throws если компонент отрисован вне `MaxProvider`. */
export const useBridge = (): MaxBridge => {
  const bridge = useContext(BridgeContext);
  if (!bridge) throw new Error('useBridge: компонент должен быть внутри MaxProvider');

  return bridge;
};

/** Мост или `null`, если провайдера нет: для компонентов, работающих и вне MAX. */
export const useOptionalBridge = (): MaxBridge | null => useContext(BridgeContext);
