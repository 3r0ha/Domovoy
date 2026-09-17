import { useBridge } from '@maxkit/react';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, describeFailure, type DomovoyApi, type Profile } from './api.js';

const TOKEN_KEY = 'session-token';

export type SessionState =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'ready'; profile: Profile; refresh: () => void };

/** Вход в приложение. */
export const useSession = (api: DomovoyApi, initData: string | null): SessionState => {
  const bridge = useBridge();
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let active = true;

    const fail = (message: string): void => {
      if (active) setState({ status: 'error', message, retry });
    };

    const loadProfile = async (): Promise<Profile> => api.me();

    const enter = async (): Promise<void> => {
      setState({ status: 'loading' });

      const saved = await bridge.SecureStorage.getItem(TOKEN_KEY).catch(() => null);

      if (saved) {
        api.useToken(saved);

        try {
          const profile = await loadProfile();
          if (active) setState({ status: 'ready', profile, refresh: retry });
          return;
        } catch (error) {
          if (!(error instanceof ApiError) || !error.isUnauthorized) throw error;
          api.useToken(null);
        }
      }

      if (!initData) {
        fail('Приложение открыто вне MAX: параметры запуска недоступны');
        return;
      }

      const issued = await api.login(initData);
      await bridge.SecureStorage.setItem(TOKEN_KEY, issued.token).catch(() => undefined);

      const profile = await loadProfile();
      if (active) setState({ status: 'ready', profile, refresh: retry });
    };

    enter().catch((error: unknown) => fail(describeFailure(error)));

    return () => {
      active = false;
    };
  }, [api, bridge, initData, attempt, retry]);

  return state;
};
