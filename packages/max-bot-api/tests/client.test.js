const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createClient } = require('../dist/core/network/api');

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json' },
});

test('client uses custom fetch when it is provided', async () => {
  const calls = [];
  const client = createClient('token', {
    fetch: (input, init) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(jsonResponse({ user_id: 1 }));
    },
  });

  const result = await client.call({ method: 'me', options: {} });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://platform-api2.max.ru/me');
  assert.equal(calls[0].init.headers.Authorization, 'token');
  assert.deepEqual(result, { status: 200, data: { user_id: 1 } });
});

test('custom fetch works together with baseUrl', async () => {
  const calls = [];
  const client = createClient('token', {
    baseUrl: 'http://127.0.0.1:3000',
    fetch: (input) => {
      calls.push(String(input));
      return Promise.resolve(jsonResponse({ ok: true }));
    },
  });

  await client.call({ method: 'messages', options: { method: 'POST', body: { text: 'hi' } } });

  assert.equal(calls[0], 'http://127.0.0.1:3000/messages');
});

test('client falls back to global fetch', async () => {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = (input) => {
    calls.push(String(input));
    return Promise.resolve(jsonResponse({ user_id: 2 }));
  };

  try {
    const client = createClient('token');
    const result = await client.call({ method: 'me', options: {} });

    assert.equal(calls.length, 1);
    assert.deepEqual(result, { status: 200, data: { user_id: 2 } });
  } finally {
    globalThis.fetch = original;
  }
});

test('custom fetch is not called without a token', async () => {
  let called = false;
  const client = createClient('', { fetch: () => { called = true; return Promise.resolve(jsonResponse({})); } });

  const result = await client.call({ method: 'me', options: {} });

  assert.equal(called, false);
  assert.equal(result.status, 401);
});
