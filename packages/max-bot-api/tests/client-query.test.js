const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createClient } = require('../dist/core/network/api');

const captureUrl = async (query) => {
  let captured = '';
  const original = globalThis.fetch;

  globalThis.fetch = (input) => {
    captured = String(input);
    return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
  };

  try {
    const client = createClient('token');
    await client.call({ method: 'messages', options: { query } });
  } finally {
    globalThis.fetch = original;
  }

  return new URL(captured);
};

test('query keeps zero, false and an empty string', async () => {
  const url = await captureUrl({ marker: 0, disable_link_preview: false, text: '' });

  assert.equal(url.searchParams.get('marker'), '0');
  assert.equal(url.searchParams.get('disable_link_preview'), 'false');
  assert.equal(url.searchParams.get('text'), '');
});

test('query skips undefined and null', async () => {
  const url = await captureUrl({ chat_id: 42, user_id: undefined, marker: null });

  assert.equal(url.searchParams.get('chat_id'), '42');
  assert.equal(url.searchParams.has('user_id'), false);
  assert.equal(url.searchParams.has('marker'), false);
});
