import { randomUUID } from 'node:crypto';

import type { Reasoner, TextTranslator } from '@domovoy/app';

import { createChat, reasonerOver, type HttpReasonerOptions } from './reasoner.js';
import { translatorOver } from './translator.js';

/**
 * GigaChat: российская модель с бесплатным режимом. Ключ живёт полчаса и
 * меняется на долгоживущий Authorization key, поэтому токен обновляется сам.
 * Для TLS нужен корень «Russian Trusted Root CA»: он лежит в образе продукта.
 */
export interface GigaChatOptions {
  /** Authorization key из личного кабинета: пара Client ID и Client Secret в base64. */
  authKey: string;
  /** Область доступа: `GIGACHAT_API_PERS` у физического лица. */
  scope?: string;
  oauthUrl?: string;
  endpoint?: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  onError?: (error: unknown) => void;
}

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const ENDPOINT = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';

/**
 * Старшая из моделей, выданных бесплатным режимом: 25 млн токенов в год.
 * На коротких ответах продукта этого хватает с запасом, а обращение она
 * разбирает точнее младших и отвечает быстрее Pro.
 */
const MODEL = 'GigaChat-2-Max';

/** За сколько до конца срока брать новый токен: сетевой задержке нужен запас. */
const EARLY_MS = 60_000;

/** После отказа новый токен просят не сразу: ручка выдачи ограничивает частоту. */
const RETRY_MS = 15_000;

interface Token {
  value: string;
  until: number;
}

export type TokenSource = () => Promise<string | undefined>;

/** Выдаёт действующий токен, обновляя его по сроку. */
export const createTokenSource = (options: GigaChatOptions): TokenSource => {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  let token: Token | undefined;
  let asking: Promise<Token | undefined> | undefined;
  let failedAt: number | undefined;

  const fetchToken = async (): Promise<Token | undefined> => {
    try {
      const response = await doFetch(options.oauthUrl ?? OAUTH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          rquid: randomUUID(),
          authorization: `Basic ${options.authKey}`,
        },
        body: new URLSearchParams({ scope: options.scope ?? 'GIGACHAT_API_PERS' }).toString(),
      });

      if (!response.ok) {
        options.onError?.(new Error(`GigaChat не выдал токен: ${response.status}`));
        return undefined;
      }

      const body = (await response.json()) as { access_token?: unknown; expires_at?: unknown };

      if (typeof body.access_token !== 'string') return undefined;

      // Срок приходит меткой времени в миллисекундах. Без него берём полчаса.
      const until = typeof body.expires_at === 'number' ? body.expires_at : now() + 30 * 60_000;

      return { value: body.access_token, until };
    } catch (error) {
      options.onError?.(error);
      return undefined;
    }
  };

  return async () => {
    if (token && token.until - EARLY_MS > now()) return token.value;
    if (failedAt !== undefined && now() - failedAt < RETRY_MS) return undefined;

    // Пока токен обновляется, остальные запросы ждут тот же ответ.
    asking ??= fetchToken().finally(() => {
      asking = undefined;
    });

    token = await asking;
    failedAt = token ? undefined : now();

    return token?.value;
  };
};

const shared = new Map<string, TokenSource>();

/**
 * Один токен на ключ: разбор текста и разбор файлов ходят за ним в одну
 * ручку, и по отдельности они упирались бы в её предел частоты.
 */
export const sharedTokenSource = (options: GigaChatOptions): TokenSource => {
  if (options.fetch || options.now) return createTokenSource(options);

  const key = [options.oauthUrl ?? OAUTH_URL, options.scope ?? '', options.authKey].join('\n');
  const found = shared.get(key) ?? createTokenSource(options);

  shared.set(key, found);

  return found;
};

const chatOptions = (options: GigaChatOptions): HttpReasonerOptions => ({
  endpoint: options.endpoint ?? ENDPOINT,
  model: options.model ?? MODEL,
  authorization: sharedTokenSource(options),
  // Бесплатный режим для физического лица держит один поток.
  serial: true,
  ...(options.fetch ? { fetch: options.fetch } : {}),
  ...(options.onError ? { onError: options.onError } : {}),
});

/**
 * Разбор обращений, помощник и перевод на GigaChat. Канал у них один: ключ,
 * очередь и память об ответах общие, иначе разбор и перевод одного обращения
 * ушли бы в модель двумя параллельными запросами.
 */
export const createGigaChat = (options: GigaChatOptions): { reasoner: Reasoner; translate: TextTranslator } => {
  const ask = createChat(chatOptions(options));

  return { reasoner: reasonerOver(ask), translate: translatorOver(ask) };
};

/** Разбор обращений и помощник на GigaChat. */
export const createGigaChatReasoner = (options: GigaChatOptions): Reasoner =>
  reasonerOver(createChat(chatOptions(options)));

/** Модель из настроек окружения: сначала GigaChat, потом любая совместимая с OpenAI. */
export const gigaChatFromEnv = (
  env: Record<string, string | undefined>,
  onError?: (error: unknown) => void,
): { reasoner: Reasoner; translate: TextTranslator } | undefined => {
  const authKey = env['GIGACHAT_AUTH_KEY']?.trim();

  if (!authKey) return undefined;

  return createGigaChat({
    authKey,
    ...(env['GIGACHAT_SCOPE']?.trim() ? { scope: env['GIGACHAT_SCOPE'].trim() } : {}),
    ...(env['GIGACHAT_MODEL']?.trim() ? { model: env['GIGACHAT_MODEL'].trim() } : {}),
    ...(env['GIGACHAT_URL']?.trim() ? { endpoint: env['GIGACHAT_URL'].trim() } : {}),
    ...(onError ? { onError } : {}),
  });
};
