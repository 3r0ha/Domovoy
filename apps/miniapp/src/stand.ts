import { createStand } from '@maxkit/devhost';

/** Стенд разработки: мини-приложение внутри эмулятора клиента MAX. */
const params = new URLSearchParams(globalThis.location.search);
const startParam = params.has('startapp') ? (params.get('startapp') ?? '') : 'ent_dom15_1';
const userId = Number(params.get('as') ?? 1002);
const userName = params.get('name') ?? 'Иван';

/*
 * Фамилия отдельным параметром и по умолчанию пустая. Одна фамилия на всех
 * приписывалась к любому имени, и стенд показывал «Мария Петров», а смене,
 * у которой в имени уже есть фамилия, «Сергей Малых Петров».
 */
const userSurname = params.get('surname') ?? '';
const botToken = import.meta.env['VITE_BOT_TOKEN'] as string | undefined;

const container = document.querySelector<HTMLElement>('#stand');

if (!container) throw new Error('Не нашёл контейнер стенда');

// Стенд открывает и чужую сборку: так проверяется то, что уже выложено.
const appUrl = params.get('app') ?? `${globalThis.location.origin}/index.html`;

await createStand({
  container,
  appUrl,
  ...(botToken ? { botToken } : {}),
  client: {
    ...(startParam ? { startParam } : {}),
    platform: 'ios',
    user: { id: userId, first_name: userName, ...(userSurname ? { last_name: userSurname } : {}) },
    codeReaderResult: params.get('scan') ?? 'https://max.ru/domovoy_bot?startapp=eqp_dom15_lift-1',
    latencyMs: 150,
  },
});
