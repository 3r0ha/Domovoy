import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { signInitData } from '../packages/bridge/dist/index.js';

/**
 * Прогон обязательных проверок из DATA-API.yaml (формат DATA-API 1.0) по
 * работающей установке: коды ответов, тип содержимого, обязательные поля и
 * схема тела сверяются с файлом, затем выполняется очистка. Роли получают
 * сессию так же, как мини-приложение, обменивая подписанные параметры запуска.
 *
 *   BOT_TOKEN=<токен> API_URL=https://<домен> npm run check-api
 */
const plan = yaml.load(readFileSync(fileURLToPath(new URL('../DATA-API.yaml', import.meta.url)), 'utf8'));
const api = process.env['API_URL'] ?? 'http://localhost:3000';
const botToken = process.env['BOT_TOKEN'] ?? 'stand-token';

/** Учётные записи ролей из набора `seed`: тот же список стоит в шапке DATA-API.yaml. */
const ROLES = {
  resident: { maxUserId: 1001, name: 'Мария' },
  neighbor: { maxUserId: 1002, name: 'Иван' },
  dispatcher: { maxUserId: 2001, name: 'Ольга Титова' },
  technician: { maxUserId: 2002, name: 'Сергей Малых' },
  manager: { maxUserId: 2003, name: 'Нина Гордеева' },
  contractor: { maxUserId: 2004, name: 'Лифтсервис' },
};

const tokens = new Map();

const tokenFor = async (role) => {
  if (role === 'public') return null;
  if (tokens.has(role)) return tokens.get(role);

  const account = ROLES[role];

  if (!account) throw new Error(`нет учётной записи для роли ${role}`);

  const initData = await signInitData(
    {
      auth_date: Math.floor(Date.now() / 1000),
      query_id: `check-${account.maxUserId}`,
      user: JSON.stringify({ id: account.maxUserId, first_name: account.name }),
    },
    botToken,
  );
  const response = await fetch(`${api}/auth/session`, { method: 'POST', headers: { 'x-max-init-data': initData } });

  if (response.status === 429) {
    console.error(`предел входа на ${api}: повторите через ${response.headers.get('retry-after') ?? '60'} с`);
    process.exit(1);
  }

  if (!response.ok) throw new Error(`сессия для роли ${role}: ${response.status}`);

  const { token } = await response.json();

  tokens.set(role, token);

  return token;
};

/** Значения, извлечённые проверками через `extract`. */
const variables = {};

/** Подстановка `${имя}` во все строки запроса. */
const fill = (value) => {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
      if (variables[name] === undefined) throw new Error(`переменная ${name} не извлечена`);

      return String(variables[name]);
    });
  }

  if (Array.isArray(value)) return value.map(fill);

  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fill(inner)]));

  return value;
};

/** Простой JSONPath: `$.request.id`, `$[0].id`. */
const pick = (payload, expression) =>
  expression
    .slice(1)
    .split(/\.|\[(\d+)\]/)
    .filter((part) => part !== undefined && part !== '')
    .reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), payload);

/** Сверка с фрагментом JSON Schema: тип, обязательные поля, вложенные свойства и элементы. */
const conform = (value, schema, where, problems) => {
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return problems.push(`${where}: не массив`);
    if (schema.minItems && value.length < schema.minItems) problems.push(`${where}: элементов меньше ${schema.minItems}`);
    if (schema.items && value.length > 0) conform(value[0], schema.items, `${where}[0]`, problems);

    return undefined;
  }

  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return problems.push(`${where}: не объект`);

    for (const field of schema.required ?? []) {
      if (!(field in value)) problems.push(`${where}: нет поля ${field}`);
    }

    for (const [field, inner] of Object.entries(schema.properties ?? {})) {
      if (field in value) conform(value[field], inner, `${where}.${field}`, problems);
    }
  }

  return undefined;
};

const call = async (step) => {
  const request = fill(step.request ?? {});
  let path = step.path;

  for (const [name, value] of Object.entries(request.path ?? {})) path = path.replace(`{${name}}`, encodeURIComponent(value));

  const query = request.query ? `?${new URLSearchParams(request.query)}` : '';
  const token = await tokenFor(step.role);
  const body = request.body;

  // Заголовки сводятся без учёта регистра: Content-Type из файла и свой дали бы два значения сразу.
  const headers = new Headers(plan.api.defaultHeaders);

  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  for (const [name, value] of Object.entries(request.headers ?? {})) headers.set(name, value);

  const response = await fetch(`${api}${path}${query}`, {
    method: step.method,
    signal: AbortSignal.timeout(step.timeoutMs ?? 5000),
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const type = response.headers.get('content-type') ?? '';
  const payload = type.includes('json') ? await response.json() : await response.text();

  return { status: response.status, type, payload };
};

const problems = [];
const failed = new Set();

for (const check of plan.checks) {
  const blocked = (check.dependsOn ?? []).find((id) => failed.has(id));

  if (blocked) {
    failed.add(check.id);
    problems.push(`${check.id}: пропущена, не прошла ${blocked}`);
    continue;
  }

  const found = [];
  let answer;

  try {
    answer = await call(check);
  } catch (error) {
    failed.add(check.id);
    problems.push(`${check.id}: ${error.message}`);
    continue;
  }

  const { expected } = check;

  if (!expected.statusCodes.includes(answer.status)) {
    found.push(`ждали ${expected.statusCodes.join('/')}, пришло ${answer.status} ${JSON.stringify(answer.payload).slice(0, 160)}`);
  } else {
    if (expected.contentType && !answer.type.includes(expected.contentType)) found.push(`тип ответа ${answer.type}`);

    for (const field of expected.requiredFields ?? []) {
      if (!answer.payload || typeof answer.payload !== 'object' || !(field in answer.payload)) found.push(`нет поля ${field}`);
    }

    if (expected.bodySchema) conform(answer.payload, expected.bodySchema, '$', found);

    for (const [name, expression] of Object.entries(check.extract ?? {})) {
      const value = pick(answer.payload, expression);

      if (value === undefined) found.push(`${expression} пусто`);
      else variables[name] = value;
    }
  }

  if (found.length > 0) {
    failed.add(check.id);
    problems.push(...found.map((problem) => `${check.id}: ${problem}`));
    continue;
  }

  console.log(`✓ ${check.id}: ${answer.status}`);
}

for (const step of plan.cleanup ?? []) {
  try {
    const answer = await call(step);

    if (step.expected && !step.expected.statusCodes.includes(answer.status)) {
      problems.push(`очистка ${step.id}: пришло ${answer.status}`);
    } else {
      console.log(`✓ очистка ${step.id}: ${answer.status}`);
    }
  } catch (error) {
    problems.push(`очистка ${step.id}: ${error.message}`);
  }
}

console.log(`\n${api}: проверок ${plan.checks.length}, замечаний ${problems.length}`);

for (const problem of problems) console.log(`  ${problem}`);

if (problems.length > 0) process.exitCode = 1;
