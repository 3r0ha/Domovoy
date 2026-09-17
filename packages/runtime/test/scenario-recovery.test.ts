import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { scenarioRecovery } from '../dist/index.js';

interface Ctx {
  session?: { scenario?: unknown } & Record<string, unknown>;
  replies: string[];
}

const context = (scenario: unknown = { id: 'request', step: 'ask_address' }): Ctx => ({
  session: { scenario },
  replies: [],
});

describe('восстановление зависшего сценария', () => {
  const stuckErrors = [
    'Scenario "request" is not registered',
    'Scenario "request" has no step "ask_address"',
    'Scenario "request" is already active',
    'Scenario "request" uses another definition',
    'Scenario step must return a transition',
    'Unsupported scenario transition "jump"',
  ];

  for (const message of stuckErrors) {
    it(`сбрасывает состояние после «${message}»`, async () => {
      const middleware = scenarioRecovery<Ctx>();
      const ctx = context();

      await middleware(ctx, async () => {
        throw new Error(message);
      });

      assert.equal(ctx.session?.scenario, undefined, 'несогласованное состояние убрано');
    });
  }

  it('даёт сообщить пользователю', async () => {
    const middleware = scenarioRecovery<Ctx>({
      onRecovered: (_error, ctx) => void ctx.replies.push('Прошлый диалог устарел, начнём заново'),
    });
    const ctx = context();

    await middleware(ctx, async () => {
      throw new Error('Scenario "request" is not registered');
    });

    assert.deepEqual(ctx.replies, ['Прошлый диалог устарел, начнём заново']);
  });

  it('после сброса следующий апдейт обрабатывается обычной цепочкой', async () => {
    const middleware = scenarioRecovery<Ctx>();
    const ctx = context();
    let handled = false;

    await middleware(ctx, async () => {
      throw new Error('Scenario "request" has no step "ask_address"');
    });

    await middleware(ctx, async () => {
      handled = true;
    });

    assert.equal(handled, true);
  });

  it('прочие ошибки пробрасываются как есть', async () => {
    const middleware = scenarioRecovery<Ctx>();
    const ctx = context();

    await assert.rejects(
      middleware(ctx, async () => {
        throw new Error('база данных недоступна');
      }),
      /база данных недоступна/,
    );

    assert.notEqual(ctx.session?.scenario, undefined, 'состояние сценария не тронуто');
  });

  it('не мешает успешной обработке', async () => {
    const middleware = scenarioRecovery<Ctx>();
    const ctx = context();
    let handled = false;

    await middleware(ctx, async () => {
      handled = true;
    });

    assert.equal(handled, true);
    assert.notEqual(ctx.session?.scenario, undefined);
  });

  it('признак восстановимости и способ сброса заменяются', async () => {
    const middleware = scenarioRecovery<Ctx>({
      isRecoverable: (error) => error instanceof RangeError,
      clearState: (ctx) => {
        if (ctx.session) ctx.session['scenario'] = 'сброшено';
      },
    });
    const ctx = context();

    await middleware(ctx, async () => {
      throw new RangeError('своя ошибка');
    });

    assert.equal(ctx.session?.scenario, 'сброшено');
  });

  it('работает без сессии в контексте', async () => {
    const middleware = scenarioRecovery<Ctx>();
    const ctx: Ctx = { replies: [] };

    await assert.doesNotReject(
      middleware(ctx, async () => {
        throw new Error('Scenario "request" is not registered');
      }),
    );
  });
});
