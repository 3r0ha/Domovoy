import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WebhookReceiver, type UpdateLike } from '../dist/index.js';

const SECRET = 'webhook-secret-42';

const message = (chatId: number, text: string, mid = `mid.${text}`): string =>
  JSON.stringify({
    update_type: 'message_created',
    timestamp: 1_756_800_000,
    message: { recipient: { chat_id: chatId }, body: { mid, text } },
  });

const textOf = (update: UpdateLike): string =>
  String((update['message'] as { body: { text: string } }).body.text);

describe('приём вебхука', () => {
  it('принимает апдейт с верным секретом', async () => {
    const handled: string[] = [];
    const receiver = new WebhookReceiver({
      secret: SECRET,
      handleUpdate: async (update) => void handled.push(textOf(update)),
    });

    const result = receiver.receive(message(1, 'течёт кран'), SECRET);
    await receiver.drain();

    assert.deepEqual(result, { status: 200, body: 'OK' });
    assert.deepEqual(handled, ['течёт кран']);
    assert.equal(receiver.stats.processed, 1);
  });

  it('отклоняет запрос с чужим или отсутствующим секретом', () => {
    const receiver = new WebhookReceiver({ secret: SECRET, handleUpdate: async () => undefined });

    assert.equal(receiver.receive(message(1, 'подделка'), 'another-secret-9').status, 401);
    assert.equal(receiver.receive(message(1, 'подделка'), undefined).status, 401);
    assert.equal(receiver.receive(message(1, 'подделка'), 'short').status, 401);
    assert.equal(receiver.stats.accepted, 0);
    assert.equal(receiver.stats.rejected, 3);
  });

  it('требует секрет при создании', () => {
    assert.throws(() => new WebhookReceiver({ secret: '', handleUpdate: async () => undefined }), /секрет обязателен/);
  });

  it('отвергает тело сверх предела', () => {
    const receiver = new WebhookReceiver({
      secret: SECRET,
      handleUpdate: async () => undefined,
      maxBodyBytes: 64,
    });

    const result = receiver.receive(message(1, 'а'.repeat(200)), SECRET);

    assert.equal(result.status, 413);
  });

  it('отвергает то, что не является апдейтом', () => {
    const receiver = new WebhookReceiver({ secret: SECRET, handleUpdate: async () => undefined });

    assert.equal(receiver.receive('не json', SECRET).status, 400);
    assert.equal(receiver.receive(JSON.stringify({ foo: 1 }), SECRET).status, 400);
    assert.equal(receiver.receive(JSON.stringify(null), SECRET).status, 400);
  });

  it('не обрабатывает повторную доставку дважды', async () => {
    const handled: string[] = [];
    const receiver = new WebhookReceiver({
      secret: SECRET,
      handleUpdate: async (update) => void handled.push(textOf(update)),
    });

    const payload = message(1, 'заявка', 'mid.duplicate');
    receiver.receive(payload, SECRET);
    receiver.receive(payload, SECRET);
    await receiver.drain();

    assert.deepEqual(handled, ['заявка']);
    assert.equal(receiver.stats.duplicates, 1);
  });

  it('забывает ключ по истечении срока', async () => {
    let now = 1_000_000;
    const handled: string[] = [];
    const receiver = new WebhookReceiver({
      secret: SECRET,
      handleUpdate: async (update) => void handled.push(textOf(update)),
      dedupe: { ttlMs: 1000 },
      now: () => now,
    });

    const payload = message(1, 'повтор', 'mid.same');
    receiver.receive(payload, SECRET);
    now += 2000;
    receiver.receive(payload, SECRET);
    await receiver.drain();

    assert.equal(handled.length, 2, 'повтор через час, это новое обращение');
  });

  it('сохраняет порядок внутри чата', async () => {
    const order: string[] = [];
    const receiver = new WebhookReceiver({
      secret: SECRET,
      handleUpdate: async (update) => {
        const text = textOf(update);
        await new Promise((resolve) => setTimeout(resolve, text === 'первое' ? 20 : 0));
        order.push(text);
      },
    });

    receiver.receive(message(1, 'первое'), SECRET);
    receiver.receive(message(1, 'второе'), SECRET);
    await receiver.drain();

    assert.deepEqual(order, ['первое', 'второе']);
  });

  it('разные чаты обрабатываются параллельно', async () => {
    const order: string[] = [];
    const receiver = new WebhookReceiver({
      secret: SECRET,
      handleUpdate: async (update) => {
        const text = textOf(update);
        await new Promise((resolve) => setTimeout(resolve, text === 'медленный чат' ? 20 : 0));
        order.push(text);
      },
    });

    receiver.receive(message(1, 'медленный чат'), SECRET);
    receiver.receive(message(2, 'быстрый чат'), SECRET);
    await receiver.drain();

    assert.deepEqual(order, ['быстрый чат', 'медленный чат']);
  });

  it('ошибка обработчика не мешает следующим апдейтам', async () => {
    const errors: unknown[] = [];
    const handled: string[] = [];

    const receiver = new WebhookReceiver({
      secret: SECRET,
      handleUpdate: async (update) => {
        const text = textOf(update);
        if (text === 'ядовитое') throw new Error('падение обработчика');
        handled.push(text);
      },
      onHandlerError: (error) => void errors.push(error),
    });

    receiver.receive(message(1, 'ядовитое'), SECRET);
    receiver.receive(message(1, 'обычное'), SECRET);
    await receiver.drain();

    assert.deepEqual(handled, ['обычное']);
    assert.equal(errors.length, 1);
    assert.equal(receiver.stats.failed, 1);
  });

  it('отвечает платформе, не дожидаясь обработчика', async () => {
    let released = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      released = resolve;
    });

    const receiver = new WebhookReceiver({ secret: SECRET, handleUpdate: () => gate });

    const result = receiver.receive(message(1, 'долгая заявка'), SECRET);
    assert.equal(result.status, 200, 'ответ отдан сразу');
    assert.equal(receiver.stats.processed, 0, 'обработчик ещё выполняется');

    released();
    await receiver.drain();
    assert.equal(receiver.stats.processed, 1);
  });
});
