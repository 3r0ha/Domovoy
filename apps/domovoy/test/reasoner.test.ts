import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHttpReasoner, reasonerFromEnv } from '../dist/reasoner.js';

interface Call {
  url: string;
  headers?: HeadersInit;
  body?: unknown;
}

const stub = (reply: { body?: unknown; status?: number; fail?: boolean }) => {
  const calls: Call[] = [];

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      ...(init?.headers === undefined ? {} : { headers: init.headers }),
      ...(init?.body === undefined ? {} : { body: init.body }),
    });

    if (reply.fail) return Promise.reject(new Error('сеть недоступна'));

    return Promise.resolve(
      new Response(reply.status !== undefined && reply.status >= 400 ? null : JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { calls, fetch: fetchStub };
};

const chat = (content: string): unknown => ({ choices: [{ message: { content } }] });

describe('разбор обращения внешней моделью', () => {
  it('читает ответ в формате чата', async () => {
    const { calls, fetch } = stub({ body: chat('{"category":"plumbing","priority":"emergency"}') });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', apiKey: 'k1', fetch });

    const read = await reasoner.understand('Прорвало трубу');

    assert.deepEqual(read, { category: 'plumbing', priority: 'emergency' });
    assert.equal(calls.length, 1);
    assert.match(String(calls[0]!.body), /Прорвало трубу/);
  });

  it('достаёт JSON из ответа с разметкой', async () => {
    const { fetch } = stub({ body: chat('Вот разбор:\n```json\n{"category":"elevator"}\n```') });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.deepEqual(await reasoner.understand('Застряли в лифте'), { category: 'elevator' });
  });

  it('читает ответ во второй распространённой форме', async () => {
    const { fetch } = stub({ body: { content: [{ text: '{"category":"heating"}' }] } });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/messages', fetch });

    assert.deepEqual(await reasoner.understand('Холодные батареи'), { category: 'heating' });
  });

  it('ответ не в JSON разбором не считается', async () => {
    const { fetch } = stub({ body: chat('затрудняюсь ответить') });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await reasoner.understand('Что-то сломалось'), undefined);
  });

  it('отказ службы разбор не роняет', async () => {
    const failures: unknown[] = [];
    const { fetch } = stub({ status: 503 });
    const reasoner = createHttpReasoner({
      endpoint: 'https://model.test/v1/chat',
      fetch,
      onError: (error) => failures.push(error),
    });

    assert.equal(await reasoner.understand('Не горит лампа'), undefined);
    assert.equal(failures.length, 1);
  });

  it('обрыв сети разбор не роняет', async () => {
    const { fetch } = stub({ fail: true });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await reasoner.understand('Не горит лампа'), undefined);
  });

  it('без адреса службы разбора нет', () => {
    assert.equal(reasonerFromEnv({}), undefined);
    assert.notEqual(reasonerFromEnv({ REASONER_URL: 'https://model.test/v1/chat' }), undefined);
  });

  it('намерение читается тем же способом, что и разбор', async () => {
    const { calls, fetch } = stub({ body: chat('{"intent":"question","topic":"bill"}') });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.deepEqual(await reasoner.intent?.('сколько я должен'), { intent: 'question', topic: 'bill' });
    assert.match(String(calls[0]!.body), /сколько я должен/);
  });

  it('пересказ сводки приходит обычным текстом', async () => {
    const { fetch } = stub({ body: chat('Открыто 3 заявки, одна просрочена.') });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await reasoner.digest?.('Сейчас: открыто 3'), 'Открыто 3 заявки, одна просрочена.');
  });

  it('отказ службы не роняет ни намерение, ни пересказ', async () => {
    const { fetch } = stub({ status: 503 });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await reasoner.intent?.('когда дадут воду'), undefined);
    assert.equal(await reasoner.digest?.('Сейчас: открыто 3'), undefined);
  });
});
