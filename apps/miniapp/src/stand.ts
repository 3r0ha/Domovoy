import { createStand } from '@maxkit/devhost';

/** Стенд разработки: мини-приложение внутри эмулятора клиента MAX. */
const params = new URLSearchParams(globalThis.location.search);
const startParam = params.has('startapp') ? (params.get('startapp') ?? '') : 'ent_dom15_1';
const userId = Number(params.get('as') ?? 1002);
const userName = params.get('name') ?? 'Иван';
const botToken = import.meta.env['VITE_BOT_TOKEN'] as string | undefined;

const container = document.querySelector<HTMLElement>('#stand');

if (!container) throw new Error('Не нашёл контейнер стенда');

await createStand({
  container,
  appUrl: `${globalThis.location.origin}/index.html`,
  ...(botToken ? { botToken } : {}),
  client: {
    ...(startParam ? { startParam } : {}),
    platform: 'ios',
    user: { id: userId, first_name: userName, last_name: 'Петров' },
    codeReaderResult: params.get('scan') ?? 'https://max.ru/domovoy_bot?startapp=eqp_dom15_lift-1',
    latencyMs: 150,
  },
});
