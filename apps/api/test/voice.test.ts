import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryRepository, type Resident, type Transcriber } from '@domovoy/app';
import { signInitData } from '@maxkit/bridge';

import { buildServer } from '../dist/index.js';

const BOT_TOKEN = 'voice-bot-token';
const BUILDING_ID = 'b1';

/** Предел записи: столько же, сколько принимает ручка. */
const MAX_VOICE_BYTES = 2 * 1024 * 1024;

const maria: Resident = {
  id: 'res-maria',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  buildingId: BUILDING_ID,
};

const initDataFor = (userId: number): Promise<string> =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `q-${userId}`,
      user: JSON.stringify({ id: userId }),
    },
    BOT_TOKEN,
  );

/** Запись голоса как её присылает мини-приложение. */
const recording = (bytes = 2048): string => Buffer.alloc(bytes, 7).toString('base64');

const setup = async (extra: Partial<Parameters<typeof buildServer>[0]> = {}) => {
  // Часы стоят: предел частоты в тестах считается окном, а не настоящей минутой.
  const clock = 1_000_000;

  const app = await buildServer({
    botToken: BOT_TOKEN,
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15' }],
      apartments: [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1 }],
      residents: [maria],
    }),
    defaultBuildingId: BUILDING_ID,
    rateLimit: { now: () => clock },
    ...extra,
  });

  const login = async (userId: number): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { 'x-max-init-data': await initDataFor(userId) },
    });

    return response.json<{ token: string }>().token;
  };

  return { app, login };
};

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

/** Расшифровщик, который запоминает, что ему дали. */
const heard = (text: string | undefined) => {
  const seen: { kind: string; token: string }[] = [];

  const transcriber: Transcriber = {
    transcribe(attachment) {
      seen.push({ kind: attachment.kind, token: attachment.token });

      return Promise.resolve(text);
    },
  };

  return { transcriber, seen };
};

describe('расшифровка записи голоса', () => {
  it('отдаёт текст того, что человек сказал', async () => {
    const { transcriber, seen } = heard('  Течёт кран на кухне  ');
    const { app, login } = await setup({ transcriber });
    const data = recording();

    const response = await app.inject({
      method: 'POST',
      url: '/api/voice',
      headers: authed(await login(1001)),
      payload: { contentType: 'audio/ogg', data },
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { text: 'Течёт кран на кухне' });

    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.kind, 'voice');
    assert.equal(seen[0]?.token, `data:audio/ogg;base64,${data}`, 'запись ушла расшифровщику целиком');

    await app.close();
  });

  it('запись нигде не остаётся: прочитать её потом нельзя', async () => {
    const { transcriber } = heard('Нет горячей воды');
    const { app, login } = await setup({ transcriber });
    const token = await login(1001);

    const response = await app.inject({
      method: 'POST',
      url: '/api/voice',
      headers: authed(token),
      payload: { contentType: 'audio/ogg', data: recording() },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(Object.keys(response.json()).join(), 'text', 'в ответе только расшифровка');

    await app.close();
  });

  it('речь не разобрана: отказ с понятным кодом, а не пустая строка', async () => {
    const { transcriber } = heard(undefined);
    const { app, login } = await setup({ transcriber });

    const response = await app.inject({
      method: 'POST',
      url: '/api/voice',
      headers: authed(await login(1001)),
      payload: { contentType: 'audio/ogg', data: recording() },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'speech_not_recognized');

    await app.close();
  });

  it('отказ службы расшифровки наружу подробностями не уходит', async () => {
    const transcriber: Transcriber = {
      transcribe: () => Promise.reject(new Error('служба молчит')),
    };
    const { app, login } = await setup({ transcriber });

    const response = await app.inject({
      method: 'POST',
      url: '/api/voice',
      headers: authed(await login(1001)),
      payload: { contentType: 'audio/ogg', data: recording() },
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'speech_unavailable');

    await app.close();
  });

  it('без расшифровщика ручка отвечает, что её нечем обслужить', async () => {
    const { app, login } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/api/voice',
      headers: authed(await login(1001)),
      payload: { contentType: 'audio/ogg', data: recording() },
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'speech_unavailable');

    await app.close();
  });

  it('слишком длинная запись не принимается', async () => {
    const { transcriber, seen } = heard('Сказано много');
    const { app, login } = await setup({ transcriber });

    const response = await app.inject({
      method: 'POST',
      url: '/api/voice',
      headers: authed(await login(1001)),
      payload: { contentType: 'audio/ogg', data: recording(MAX_VOICE_BYTES + 1) },
    });

    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error, 'payload_too_long');
    assert.equal(seen.length, 0, 'до расшифровки дело не дошло');

    await app.close();
  });

  it('тело сверх предела ручки отвечает тем же кодом', async () => {
    const { transcriber } = heard('Сказано много');
    const { app, login } = await setup({ transcriber });

    const response = await app.inject({
      method: 'POST',
      url: '/api/voice',
      headers: { ...authed(await login(1001)), 'content-type': 'application/json' },
      payload: JSON.stringify({ contentType: 'audio/ogg', data: 'A'.repeat(4 * 1024 * 1024) }),
    });

    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error, 'payload_too_long');

    await app.close();
  });

  it('пустая запись и чужой формат не принимаются', async () => {
    const { transcriber } = heard('Неважно');
    const { app, login } = await setup({ transcriber });
    const token = await login(1001);

    const empty = await app.inject({
      method: 'POST',
      url: '/api/voice',
      headers: authed(token),
      payload: { contentType: 'audio/ogg', data: '' },
    });

    assert.equal(empty.statusCode, 400);
    assert.equal(empty.json().error, 'file_empty');

    const photo = await app.inject({
      method: 'POST',
      url: '/api/voice',
      headers: authed(token),
      payload: { contentType: 'image/jpeg', data: recording() },
    });

    assert.equal(photo.statusCode, 400);
    assert.equal(photo.json().error, 'file_type_not_allowed');

    await app.close();
  });

  it('без сессии и с чужим токеном расшифровка закрыта', async () => {
    const { transcriber, seen } = heard('Течёт кран');
    const { app } = await setup({ transcriber });

    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/voice',
      payload: { contentType: 'audio/ogg', data: recording() },
    });

    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.json().error, 'session_missing');

    const stranger = await app.inject({
      method: 'POST',
      url: '/api/voice',
      headers: authed('чужой-токен'),
      payload: { contentType: 'audio/ogg', data: recording() },
    });

    assert.equal(stranger.statusCode, 401);
    assert.equal(stranger.json().error, 'session_invalid');
    assert.equal(seen.length, 0, 'запись чужого до расшифровки не доходит');

    await app.close();
  });

  it('расшифровка считается дорогим маршрутом', async () => {
    const { transcriber } = heard('Течёт кран');
    const { app, login } = await setup({
      transcriber,
      rateLimit: { heavy: { limit: 2, windowMs: 60_000 } },
    });
    const token = await login(1001);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/voice',
        headers: authed(token),
        payload: { contentType: 'audio/ogg', data: recording() },
      });

      assert.equal(response.statusCode, 200, `расшифровка ${attempt + 1} отклонена преждевременно`);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/voice',
      headers: authed(token),
      payload: { contentType: 'audio/ogg', data: recording() },
    });

    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().error, 'too_many_requests');

    const usual = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });

    assert.notEqual(usual.statusCode, 429, 'обычная работа тем же пределом не закрывается');

    await app.close();
  });
});
