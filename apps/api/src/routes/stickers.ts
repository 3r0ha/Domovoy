import { drawSticker, sendSticker, sendStickerSheet, stickerStyles, stickersFor } from '@domovoy/app';
import { STICKER_NOTE_MAX_LENGTH, describeTarget } from '@domovoy/domain';
import type { FastifyPluginAsync } from 'fastify';

import { buildingIdSchema, buildingQuerySchema, sentStickerSchema, stickersSchema } from '../serialize.js';
import { residentReader, type RoutesDeps } from '../context.js';

/** Длина кода объекта в ссылке: он же имя файла наклейки. */
const PAYLOAD_MAX_LENGTH = 128;

const lookSchema = {
  style: { type: 'string', maxLength: 32 },
  note: { type: 'string', maxLength: STICKER_NOTE_MAX_LENGTH },
} as const;

/** Наклейки с кодами объектов: их печатают, пересылают и сохраняют. */
export const stickerRoutes: FastifyPluginAsync<RoutesDeps> = async (scope, deps) => {
  const currentResident = residentReader(deps);

  /** На что можно сделать наклейку: смене, весь дом, жильцу, его подъезд и квартира. */
  scope.get<{ Querystring: { buildingId?: string } }>(
    '/api/stickers',
    {
      schema: {
        querystring: buildingQuerySchema,
        response: { 200: stickersSchema },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);
      const plans = await stickersFor(deps, resident, request.query.buildingId);

      return {
        styles: stickerStyles(),
        objects: plans.map((plan) => ({
          payload: plan.payload,
          caption: plan.caption,
          link: plan.link,
          kind: plan.target.kind,
          target: describeTarget(plan.target),
        })),
      };
    },
  );

  /** Картинка наклейки: её показывают на экране и из неё делают файл. */
  scope.get<{ Querystring: { payload: string; style?: string; note?: string; buildingId?: string } }>(
    '/api/stickers/image',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['payload'],
          properties: {
            payload: { type: 'string', minLength: 1, maxLength: PAYLOAD_MAX_LENGTH },
            buildingId: buildingIdSchema,
            ...lookSchema,
          },
        },
      },
    },
    async (request, reply) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);

      const { svg } = await drawSticker(deps, resident, request.query.payload, {
        ...(request.query.style ? { style: request.query.style as never } : {}),
        ...(request.query.note ? { note: request.query.note } : {}),
      });

      return reply.type('image/svg+xml; charset=utf-8').send(svg);
    },
  );

  /**
   * Наклейка уходит человеку в переписку с ботом. Оттуда её пересылают в любой
   * чат и сохраняют к себе, а приложение пересылает её по идентификатору сообщения.
   */
  scope.post<{
    Querystring: { buildingId?: string };
    Body: { payload: string; style?: string; note?: string; as?: 'image' | 'document' };
  }>(
    '/api/stickers/send',
    {
      schema: {
        querystring: buildingQuerySchema,
        body: {
          type: 'object',
          required: ['payload'],
          additionalProperties: false,
          properties: {
            payload: { type: 'string', minLength: 1, maxLength: PAYLOAD_MAX_LENGTH },
            as: { type: 'string', enum: ['image', 'document'] },
            ...lookSchema,
          },
        },
        response: {
          200: sentStickerSchema,
        },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);

      const sent = await sendSticker(deps, {
        resident,
        payload: request.body.payload,
        ...(request.body.style ? { style: request.body.style } : {}),
        ...(request.body.note ? { note: request.body.note } : {}),
        ...(request.body.as ? { as: request.body.as } : {}),
      });

      return {
        caption: sent.plan.caption,
        payload: sent.plan.payload,
        link: sent.plan.link,
        as: sent.as,
        ...(sent.messageId ? { messageId: sent.messageId } : {}),
      };
    },
  );

  /** Лист для печати всего дома: его открывают файлом и печатают. */
  scope.post<{ Querystring: { buildingId?: string } }>(
    '/api/stickers/sheet',
    {
      schema: {
        querystring: buildingQuerySchema,
        response: {
          200: {
            type: 'object',
            required: ['count'],
            properties: {
              count: { type: 'integer' },
              address: { type: 'string' },
              messageId: { type: 'string' },
            },
          },
        },
      },
    },
    async (request) => {
      const resident = await currentResident(request.max.userId, request.query.buildingId);

      return sendStickerSheet(deps, resident, request.query.buildingId);
    },
  );
};
