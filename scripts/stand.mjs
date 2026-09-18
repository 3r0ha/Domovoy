import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { startMockPlatform } from '@maxkit/platform-mock';

/**
 * Стенд одной командой: эмулятор Bot API вместо платформы, продукт и
 * мини-приложение внутри эмулятора клиента MAX. Параметры запуска эмулятор
 * подписывает тем же HMAC, поэтому серверная проверка проходит по-настоящему.
 */
const TOKEN = process.env.BOT_TOKEN ?? 'stand-token';
const PORT = process.env.PORT ?? '3000';
const PLATFORM_PORT = Number(process.env.PLATFORM_PORT ?? 3999);
const MINIAPP_PORT = process.env.MINIAPP_PORT ?? '5173';
const root = fileURLToPath(new URL('..', import.meta.url));

const platform = await startMockPlatform({ token: TOKEN, port: PLATFORM_PORT, maxPollTimeoutMs: 500 });

const children = [];

const run = (command, args, options) => {
  const child = spawn(command, args, { stdio: 'inherit', cwd: root, ...options });

  children.push(child);
  return child;
};

run(process.execPath, ['apps/domovoy/dist/main.js'], {
  env: {
    ...process.env,
    BOT_TOKEN: TOKEN,
    MAX_API_URL: platform.url,
    PORT,
    ALLOWED_ORIGINS: `http://localhost:${MINIAPP_PORT}`,
    MARKER_FILE: process.env.MARKER_FILE ?? './state/stand-marker',
    // На стенде поставщиков нет: домофония, оплата и передача обращений
    // отвечают заглушками.
    HUB: process.env.HUB ?? 'mock',
    PAYMENTS: process.env.PAYMENTS ?? 'mock',
    HANDOFF: process.env.HANDOFF ?? 'mock',
    MEETINGS: process.env.MEETINGS ?? 'mock',
    CAPITAL_REPAIR: process.env.CAPITAL_REPAIR ?? 'mock',
  },
});

// Проверке контракта API мини-приложение не нужно: она ходит по HTTP.
if (process.env.SKIP_MINIAPP !== '1') {
  run('npx', ['vite', '--port', MINIAPP_PORT, '--strictPort'], {
    cwd: `${root}apps/miniapp`,
    env: {
      ...process.env,
      VITE_BOT_TOKEN: TOKEN,
      VITE_API_URL: `http://localhost:${PORT}`,
    },
  });
}

console.log(
  [
    '',
    'Стенд поднят:',
    `  приложение   http://localhost:${MINIAPP_PORT}/stand.html`,
    `  жилец        http://localhost:${MINIAPP_PORT}/stand.html?startapp=&as=1001&name=Мария`,
    `  диспетчер    http://localhost:${MINIAPP_PORT}/stand.html?startapp=&as=2001&name=Ольга`,
    `  управляющий  http://localhost:${MINIAPP_PORT}/stand.html?startapp=&as=2003&name=Нина`,
    `  подрядчик    http://localhost:${MINIAPP_PORT}/stand.html?startapp=&as=2004&name=Лифтсервис`,
    `  по наклейке  http://localhost:${MINIAPP_PORT}/stand.html?startapp=ent_dom15_1`,
    `  API          http://localhost:${PORT}/health`,
    '',
    'Данные для показа: npm run seed --workspace @domovoy/server',
    '',
  ].join('\n'),
);

const stop = () => {
  for (const child of children) child.kill('SIGTERM');

  void platform.stop().then(() => process.exit(0));
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
