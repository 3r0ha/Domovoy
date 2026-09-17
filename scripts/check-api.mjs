import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { signInitData } from '../packages/bridge/dist/index.js';

/**
 * Прогон обязательных проверок из DATA-API.yaml по работающей установке:
 * коды ответов, тип содержимого и обязательные поля сверяются с заявленным
 * контрактом. Роли получают сессию так же, как мини-приложение, обменивая
 * подписанные параметры запуска.
 *
 *   BOT_TOKEN=<токен> API_URL=https://<домен> npm run check-api
 */
const plan = yaml.load(readFileSync(fileURLToPath(new URL('../DATA-API.yaml', import.meta.url)), 'utf8'));
const api = process.env['API_URL'] ?? 'http://localhost:3000';
const botToken = process.env['BOT_TOKEN'] ?? 'stand-token';

const tokens = new Map();

const initDataFor = (role) =>
  signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `check-${plan.roles[role].maxUserId}`,
      user: JSON.stringify({ id: plan.roles[role].maxUserId, first_name: plan.roles[role].name }),
    },
    botToken,
  );

const tokenFor = async (role) => {
  if (role === 'anonymous') return null;
  if (tokens.has(role)) return tokens.get(role);
  if (!plan.roles[role]) throw new Error(`в DATA-API.yaml нет роли ${role}`);

  const response = await fetch(`${api}/auth/session`, {
    method: 'POST',
    headers: { 'x-max-init-data': await initDataFor(role) },
  });

  if (!response.ok) throw new Error(`сессия для роли ${role}: ${response.status}`);

  const { token } = await response.json();

  tokens.set(role, token);

  return token;
};

/** Что подставляется вместо {id}: проверки идут цепочкой по одной заявке. */
const state = {};

const idFor = (check) => {
  if (check.name.includes('счётчика')) return state.meterId;
  if (check.name.includes('Чужая')) return state.foreignId;

  return state.requestId;
};

const problems = [];

for (const check of plan.checks) {
  const token = await tokenFor(check.role);
  let path = check.path;

  if (path.includes('{id}')) {
    const id = idFor(check);

    if (!id) {
      problems.push(`${check.name}: нечем подставить {id}`);
      continue;
    }

    path = path.replace('{id}', id);
  }

  const query = check.request?.query ? `?${new URLSearchParams(check.request.query)}` : '';
  const body = check.request?.body;
  const entering = path === '/auth/session';

  const response = await fetch(`${api}${path}${query}`, {
    method: check.method,
    headers: {
      ...(token && !entering ? { authorization: `Bearer ${token}` } : {}),
      ...(entering ? { 'x-max-init-data': await initDataFor(check.role) } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const type = response.headers.get('content-type') ?? '';
  const payload = type.includes('json') ? await response.json() : await response.text();

  if (!check.expect.status.includes(response.status)) {
    const seen = JSON.stringify(payload).slice(0, 160);

    problems.push(`${check.name}: ждали ${check.expect.status.join('/')}, пришло ${response.status} ${seen}`);
    continue;
  }

  if (check.expect.contentType && !type.includes(check.expect.contentType)) {
    problems.push(`${check.name}: тип ответа ${type}`);
  }

  if (check.expect.type === 'array' && !Array.isArray(payload)) {
    problems.push(`${check.name}: ответ не массив`);
  }

  const first = Array.isArray(payload) ? payload[0] : payload;

  for (const field of check.expect.required ?? []) {
    if (first === undefined || !(field in first)) problems.push(`${check.name}: нет поля ${field}`);
  }

  for (const field of check.expect.itemRequired ?? []) {
    if (Array.isArray(payload) && payload.length > 0 && !(field in payload[0])) {
      problems.push(`${check.name}: в элементе нет поля ${field}`);
    }
  }

  // Вложенный объект с обязательными полями: «request: { required: [...] }».
  for (const [nested, rule] of Object.entries(check.expect)) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !rule.required) continue;

    const inner = first?.[nested];

    for (const field of rule.required) {
      if (!inner || !(field in inner)) problems.push(`${check.name}: в ${nested} нет поля ${field}`);
    }
  }

  // Что нужно следующим проверкам.
  if (check.path === '/api/requests' && check.method === 'POST') state.requestId = payload.request?.id;
  if (check.path === '/api/meters') state.meterId = Array.isArray(payload) ? payload[0]?.id : undefined;

  if (check.path === '/api/requests' && check.request?.query?.scope === 'mine' && Array.isArray(payload)) {
    state.mine = new Set(payload.map((item) => item.id));
  }

  if (check.path === '/api/requests' && check.request?.query?.scope === 'queue' && Array.isArray(payload)) {
    state.foreignId = payload.find(
      (item) => !state.mine?.has(item.id) && item.id !== state.requestId && /квартира/i.test(item.target ?? ''),
    )?.id;
  }

  console.log(`✓ ${check.name}: ${response.status}`);
}

console.log(`\n${api}: проверок ${plan.checks.length}, замечаний ${problems.length}`);

for (const problem of problems) console.log(`  ${problem}`);

if (problems.length > 0) process.exitCode = 1;
