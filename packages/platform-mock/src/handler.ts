import type { PlatformState } from './state.js';

export interface MockRequest {
  method: string;
  /** Путь без ведущего слэша, например `chats/42/members`. */
  path: string;
  query: Record<string, string>;
  body: unknown;
  token: string | null;
}

export interface MockResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface HandlerOptions {
  /** Ожидаемый токен. `null`, принимать любой непустой. */
  expectedToken: string | null;
  /** Свой адрес: по нему клиент забирает файл на загрузку. */
  baseUrl?: string;
  /** Максимальное ожидание в долгом опросе, чтобы тесты не висели. */
  maxPollTimeoutMs: number;
  now: () => number;
}

const ok = (body: unknown = { success: true }): MockResponse => ({ status: 200, body });

const error = (status: number, code: string, message: string): MockResponse => ({
  status,
  body: { code, message },
});

/** Сопоставляет путь с шаблоном вида `chats/{chat_id}/members`. */
const match = (template: string, path: string): Record<string, string> | null => {
  const templateParts = template.split('/');
  const pathParts = path.split('/');
  if (templateParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (const [index, part] of templateParts.entries()) {
    const value = pathParts[index]!;

    if (part.startsWith('{') && part.endsWith('}')) {
      params[part.slice(1, -1)] = decodeURIComponent(value);
      continue;
    }

    if (part !== value) return null;
  }

  return params;
};

const number = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Приём файла по выданному адресу: платформа отвечает токеном вложения. */
const upload = (state: PlatformState, request: MockRequest): MockResponse => {
  const type = request.path.slice('upload/'.length);

  if (request.method !== 'POST') return error(405, 'method.not.allowed', 'Файл загружают методом POST');

  state.uploads.push({ type });

  return ok(
    type === 'image'
      ? { photos: { [`photo-${state.uploads.length}`]: { token: `upload-token-${type}` } } }
      : { token: `upload-token-${type}` },
  );
};

/** Обработчик запросов Bot API. */
export const handleRequest = async (
  state: PlatformState,
  request: MockRequest,
  options: HandlerOptions,
): Promise<MockResponse> => {
  state.log({
    method: request.method,
    path: request.path,
    query: request.query,
    body: request.body,
    at: options.now(),
  });

  // Загрузка файла идёт по выданному адресу, а не по Bot API: токен там свой.
  if (request.path.startsWith('upload/')) return upload(state, request);

  if (!request.token) return error(401, 'verify.token', 'Empty access_token');
  if (options.expectedToken !== null && request.token !== options.expectedToken) {
    return error(401, 'verify.token', 'Invalid access_token');
  }

  const { method, path } = request;
  const body = (request.body ?? {}) as Record<string, unknown>;

  if (method === 'GET' && path === 'me') {
    return ok({ ...state.bot, last_activity_time: options.now() });
  }

  if (method === 'PATCH' && path === 'me/commands') {
    return ok({ commands: body['commands'] ?? [] });
  }

  if (method === 'GET' && path === 'updates') {
    const marker = number(request.query['marker']);
    const limit = number(request.query['limit']) ?? 100;
    const timeoutSeconds = number(request.query['timeout']) ?? 30;
    const timeoutMs = Math.min(timeoutSeconds * 1000, options.maxPollTimeoutMs);

    await state.waitForUpdates(marker ?? state.nextMarker, timeoutMs);
    return ok(state.read(marker, limit));
  }

  if (method === 'POST' && path === 'messages') {
    const chatId = number(request.query['chat_id']);
    const userId = number(request.query['user_id']);
    const text = typeof body['text'] === 'string' ? body['text'] : '';
    const attachments = Array.isArray(body['attachments']) ? (body['attachments'] as unknown[]) : [];

    const sent = state.recordSent({
      ...(chatId !== undefined ? { chatId } : {}),
      ...(userId !== undefined ? { userId } : {}),
      text,
      attachments,
      body,
    });

    return ok({
      message: {
        sender: state.bot,
        recipient: { chat_id: chatId ?? userId, chat_type: chatId ? 'chat' : 'dialog', user_id: userId },
        timestamp: sent.at,
        body: { mid: sent.mid, seq: state.outgoing.length, text, attachments },
      },
    });
  }

  const comments = match('messages/{message_id}/comments', path);

  if (comments && method === 'POST') {
    const postId = comments['message_id'] ?? '';
    const text = typeof body['text'] === 'string' ? body['text'] : '';
    const sent = state.recordSent({ postId, text, attachments: [], body });

    return ok({
      message: {
        sender: state.bot,
        recipient: { chat_id: null, chat_type: 'channel', user_id: null, post_id: postId },
        timestamp: sent.at,
        body: { mid: sent.mid, seq: state.outgoing.length, text, attachments: [] },
      },
    });
  }

  if (comments) return ok({ comments: [] });

  if (method === 'GET' && path === 'messages') return ok({ messages: [] });
  if (method === 'PUT' && path === 'messages') {
    state.editMessage(request.query['message_id'] ?? '', body);

    return ok();
  }
  if (method === 'DELETE' && path === 'messages') {
    state.forgetMessage(request.query['message_id'] ?? '');

    return ok();
  }
  if (method === 'POST' && path === 'answers') {
    state.recordAnswer({
      callbackId: request.query['callback_id'] ?? '',
      ...(typeof body['notification'] === 'string' ? { notification: body['notification'] } : {}),
      body,
    });

    return ok();
  }

  if (path === 'subscriptions') {
    if (method === 'GET') return ok({ subscriptions: [...state.subscriptions] });

    if (method === 'POST') {
      state.subscriptions.push({
        url: typeof body['url'] === 'string' ? body['url'] : '',
        ...(typeof body['secret'] === 'string' ? { secret: body['secret'] } : {}),
        ...(Array.isArray(body['update_types']) ? { update_types: body['update_types'] as string[] } : {}),
      });
      return ok();
    }

    if (method === 'DELETE') {
      const url = request.query['url'];
      const index = state.subscriptions.findIndex((subscription) => subscription.url === url);
      if (index !== -1) state.subscriptions.splice(index, 1);
      return ok();
    }
  }

  if (method === 'GET' && path === 'chats') return ok({ chats: [], marker: null });

  const chat = match('chats/{chat_id}', path);
  if (chat && method === 'GET') {
    return ok({ chat_id: Number(chat['chat_id']), type: 'chat', status: 'active', title: 'Тестовый чат' });
  }

  if (method === 'POST' && path === 'uploads') {
    const type = request.query['type'] ?? 'file';
    const base = options.baseUrl ?? 'http://127.0.0.1';

    return ok({ url: `${base}/upload/${type}`, token: `upload-token-${type}` });
  }


  const pin = match('chats/{chat_id}/pin', path);

  if (pin) {
    const chatId = Number(pin['chat_id']);

    if (method === 'PUT') {
      state.pinned.set(chatId, {
        messageId: typeof body['message_id'] === 'string' ? body['message_id'] : '',
        senderId: state.bot.user_id,
      });
      return ok();
    }

    if (method === 'DELETE') {
      state.pinned.delete(chatId);
      return ok();
    }

    if (method === 'GET') {
      const pinnedMessage = state.pinned.get(chatId);

      return ok(
        pinnedMessage
          ? {
              message: {
                sender: { ...state.bot, user_id: pinnedMessage.senderId },
                recipient: { chat_id: chatId, chat_type: 'chat', user_id: null },
                timestamp: options.now(),
                body: { mid: pinnedMessage.messageId, seq: 0, text: '' },
              },
            }
          : {},
      );
    }
  }

  const membership = match('chats/{chat_id}/members/me', path);

  if (membership && method === 'GET') {
    return ok({
      ...state.bot,
      is_owner: false,
      is_admin: true,
      join_time: options.now(),
      last_access_time: options.now(),
      permissions: state.botPermissions,
    });
  }

  if (path.startsWith('chats/')) return ok();

  return error(404, 'not.found', `Path /${path} is not recognized`);
};
