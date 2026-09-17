import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

import type { FastifyInstance } from 'fastify';

const toBrotli = promisify(brotliCompress);
const toGzip = promisify(gzip);

export interface CompressOptions {
  /** С какого размера сжимать: мелкий ответ от сжатия только растёт. */
  threshold?: number;
}

/** Что сжимается: ответы API это текст, картинки и шрифты сжаты своим форматом. */
const TEXTUAL = /json|text\/|javascript|xml|svg/;

/** Сжатая статика лежит готовой рядом с файлами, её трогать не нужно. */
const encodingOf = (accepted: string): 'br' | 'gzip' | undefined => {
  if (accepted.includes('br')) return 'br';

  return accepted.includes('gzip') ? 'gzip' : undefined;
};

/**
 * Ответы API уходят сжатыми, если клиент это понимает. Уровень средний:
 * дальше выигрыш в размере меньше, чем потеря времени на сжатие.
 */
export const applyCompression = (fastify: FastifyInstance, options: CompressOptions = {}): void => {
  const threshold = options.threshold ?? 1024;

  fastify.addHook('onSend', async (request, reply, payload) => {
    if (typeof payload !== 'string' || Buffer.byteLength(payload) < threshold) return payload;

    if (reply.getHeader('content-encoding')) return payload;

    if (!TEXTUAL.test(String(reply.getHeader('content-type') ?? ''))) return payload;

    const encoding = encodingOf(String(request.headers['accept-encoding'] ?? ''));

    if (!encoding) return payload;

    const packed =
      encoding === 'br'
        ? await toBrotli(payload, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
        : await toGzip(payload, { level: 6 });

    reply.header('content-encoding', encoding);
    reply.header('content-length', packed.length);
    reply.header('vary', 'accept-encoding');

    return packed;
  });
};
