import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { InMemoryRepository } from '@domovoy/app';
import { BOT_API_SECRET_HEADER, WebhookReceiver } from '@maxkit/runtime';

import { buildServer } from '../dist/index.js';

const BUILDING_ID = 'b1';
const SECRET = 'секрет-не-по-ascii-нельзя';

interface Harness {
  app: FastifyInstance;
  /** Апдейты, дошедшие до цепочки обработчиков бота. */
  seen: unknown[];
  receiver: WebhookReceiver;
}

const setup = async (secret = 'webhook-secret'): Promise<Harness> => {
  const seen: unknown[] = [];
  const receiver = new WebhookReceiver({ secret, handleUpdate: async (update) => void seen.push(update) });

  const app = await buildServer({
    botToken: 'updates-bot-token',
    repository: new InMemoryRepository({ buildings: [{ id: BUILDING_ID, code: 'Д15' }] }),
    defaultBuildingId: BUILDING_ID,
    updates: { receiver, header: BOT_API_SECRET_HEADER },
  });

  return { app, seen, receiver };
};

const update = (id: string): Record<string, unknown> => ({
  update_type: 'message_created',
  timestamp: Date.now(),
  message: { body: { mid: id, text: 'Течёт кран' } },
});

describe('приём апдейтов по вебхуку', () => {
  it('принимает апдейт с верным секретом и отдаёт его боту', async () => {
    const { app, seen, receiver } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/bot/updates',
      headers: { [BOT_API_SECRET_HEADER]: 'webhook-secret' },
      payload: update('mid-1'),
    });

    assert.equal(response.statusCode, 200);

    await receiver.drain();

    assert.equal(seen.length, 1);
    assert.equal((seen[0] as { update_type: string }).update_type, 'message_created');

    await app.close();
  });

  it('без секрета не читает даже тело запроса', async () => {
    const { app, seen } = await setup();

    const response = await app.inject({ method: 'POST', url: '/bot/updates', payload: update('mid-2') });

    assert.equal(response.statusCode, 401);
    assert.equal(seen.length, 0);

    const wrong = await app.inject({
      method: 'POST',
      url: '/bot/updates',
      headers: { [BOT_API_SECRET_HEADER]: 'чужой' },
      payload: update('mid-3'),
    });

    assert.equal(wrong.statusCode, 401);
    assert.equal(seen.length, 0);

    await app.close();
  });

  it('повторная доставка не заводит вторую заявку', async () => {
    const { app, seen, receiver } = await setup();
    const same = update('mid-4');

    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await app.inject({
        method: 'POST',
        url: '/bot/updates',
        headers: { [BOT_API_SECRET_HEADER]: 'webhook-secret' },
        payload: same,
      });

      assert.equal(response.statusCode, 200);
    }

    await receiver.drain();

    assert.equal(seen.length, 1);
    assert.equal(receiver.stats.duplicates, 2);

    await app.close();
  });

  it('поток апдейтов не упирается в предел частоты, рассчитанный на человека', async () => {
    const { app, receiver } = await setup();

    for (let sent = 0; sent < 80; sent++) {
      const response = await app.inject({
        method: 'POST',
        url: '/bot/updates',
        headers: { [BOT_API_SECRET_HEADER]: 'webhook-secret' },
        payload: update(`mid-flood-${sent}`),
      });

      assert.equal(response.statusCode, 200, `апдейт ${sent} отклонён`);
    }

    await receiver.drain();

    assert.equal(receiver.stats.accepted, 80);

    await app.close();
  });

  it('без настроенного приёмника адреса вебхука нет', async () => {
    const app = await buildServer({
      botToken: 'updates-bot-token',
      repository: new InMemoryRepository({ buildings: [{ id: BUILDING_ID, code: 'Д15' }] }),
      defaultBuildingId: BUILDING_ID,
    });

    assert.equal((await app.inject({ method: 'POST', url: '/bot/updates' })).statusCode, 404);

    await app.close();
  });

  it('секрет с кириллицей отвергается сразу: заголовок его не переживёт', () => {
    assert.throws(() => new WebhookReceiver({ secret: SECRET, handleUpdate: async () => undefined }), /ASCII/);
  });
});
