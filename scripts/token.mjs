import { signInitData } from '@maxkit/bridge';

/**
 * Токен сессии для проверки API. Параметры запуска подписываются токеном бота,
 * как это делает клиент MAX, и обмениваются на сессионный токен.
 *
 * node scripts/token.mjs 1001 "Мария"
 */
const [, , said = '1001', name = 'Проверка'] = process.argv;

const token = process.env['BOT_TOKEN'];
const api = process.env['API_URL'] ?? 'http://localhost:3000';

if (!token) {
  console.error('Нужен BOT_TOKEN: тем же токеном подписывает параметры запуска клиент MAX');
  process.exit(1);
}

const initData = await signInitData(
  {
    auth_date: Math.floor(Date.now() / 1000),
    query_id: `check-${said}`,
    user: JSON.stringify({ id: Number(said), first_name: name }),
  },
  token,
);

const response = await fetch(`${api}/auth/session`, {
  method: 'POST',
  headers: { 'x-max-init-data': initData },
});

if (!response.ok) {
  console.error(`Сессия не выдана: ${response.status} ${await response.text()}`);
  process.exit(1);
}

const session = await response.json();

console.log(session.token);
