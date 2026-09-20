import { DomainError, type Attachment } from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';

import { ServiceError } from '../errors.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Запись голоса: столько весит пара минут разговора в сжатом формате. */
const MAX_VOICE_BYTES = 2 * 1024 * 1024;

/** То же в base64: он весит на треть больше, плюс запас на заголовок data-URL. */
const VOICE_BASE64_MAX = Math.ceil(MAX_VOICE_BYTES / 3) * 4 + 64;

/** Предел тела запроса. Он же предел поля: длину самой записи проверяет не схема. */
const VOICE_BODY_LIMIT = VOICE_BASE64_MAX + 1024;

/** Что принимается записью голоса: форматы, в которых пишут браузер и клиент MAX. */
const VOICE_TYPES = new Set([
  'audio/ogg',
  'audio/opus',
  'audio/webm',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/x-aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
]);

/** Тип без параметров: браузер пишет `audio/webm;codecs=opus`. */
const mediaType = (contentType: string): string => contentType.split(';')[0]!.trim().toLowerCase();

/** Разбор base64: данные приходят и как есть, и заголовком data-URL. */
const decodeBase64 = (value: string): Buffer =>
  Buffer.from(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value, 'base64');

/** Расшифровка речи: в мини-приложении можно говорить, а не печатать. */
export const voiceRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  /**
   * Запись нигде не сохраняется: расшифровщику она уходит в самом токене
   * вложения, а наружу возвращается только текст.
   */
  scope.post<{ Body: { contentType: string; data: string } }>(
    '/api/voice',
    {
      bodyLimit: VOICE_BODY_LIMIT,
      schema: {
        body: {
          type: 'object',
          required: ['contentType', 'data'],
          properties: {
            contentType: { type: 'string', maxLength: 100 },
            data: { type: 'string', maxLength: VOICE_BODY_LIMIT },
          },
        },
        response: {
          200: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
        },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId);

      const { data } = request.body;
      const contentType = mediaType(request.body.contentType);

      if (!VOICE_TYPES.has(contentType)) throw new DomainError('file_type_not_allowed', 'Это не запись голоса');

      const bytes = decodeBase64(data);

      if (bytes.length === 0) throw new DomainError('file_empty', 'Запись пустая');

      if (bytes.length > MAX_VOICE_BYTES) {
        throw new DomainError('payload_too_long', 'Запись слишком длинная, скажите короче');
      }

      if (!deps.transcriber) throw new ServiceError('speech_unavailable', 'Расшифровка речи не подключена');

      const voice: Attachment = {
        kind: 'voice',
        token: `data:${contentType};base64,${bytes.toString('base64')}`,
      };

      // Отказ по самой записи (длина, формат) уходит как есть, молчание службы одним кодом.
      const recognized = await deps.transcriber.transcribe(voice, resident.language).catch((error: unknown) => {
        if (error instanceof DomainError) throw error;

        throw new ServiceError('speech_unavailable', 'Расшифровка не ответила. Попробуйте ещё раз или напишите');
      });

      const text = recognized?.trim();

      if (!text) throw new ServiceError('speech_not_recognized', 'Не разобрал речь. Скажите ещё раз или напишите');

      return { text };
    },
  );
};
