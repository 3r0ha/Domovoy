const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Context } = require('../dist');

const api = {};

test('update without a message body does not break the context', () => {
  const context = new Context({ update_type: 'message_created', timestamp: Date.now() }, api, { user_id: 1 });

  assert.equal(context.user, undefined);
  assert.equal(context.chatId, undefined);
});

test('callback update without a callback body does not break the context', () => {
  const context = new Context({ update_type: 'message_callback', timestamp: Date.now() }, api, { user_id: 1 });

  assert.equal(context.user, undefined);
});

test('full message update still reports its sender', () => {
  const sender = { user_id: 42, first_name: 'Мария', is_bot: false };
  const context = new Context(
    {
      update_type: 'message_created',
      timestamp: Date.now(),
      message: { sender, recipient: { chat_id: 42, chat_type: 'dialog' }, body: { mid: 'mid-1', seq: 1, text: 'привет' } },
    },
    api,
    { user_id: 1 },
  );

  assert.deepEqual(context.user, sender);
  assert.equal(context.chatId, 42);
});
