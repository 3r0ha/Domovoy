import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

after(async () => {
  await GlobalRegistrator.unregister();
});

const { createMockBridge } = await import('@maxkit/bridge/mock');
const { MaxProvider } = await import('@maxkit/react');
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { DomovoyApi } = await import('../dist-test/api.js');
const { useSession } = await import('../dist-test/session.js');

type SessionState = ReturnType<typeof useSession>;

interface Reply {
  status: number;
  body: unknown;
}

const stubFetch = (replies: Record<string, Reply | Reply[]>) => {
  const calls: string[] = [];
  const queues = new Map<string, Reply[]>(
    Object.entries(replies).map(([path, reply]) => [path, Array.isArray(reply) ? [...reply] : [reply]]),
  );

  const fetchStub = (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace('http://api.test', '');
    calls.push(path);

    const queue = queues.get(path) ?? [];
    const reply = (queue.length > 1 ? queue.shift() : queue[0]) ?? { status: 404, body: {} };

    return Promise.resolve(
      new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { fetchStub, calls };
};

/** Держит последнее состояние входа и позволяет дождаться выхода из загрузки. */
const renderSession = async (options: {
  api: InstanceType<typeof DomovoyApi>;
  initData: string | null;
  bridge: unknown;
}) => {
  const states: SessionState[] = [];

  const Probe = () => {
    states.push(useSession(options.api, options.initData));
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container) as unknown as { render: (node: unknown) => void; unmount: () => void };

  await act(async () => {
    root.render(
      createElement(
        MaxProvider as never,
        { bridge: options.bridge, autoReady: false } as never,
        createElement(Probe),
      ),
    );
  });

  await act(async () => {
    await Promise.resolve();
  });

  return {
    get state(): SessionState {
      return states.at(-1)!;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const PROFILE = { id: 'res-1', displayName: 'Мария', role: 'resident', apartmentId: 'apt-1' };

describe('вход в мини-приложение', () => {
  it('обменивает параметры запуска на токен и запоминает его', async () => {
    const { bridge } = createMockBridge();
    const { fetchStub, calls } = stubFetch({
      '/auth/session': { status: 200, body: { token: 'tok-1', expiresAt: 0, displayName: 'Мария' } },
      '/api/me': { status: 200, body: PROFILE },
    });

    const api = new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub });
    const session = await renderSession({ api, initData: 'auth_date=1&hash=x', bridge });

    assert.equal(session.state.status, 'ready');
    assert.deepEqual(calls, ['/auth/session', '/api/me']);
    assert.equal(await bridge.SecureStorage.getItem('session-token'), 'tok-1');

    await session.unmount();
  });

  it('сохранённый токен избавляет от повторного обмена', async () => {
    const { bridge } = createMockBridge();
    await bridge.SecureStorage.setItem('session-token', 'tok-saved');

    const { fetchStub, calls } = stubFetch({ '/api/me': { status: 200, body: PROFILE } });
    const api = new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub });

    const session = await renderSession({ api, initData: 'auth_date=1&hash=x', bridge });

    assert.equal(session.state.status, 'ready');
    assert.deepEqual(calls, ['/api/me'], 'строка запуска по сети не пошла');

    await session.unmount();
  });

  it('протухший токен молча заменяется новым', async () => {
    const { bridge } = createMockBridge();
    await bridge.SecureStorage.setItem('session-token', 'tok-expired');

    const { fetchStub, calls } = stubFetch({
      '/api/me': [
        { status: 401, body: { error: 'session_expired', message: 'Сессия истекла' } },
        { status: 200, body: PROFILE },
      ],
      '/auth/session': { status: 200, body: { token: 'tok-2', expiresAt: 0, displayName: 'Мария' } },
    });

    const api = new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub });
    const session = await renderSession({ api, initData: 'auth_date=1&hash=x', bridge });

    assert.equal(session.state.status, 'ready');
    assert.deepEqual(calls, ['/api/me', '/auth/session', '/api/me']);
    assert.equal(await bridge.SecureStorage.getItem('session-token'), 'tok-2');

    await session.unmount();
  });

  it('без параметров запуска объясняет, что приложение открыто вне MAX', async () => {
    const { bridge } = createMockBridge();
    const { fetchStub } = stubFetch({});
    const api = new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub });

    const session = await renderSession({ api, initData: null, bridge });
    const state = session.state;

    assert.equal(state.status, 'error');
    assert.match(state.status === 'error' ? state.message : '', /вне MAX/);

    await session.unmount();
  });

  it('отказ сервера показывается с возможностью повторить', async () => {
    const { bridge } = createMockBridge();
    const { fetchStub } = stubFetch({
      '/auth/session': { status: 500, body: { error: 'internal', message: 'Сервер не отвечает' } },
    });

    const api = new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub });
    const session = await renderSession({ api, initData: 'auth_date=1&hash=x', bridge });
    const state = session.state;

    assert.equal(state.status, 'error');
    assert.equal(typeof (state.status === 'error' ? state.retry : undefined), 'function');

    await session.unmount();
  });

  it('недоступное хранилище клиента вход не ломает', async () => {
    const { bridge } = createMockBridge();

    bridge.SecureStorage.getItem = () => Promise.reject(new Error('unsupported'));
    bridge.SecureStorage.setItem = () => Promise.reject(new Error('unsupported'));

    const { fetchStub, calls } = stubFetch({
      '/auth/session': { status: 200, body: { token: 'tok-3', expiresAt: 0, displayName: 'Мария' } },
      '/api/me': { status: 200, body: PROFILE },
    });

    const api = new DomovoyApi({ baseUrl: 'http://api.test', fetch: fetchStub });
    const session = await renderSession({ api, initData: 'auth_date=1&hash=x', bridge });

    assert.equal(session.state.status, 'ready');
    assert.deepEqual(calls, ['/auth/session', '/api/me']);

    await session.unmount();
  });
});
