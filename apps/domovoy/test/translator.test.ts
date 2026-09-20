import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHttpTranslator, translatorFromEnv } from '../dist/translator.js';
import { createGigaChat } from '../dist/gigachat.js';

interface Call {
  url: string;
  body?: unknown;
}

const stub = (reply: { body?: unknown; status?: number; fail?: boolean }) => {
  const calls: Call[] = [];

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
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

/** Что ушло модели: правила и сам запрос. */
const messagesOf = (body: unknown): { role: string; content: string }[] =>
  (JSON.parse(String(body)) as { messages: { role: string; content: string }[] }).messages;

describe('перевод написанного своими словами', () => {
  it('отдаёт перевод и называет модели оба языка', async () => {
    const { calls, fetch } = stub({ body: chat('В подъезде не горит свет') });
    const translate = createHttpTranslator({ endpoint: 'https://model.test/v1/chat', apiKey: 'k1', fetch });

    const said = await translate.translate('Podyezdda chiroq yonmayapti', 'ru', 'uz');

    assert.equal(said, 'В подъезде не горит свет');
    assert.equal(calls.length, 1);

    const [rules, prompt] = messagesOf(calls[0]?.body);

    assert.match(rules?.content ?? '', /Переводи дословно/u);
    assert.match(rules?.content ?? '', /Числа, адреса, номера/u);
    assert.match(prompt?.content ?? '', /Oʻzbekcha/u, 'язык исходного текста назван');
    assert.match(prompt?.content ?? '', /Русский/u, 'язык перевода назван');
    assert.match(prompt?.content ?? '', /Podyezdda chiroq yonmayapti/u);
  });

  it('границы вокруг ответа снимаются', async () => {
    const { fetch } = stub({ body: chat('<<<Не горит свет>>>') });
    const translate = createHttpTranslator({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await translate.translate('Chiroq yo‘q', 'ru', 'uz'), 'Не горит свет');
  });

  it('отказ службы не бросает исключение, а отвечает пустотой', async () => {
    const { fetch } = stub({ fail: true });
    const translate = createHttpTranslator({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await translate.translate('Chiroq yo‘q', 'ru', 'uz'), undefined);
  });

  it('служба ответила отказом: перевода нет', async () => {
    const { fetch } = stub({ status: 503 });
    const translate = createHttpTranslator({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await translate.translate('Chiroq yo‘q', 'ru', 'uz'), undefined);
  });

  it('пустой текст модели не отдаётся', async () => {
    const { calls, fetch } = stub({ body: chat('что угодно') });
    const translate = createHttpTranslator({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await translate.translate('   ', 'ru', 'uz'), undefined);
    assert.equal(calls.length, 0);
  });

  it('без адреса службы перевода нет', () => {
    assert.equal(translatorFromEnv({}), undefined);
    assert.notEqual(translatorFromEnv({ REASONER_URL: 'https://model.test/v1/chat' }), undefined);
  });

  it('GigaChat отдаёт разбор и перевод на одном ключе', () => {
    const { fetch } = stub({ body: chat('{}') });
    const giga = createGigaChat({ authKey: 'key', fetch });

    assert.equal(typeof giga.reasoner.understand, 'function');
    assert.equal(giga.translate.model, true);
  });
});
