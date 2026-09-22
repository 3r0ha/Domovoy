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

  it('проверка темы идёт словами той роли, которая спросила', async () => {
    const forResident = stub({ body: chat('true') });
    const resident = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch: forResident.fetch });

    assert.equal(await resident.onTopic?.('Что горит?'), true);
    assert.match(String(forResident.calls[0]!.body), /счета, показания, соседи/);

    const forStaff = stub({ body: chat('true') });
    const staff = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch: forStaff.fetch });

    assert.equal(await staff.onTopic?.('Что горит?', true), true);
    assert.match(String(forStaff.calls[0]!.body), /что горит/);
    assert.match(String(forStaff.calls[0]!.body), /наряды, дежурство/);
  });

  it('один и тот же вопрос уходит в службу один раз', async () => {
    const { calls, fetch } = stub({ body: chat('{"intent":"question","topic":"bill"}') });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch });

    const [first, second] = await Promise.all([
      reasoner.intent?.('когда придёт квитанция'),
      reasoner.intent?.('когда придёт квитанция'),
    ]);

    assert.deepEqual(first, second);
    assert.equal(calls.length, 1, 'одинаковый разбор спросили дважды');

    await reasoner.intent?.('когда дадут воду');

    assert.equal(calls.length, 2, 'другой вопрос ответом из памяти не подменяется');
  });

  it('неудачный ответ в памяти не остаётся', async () => {
    const { calls, fetch } = stub({ status: 503 });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await reasoner.intent?.('когда дадут воду'), undefined);
    assert.equal(await reasoner.intent?.('когда дадут воду'), undefined);
    assert.equal(calls.length, 2, 'после отказа службу не спросили заново');
  });

  it('отказ службы не роняет ни намерение, ни пересказ', async () => {
    const { fetch } = stub({ status: 503 });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await reasoner.intent?.('когда дадут воду'), undefined);
    assert.equal(await reasoner.digest?.('Сейчас: открыто 3'), undefined);
  });
});

/** Служба, которая не отвечает: ответ приходит только по отмене запроса. */
const silent = () => {
  const calls: Call[] = [];

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url });

    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('прервано'), { name: 'AbortError' })));
    });
  };

  return { calls, fetch: fetchStub };
};

describe('разбор при неровной работе службы', () => {
  it('молчание службы заканчивается таймаутом, а не ожиданием', async () => {
    const { calls, fetch } = silent();
    const failures: unknown[] = [];
    const reasoner = createHttpReasoner({
      endpoint: 'https://model.test/v1/chat',
      fetch,
      timeoutMs: 20,
      onError: (error) => failures.push(error),
    });

    assert.equal(await reasoner.understand('Течёт труба'), undefined);
    assert.equal(calls.length, 1, 'после своего же таймаута службу спросили заново');
    assert.equal(failures.length, 1);
  });

  it('обрыв связи проходит со второго раза', async () => {
    let attempt = 0;

    const fetchStub = (): Promise<Response> => {
      attempt += 1;

      if (attempt === 1) return Promise.reject(new Error('сеть недоступна'));

      return Promise.resolve(
        new Response(JSON.stringify(chat('{"category":"heating"}')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch: fetchStub });

    assert.deepEqual(await reasoner.understand('Холодные батареи'), { category: 'heating' });
    assert.equal(attempt, 2);
  });

  it('пустой ответ службы разбором не считается', async () => {
    const { fetch } = stub({ body: chat('') });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await reasoner.understand('Течёт труба'), undefined);
    assert.equal(await reasoner.onTopic?.('Течёт труба'), undefined);
  });

  it('ответ не в том виде разбором не считается', async () => {
    const { fetch } = stub({ body: { unexpected: true } });
    const reasoner = createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch });

    assert.equal(await reasoner.understand('Течёт труба'), undefined);
  });
});

describe('неровный ответ службы разбирается', () => {
  const reasonerWith = (content: string) =>
    createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch: stub({ body: chat(content) }).fetch });

  it('пояснение после объекта разбору не мешает', async () => {
    const reasoner = reasonerWith('{"category":"plumbing"}\n\nНадеюсь, это то, что нужно {ещё}.');

    assert.deepEqual(await reasoner.understand('Течёт труба'), { category: 'plumbing' });
  });

  it('одинарные кавычки и лишняя запятая чинятся', async () => {
    const reasoner = reasonerWith("{'category': 'plumbing', 'priority': 'normal',}");

    assert.deepEqual(await reasoner.understand('Течёт труба'), { category: 'plumbing', priority: 'normal' });
  });

  it('вложенный объект скобками не обрывается', async () => {
    const reasoner = reasonerWith('```json\n{"category":"other","where":{"place":"house"}}\n```');

    assert.deepEqual(await reasoner.understand('Во дворе яма'), {
      category: 'other',
      where: { place: 'house' },
    });
  });

  it('объект внутри списка всё равно находится', async () => {
    const reasoner = reasonerWith('[{"category":"plumbing"}]');

    assert.deepEqual(await reasoner.understand('Течёт труба'), { category: 'plumbing' });
  });

  it('ответ без объекта разбором не считается', async () => {
    const reasoner = reasonerWith('Затрудняюсь ответить, напишите подробнее.');

    assert.equal(await reasoner.understand('Течёт труба'), undefined);
  });

  it('«да» и «нет» читаются с разметкой и на русском', async () => {
    assert.equal(await reasonerWith('**true**').onTopic?.('капремонт'), true);
    assert.equal(await reasonerWith('"Нет."').onTopic?.('свари борщ'), false);
    assert.equal(await reasonerWith('затрудняюсь').onTopic?.('капремонт'), undefined);
    assert.equal(await reasonerWith('не true').onTopic?.('капремонт'), undefined);
  });
});

describe('правила, которые уходят модели', () => {
  const askedWith = async (run: (reasoner: ReturnType<typeof createHttpReasoner>) => Promise<unknown>) => {
    const { calls, fetch } = stub({ body: chat('{}') });

    await run(createHttpReasoner({ endpoint: 'https://model.test/v1/chat', fetch }));

    return String(calls[0]?.body);
  };

  it('короткое сообщение и просьба разбираются наравне с жалобой', async () => {
    const body = await askedWith((reasoner) => reasoner.understand('труба'));

    assert.match(body, /одно слово это полноценное обращение/u);
    assert.match(body, /Просьба это то же обращение/u);
  });

  it('название языка это вопрос по делу', async () => {
    const body = await askedWith((reasoner) => reasoner.onTopic?.('татарча') ?? Promise.resolve(undefined));

    assert.match(body, /татарча/u);
  });

  it('просьба на чужом языке относится к разделу, а не к поломке', async () => {
    const body = await askedWith(
      (reasoner) =>
        reasoner.route?.({ text: 'I want to open the door', sections: [{ screen: 'home', title: 'Дом', about: 'двери' }] }) ??
        Promise.resolve(undefined),
    );

    assert.match(body, /eshikni oching/u);
    assert.match(body, /I want to open the door/u);
  });

  it('уточняющий вопрос просят на языке жильца', async () => {
    const body = await askedWith(
      (reasoner) =>
        reasoner.clarify?.({ description: 'Лифт не работает', candidates: ['Лифт, подъезд 2'], language: 'tt' }) ??
        Promise.resolve(undefined),
    );

    assert.match(body, /Поле question напиши на языке: Татарча/u);
    assert.match(body, /Лифт, подъезд 2/u);
  });

  it('помощника просят ответить на языке вопроса', async () => {
    const body = await askedWith(
      (reasoner) =>
        reasoner.assist?.({
          question: 'I want to open the door',
          facts: 'Квартира: 1',
          sections: [{ screen: 'home', title: 'Дом', about: 'двери' }],
        }) ?? Promise.resolve(undefined),
    );

    assert.match(body, /Отвечай на том языке, на котором задан вопрос/u);
  });
});
