import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHttpMeterVision, meterVisionFromEnv, parseReading } from '../dist/meter-vision.js';

const IMAGE = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

const stub = (answer: { body?: unknown; status?: number }) => {
  const calls: { url: string; method: string; headers?: HeadersInit }[] = [];

  const fetchStub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? 'GET',
      ...(init?.headers === undefined ? {} : { headers: init.headers }),
    });

    return Promise.resolve(
      new Response(JSON.stringify(answer.body ?? {}), {
        status: answer.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { fetchStub, calls };
};

describe('распознавание показаний', () => {
  it('отдаёт число, которое ответила служба', async () => {
    const { fetchStub, calls } = stub({ body: { value: 126.5 } });
    const vision = createHttpMeterVision({ endpoint: 'https://ocr.test/read', fetch: fetchStub });

    assert.equal(await vision.read(IMAGE), 126.5);
    assert.equal(calls[0]?.method, 'POST');
    assert.equal(calls[0]?.url, 'https://ocr.test/read');
  });

  it('читает табло строкой: ведущие нули и запятая, обычное дело', () => {
    assert.equal(parseReading({ text: '00126,5' }), 126.5);
    assert.equal(parseReading({ text: 'м³ 4660' }), 4660);
    assert.equal(parseReading({ value: '000042' }), 42);
  });

  it('не выдумывает показание из мусора', () => {
    assert.equal(parseReading({ text: 'не разобрал' }), undefined);
    assert.equal(parseReading({}), undefined);
    assert.equal(parseReading({ text: '1234567890' }), undefined);
    assert.equal(parseReading({ value: -5 }), undefined);
  });

  it('отказ службы гасится: показание вводят руками', async () => {
    const errors: unknown[] = [];
    const { fetchStub } = stub({ status: 503 });
    const vision = createHttpMeterVision({
      endpoint: 'https://ocr.test/read',
      fetch: fetchStub,
      onError: (error) => errors.push(error),
    });

    assert.equal(await vision.read(IMAGE), undefined);
    assert.equal(errors.length, 1);
  });

  it('без адреса службы распознавания нет', () => {
    assert.equal(meterVisionFromEnv({}), undefined);
    assert.notEqual(meterVisionFromEnv({ METER_VISION_URL: 'https://ocr.test/read' }), undefined);
  });
});
