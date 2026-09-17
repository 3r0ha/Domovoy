const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  ScenarioEngine,
  MemorySessionStore,
  defineScenario,
  session,
  transition,
} = require('../dist');

const noop = () => Promise.resolve();

const createRuntime = (options = {}) => {
  const store = new MemorySessionStore();
  const sessions = session({ store, getSessionKey: (ctx) => ctx.key });
  const scenarios = new ScenarioEngine(options);
  const run = (ctx, next = noop) => sessions(ctx, () => scenarios.middleware()(ctx, next));
  return { scenarios, run, store };
};

const request = defineScenario()({
  id: 'request',
  initialStep: 'ask-address',
  createData: () => ({ address: '' }),
  steps: {
    'ask-address': () => transition.goto('read-address'),
    'read-address': () => transition.complete(),
  },
});

/** Состояние, оставшееся от сценария, которого больше нет в коде. */
const staleState = { id: 'removed-scenario', step: 'ask-address', data: {} };

test('stale scenario state throws by default', async () => {
  const { scenarios, run, store } = createRuntime();
  scenarios.register(request);
  store.set('user', { scenario: staleState });

  await assert.rejects(run({ key: 'user' }), /is not registered/);
});

test('reset policy drops stale state and passes the update on', async () => {
  const { scenarios, run, store } = createRuntime({ onInconsistentState: 'reset' });
  scenarios.register(request);
  store.set('user', { scenario: staleState });

  let reachedNext = false;
  await run({ key: 'user' }, async () => { reachedNext = true; });

  assert.equal(reachedNext, true, 'the update reaches regular handlers');
  assert.equal(store.get('user').scenario, undefined, 'stale state is removed');
});

test('reset policy drops state when the step no longer exists', async () => {
  const { scenarios, run, store } = createRuntime({ onInconsistentState: 'reset' });
  scenarios.register(request);
  store.set('user', { scenario: { id: 'request', step: 'removed-step', data: {} } });

  let reachedNext = false;
  await run({ key: 'user' }, async () => { reachedNext = true; });

  assert.equal(reachedNext, true);
  assert.equal(store.get('user').scenario, undefined);
});

test('reset policy does not disturb a healthy scenario', async () => {
  const { scenarios, run, store } = createRuntime({ onInconsistentState: 'reset' });
  scenarios.register(request);

  const first = { key: 'user' };
  await run(first, () => first.scenario.start(request));
  assert.equal(store.get('user').scenario.step, 'read-address');

  await run({ key: 'user' });
  assert.equal(store.get('user').scenario, undefined, 'scenario completed as usual');
});

test('a user can start over right after the reset', async () => {
  const { scenarios, run, store } = createRuntime({ onInconsistentState: 'reset' });
  scenarios.register(request);
  store.set('user', { scenario: staleState });

  const stuck = { key: 'user' };
  await run(stuck, () => stuck.scenario.start(request));

  assert.equal(store.get('user').scenario.id, 'request');
  assert.equal(store.get('user').scenario.step, 'read-address');
});
