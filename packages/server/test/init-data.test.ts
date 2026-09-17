import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signInitData } from '@maxkit/bridge';
import Fastify from 'fastify';

import { InitDataError, maxAuth, validateInitData } from '../dist/index.js';

const BOT_TOKEN = 'bot-token-for-tests';

const makeInitData = (overrides: Record<string, string | number> = {}, token = BOT_TOKEN): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: 'q-1',
      user: JSON.stringify({ id: 424_242, first_name: 'Жилец', username: 'zhilec' }),
      chat: JSON.stringify({ id: 7, type: 'DIALOG' }),
      ...overrides,
    },
    token,
  );

const expectError = (fn: () => unknown, code: string): void => {
  try {
    fn();
    assert.fail(`ожидалась ошибка ${code}`);
  } catch (error) {
    assert.ok(error instanceof InitDataError, `не InitDataError: ${String(error)}`);
    assert.equal(error.code, code);
  }
};

describe('validateInitData', () => {
  it('пропускает корректно подписанные данные', async () => {
    const initData = await makeInitData();
    const result = validateInitData(initData, { botToken: BOT_TOKEN });

    assert.equal(result.userId, 424_242);
    assert.equal(result.data.user?.username, 'zhilec');
    assert.equal(result.data.chat?.id, 7);
  });

  it('значение start_param не подменяет пользователя', async () => {
    const forged = JSON.stringify({ id: 999 });
    const initData = await makeInitData({ start_param: `a&user=${forged}` });

    const result = validateInitData(initData, { botToken: BOT_TOKEN });

    assert.equal(result.userId, 424_242, 'пользователь взят из подписанного параметра');
    assert.equal(result.data.start_param, `a&user=${forged}`, 'значение осталось значением');
  });

  it('отклоняет подмену идентификатора пользователя', async () => {
    const initData = await makeInitData();
    const tampered = initData.replace('424242', '999999');

    assert.notEqual(tampered, initData);
    expectError(() => validateInitData(tampered, { botToken: BOT_TOKEN }), 'init_data_invalid_hash');
  });

  it('отклоняет подпись чужим токеном', async () => {
    const initData = await makeInitData({}, 'чужой-токен');
    expectError(() => validateInitData(initData, { botToken: BOT_TOKEN }), 'init_data_invalid_hash');
  });

  it('отклоняет просроченные параметры запуска', async () => {
    const initData = await makeInitData({ auth_date: Math.floor(Date.now() / 1000) - 7200 });
    expectError(() => validateInitData(initData, { botToken: BOT_TOKEN, maxAgeSeconds: 3600 }), 'init_data_expired');
  });

  it('отклоняет auth_date из будущего', async () => {
    const initData = await makeInitData({ auth_date: Math.floor(Date.now() / 1000) + 3600 });
    expectError(() => validateInitData(initData, { botToken: BOT_TOKEN }), 'init_data_malformed');
  });

  it('отклоняет второй параметр hash', async () => {
    const initData = `${await makeInitData()}&hash=deadbeef`;
    expectError(() => validateInitData(initData, { botToken: BOT_TOKEN }), 'init_data_malformed');
  });

  it('отклоняет пустую строку', () => {
    expectError(() => validateInitData('', { botToken: BOT_TOKEN }), 'init_data_missing');
  });

  it('требует идентификатор пользователя', async () => {
    const initData = await signInitData({ auth_date: Math.floor(Date.now() / 1000) }, BOT_TOKEN);
    expectError(() => validateInitData(initData, { botToken: BOT_TOKEN }), 'init_data_malformed');
  });
});

describe('плагин maxAuth для Fastify', () => {
  const buildApp = async () => {
    const app = Fastify();

    await app.register(async (scope) => {
      await scope.register(maxAuth, { botToken: BOT_TOKEN });
      scope.get('/me', async (request) => ({ userId: request.max.userId }));
    });

    app.get('/health', async () => ({ status: 'ok' }));
    return app;
  };

  it('пускает запрос с валидной подписью и отдаёт userId', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-max-init-data': await makeInitData() },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { userId: 424_242 });
    await app.close();
  });

  it('возвращает 401 без заголовка', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/me' });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'init_data_missing');
    await app.close();
  });

  it('не трогает маршруты вне своей области видимости', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    assert.equal(response.statusCode, 200, 'публичный маршрут остаётся публичным');
    await app.close();
  });
});
