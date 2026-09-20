import type { MeterVision } from '@domovoy/app';

/** Распознавание показаний через внешнюю службу. */
export interface HttpMeterVisionOptions {
  endpoint: string;
  apiKey?: string;
  model?: string;
  /** Сколько ждать ответа службы. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  onError?: (error: unknown) => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Табло у счётчика: шесть цифр и запятая. */
const MAX_DIGITS = 8;

/** Дробных разрядов у табло не больше четырёх: длиннее это два ряда цифр подряд. */
const MAX_FRACTION_DIGITS = 4;

/** Число в ответе службы: целое или с дробной частью через запятую либо точку. */
const NUMBER = /\d+(?:[.,]\d+)?/gu;

/**
 * Число из ответа службы. Разбор строгий: в ответе должно быть ровно одно
 * число. Два числа это серийный номер рядом с показанием или два ряда цифр,
 * и выбирать между ними продукт не берётся: показание уходит в начисление.
 */
export const parseReading = (body: unknown): number | undefined => {
  const source = body as { value?: unknown; text?: unknown };

  if (typeof source.value === 'number') {
    return Number.isFinite(source.value) && source.value >= 0 ? source.value : undefined;
  }

  const text = typeof source.text === 'string' ? source.text : typeof source.value === 'string' ? source.value : '';
  const found = [...new Set((text.match(NUMBER) ?? []).map((item) => item.replace(',', '.')))];

  if (found.length !== 1) return undefined;

  const digits = found[0]!;
  const fraction = digits.split('.')[1] ?? '';

  if (digits.replace('.', '').length > MAX_DIGITS || fraction.length > MAX_FRACTION_DIGITS) return undefined;

  const parsed = Number(digits);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

/** Больше этого не скачиваем: фотография табло в мегабайты не укладывается. */
const MAX_BYTES = 10 * 1024 * 1024;

export const createHttpMeterVision = (options: HttpMeterVisionOptions): MeterVision => {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const vision: MeterVision = {
    async readUrl(url) {
      if (!url.startsWith('http://') && !url.startsWith('https://')) return undefined;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await doFetch(url, { signal: controller.signal });

        if (!response.ok) return undefined;

        const image = await response.blob();

        return image.size > MAX_BYTES ? undefined : vision.read(image);
      } catch (error) {
        options.onError?.(error);
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },

    async read(image) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const form = new FormData();

        form.append('file', image, 'meter.jpg');
        if (options.model) form.append('model', options.model);

        const response = await doFetch(options.endpoint, {
          method: 'POST',
          signal: controller.signal,
          ...(options.apiKey ? { headers: { authorization: `Bearer ${options.apiKey}` } } : {}),
          body: form,
        });

        if (!response.ok) {
          options.onError?.(new Error(`Служба распознавания показаний ответила ${response.status}`));
          return undefined;
        }

        return parseReading(await response.json());
      } catch (error) {
        options.onError?.(error);
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
  };

  return vision;
};

/** Без адреса службы, `undefined`: показания вводятся цифрами. */
export const meterVisionFromEnv = (
  env: Record<string, string | undefined>,
  onError?: (error: unknown) => void,
): MeterVision | undefined => {
  const endpoint = env['METER_VISION_URL'];

  if (!endpoint) return undefined;

  return createHttpMeterVision({
    endpoint,
    ...(env['METER_VISION_KEY'] ? { apiKey: env['METER_VISION_KEY'] } : {}),
    ...(env['METER_VISION_MODEL'] ? { model: env['METER_VISION_MODEL'] } : {}),
    ...(onError ? { onError } : {}),
  });
};
