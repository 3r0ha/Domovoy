import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MaxBridgeError,
  buildDataCheckString,
  computeInitDataHash,
  createBridge,
  parseInitData,
  signInitData,
} from '../dist/index.js';
import { MockMaxClient, createMockBridge, createSignedMockLaunchParams } from '../dist/mock.js';

describe('parseInitData', () => {
  it('разбирает пользователя, чат и время', () => {
    const raw = new URLSearchParams({
      auth_date: '1756800000',
      query_id: 'q-1',
      start_param: 'request_42',
      user: JSON.stringify({ id: '77', first_name: 'Иван', username: 'ivan' }),
      chat: JSON.stringify({ id: 5, type: 'CHAT' }),
      hash: 'deadbeef',
    }).toString();

    const parsed = parseInitData(raw);

    assert.equal(parsed.auth_date, 1_756_800_000);
    assert.equal(parsed.query_id, 'q-1');
    assert.equal(parsed.start_param, 'request_42');
    assert.equal(parsed.user?.id, 77, 'id пользователя приводится к числу');
    assert.equal(parsed.user?.first_name, 'Иван');
    assert.deepEqual(parsed.chat, { id: 5, type: 'CHAT' });
    assert.equal(parsed.hash, 'deadbeef');
  });

  it('не падает на пустых и битых данных', () => {
    assert.deepEqual(parseInitData(null), {});
    assert.deepEqual(parseInitData(''), {});
    assert.equal(parseInitData('user=%7Bбитый').user, undefined);
  });
});

describe('запрос, ответ', () => {
  it('проходит полный цикл через эмулятор клиента', async () => {
    const { bridge } = createMockBridge();

    await bridge.DeviceStorage.setItem('draft', 'заявка по лифту');
    assert.equal(await bridge.DeviceStorage.getItem('draft'), 'заявка по лифту');

    await bridge.DeviceStorage.removeItem('draft');
    assert.equal(await bridge.DeviceStorage.getItem('draft'), null, 'удалённый ключ читается как null');
  });

  it('подмешивает query_id в запросы к хранилищу', async () => {
    const seen: Record<string, unknown>[] = [];
    const { bridge } = createMockBridge({
      queryId: 'q-777',
      onEvent: (_type, payload) => void seen.push(payload),
    });

    await bridge.SecureStorage.setItem('token', 'secret');

    assert.equal(seen[0]?.['queryId'], 'q-777');
  });

  it('превращает ошибку клиента в MaxBridgeError', async () => {
    const { bridge } = createMockBridge({
      handlers: {
        WebAppRequestPhone: () => {
          throw { code: 'client.request_phone.permission_denied' };
        },
      },
    });

    const error = await bridge.requestContact().then(
      () => null,
      (reason: unknown) => reason,
    );

    assert.ok(error instanceof MaxBridgeError);
    assert.equal(error.code, 'client.request_phone.permission_denied');
    assert.equal(error.isPermissionDenied, true);
  });

  it('отклоняет запрос по таймауту', async () => {
    const { bridge } = createMockBridge({
      handlers: {
        WebAppGetViewportSize: () => new Promise(() => undefined),
      },
    });

    const error = await bridge.request('WebAppGetViewportSize', {}, { timeout: 30 }).then(
      () => null,
      (reason: unknown) => reason,
    );

    assert.ok(error instanceof MaxBridgeError);
    assert.equal(error.code, 'client.get_viewport_size.request_timeout');
    assert.equal(error.isTimeout, true);
  });
});

describe('события клиента', () => {
  it('доставляет нажатие системной кнопки «назад»', () => {
    const { bridge, client } = createMockBridge();
    let pressed = 0;

    const off = bridge.BackButton.onClick(() => {
      pressed += 1;
    });

    bridge.BackButton.show();
    assert.equal(client.state.backButtonVisible, true);

    client.pressBackButton();
    assert.equal(pressed, 1);

    off();
    client.pressBackButton();
    assert.equal(pressed, 1, 'после отписки обработчик не вызывается');
  });
});

describe('shareMaxContent', () => {
  it('раскладывает mid на chatId и messageId', async () => {
    const client = new MockMaxClient();
    const bridge = createBridge({ transport: client.transport, launchParams: { initData: null, initDataUnsafe: {}, platform: 'web', version: null, deviceName: null } });

    await bridge.shareMaxContent({ mid: 'mid.00000000000000010000000000000002', chatType: 'DIALOG' });

    const sent = client.log.find((entry) => entry.type === 'WebAppMaxShare' && entry.direction === 'out');
    assert.equal(sent?.payload['chatId'], '1');
    assert.equal(sent?.payload['messageId'], '2');
  });

  it('для группового чата вычитает 2^64 из chatId', async () => {
    const client = new MockMaxClient();
    const bridge = createBridge({ transport: client.transport, launchParams: { initData: null, initDataUnsafe: {}, platform: 'web', version: null, deviceName: null } });

    await bridge.shareMaxContent({ mid: 'mid.00000000000000010000000000000002', chatType: 'CHAT' });

    const sent = client.log.find((entry) => entry.type === 'WebAppMaxShare' && entry.direction === 'out');
    assert.equal(sent?.payload['chatId'], (1n - 2n ** 64n).toString());
  });
});

describe('подпись initData', () => {
  it('строка проверки собирается по алфавиту и без hash', () => {
    const { dataCheckString, hash, hashCount } = buildDataCheckString('user=%7B%22id%22%3A1%7D&auth_date=10&hash=abc');

    assert.equal(dataCheckString, 'auth_date=10\nuser={"id":1}');
    assert.equal(hash, 'abc');
    assert.equal(hashCount, 1);
  });

  it('подписанные данные проходят проверку тем же токеном', async () => {
    const token = 'test-bot-token';
    const initData = await signInitData({ auth_date: 1_756_800_000, query_id: 'q-1' }, token);

    const { dataCheckString, hash } = buildDataCheckString(initData);
    assert.equal(await computeInitDataHash(dataCheckString, token), hash);
    assert.notEqual(await computeInitDataHash(dataCheckString, 'другой-токен'), hash);
  });

  it('эмулятор умеет отдавать подписанные параметры запуска', async () => {
    const params = await createSignedMockLaunchParams('test-bot-token', { startParam: 'meter_42' });

    assert.equal(params.initDataUnsafe.start_param, 'meter_42');
    const { dataCheckString, hash } = buildDataCheckString(params.initData ?? '');
    assert.equal(await computeInitDataHash(dataCheckString, 'test-bot-token'), hash);
  });
});
