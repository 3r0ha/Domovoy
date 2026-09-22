import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { InMemoryRepository } from '@domovoy/app';

import { buildServer } from '../dist/index.js';

/**
 * Полный список маршрутов. Он существует затем, чтобы перестановка файлов
 * адаптера не потеряла маршрут молча: список меняется вместе с продуктом,
 * но только осознанно.
 */
const ROUTES = [
  'DELETE /api/buildings/chat',
  'DELETE /api/flat/neighbours/{id}',
  'DELETE /api/me',
  'DELETE /api/me/contact',
  'DELETE /api/requests/{id}/visit',
  'GET /api/ahead',
  'GET /api/announcements',
  'GET /api/apartments',
  'GET /api/assistant',
  'GET /api/audit',
  'GET /api/broadcast/targets',
  'GET /api/buildings',
  'GET /api/buildings/report',
  'GET /api/capital-repair',
  'GET /api/charges',
  'GET /api/connect',
  'GET /api/context/{startParam}',
  'GET /api/debtors',
  'GET /api/demo',
  'GET /api/devices',
  'GET /api/devices/guest-codes',
  'GET /api/devices/journal',
  'GET /api/devices/sensors',
  'GET /api/devices/{id}/snapshot',
  'GET /api/equipment',
  'GET /api/export/readings.csv',
  'GET /api/export/readings.xlsx',
  'GET /api/files/{id}',
  'GET /api/flat/neighbours',
  'GET /api/handoffs',
  'GET /api/house-meters',
  'GET /api/house/contacts',
  'GET /api/initiatives',
  'GET /api/inspections',
  'GET /api/languages',
  'GET /api/legal',
  'GET /api/me',
  'GET /api/me/apartments',
  'GET /api/me/data',
  'GET /api/me/notices',
  'GET /api/meters',
  'GET /api/meters/progress',
  'GET /api/meters/{id}/history',
  'GET /api/now',
  'GET /api/objects/{startParam}',
  'GET /api/payments',
  'GET /api/plan',
  'GET /api/polls',
  'GET /api/polls/{id}/protocol',
  'GET /api/polls/{id}/protocol.txt',
  'GET /api/quality',
  'GET /api/reception',
  'GET /api/report',
  'GET /api/report/digest',
  'GET /api/report/requests.csv',
  'GET /api/report/requests.xlsx',
  'GET /api/requests',
  'GET /api/requests/house',
  'GET /api/requests/{id}',
  'GET /api/requests/{id}/actions',
  'GET /api/requests/{id}/clarify',
  'GET /api/requests/{id}/complaint',
  'GET /api/requests/{id}/contact',
  'GET /api/requests/{id}/responsibility',
  'GET /api/residents',
  'GET /api/residents/unbound',
  'GET /api/staff',
  'GET /api/stickers',
  'GET /api/stickers/image',
  'GET /api/support',
  'GET /api/support/waiting',
  'GET /api/support/{id}',
  'GET /api/tariffs',
  'GET /api/visits',
  'GET /api/workday',
  'GET /health',
  'POST /api/announcements',
  'POST /api/assistant',
  'POST /api/broadcast',
  'POST /api/broadcast/preview',
  'POST /api/buildings',
  'POST /api/buildings/card',
  'POST /api/buildings/handover',
  'POST /api/charges/debt/pay',
  'POST /api/charges/pay',
  'POST /api/connect',
  'POST /api/debtors/{id}/remind',
  'POST /api/demo',
  'POST /api/devices/guest-codes/{code}/revoke',
  'POST /api/devices/{id}/guest',
  'POST /api/devices/{id}/open',
  'POST /api/export/readings/send',
  'POST /api/files',
  'POST /api/flat/ownership',
  'POST /api/handoffs/{id}/answer',
  'POST /api/house-meters',
  'POST /api/house-meters/{id}/readings',
  'POST /api/import/apartments',
  'POST /api/import/equipment',
  'POST /api/initiatives',
  'POST /api/initiatives/{id}/meeting',
  'POST /api/initiatives/{id}/support',
  'POST /api/inspections/{id}/items/{index}',
  'POST /api/inspections/{id}/prove',
  'POST /api/me/apartment',
  'POST /api/me/apartment/use',
  'POST /api/me/contact',
  'POST /api/me/language',
  'POST /api/me/legal',
  'POST /api/me/logout',
  'POST /api/me/name',
  'POST /api/me/notices',
  'POST /api/meters/{id}/photo',
  'POST /api/meters/{id}/readings',
  'POST /api/polls',
  'POST /api/polls/elder',
  'POST /api/polls/{id}/vote',
  'POST /api/reception',
  'POST /api/report/requests/send',
  'POST /api/requests',
  'POST /api/requests/{id}/answer',
  'POST /api/requests/{id}/comment',
  'POST /api/requests/{id}/complaint',
  'POST /api/requests/{id}/dispute',
  'POST /api/requests/{id}/handoff',
  'POST /api/requests/{id}/knock',
  'POST /api/requests/{id}/support',
  'POST /api/requests/{id}/target',
  'POST /api/requests/{id}/transition',
  'POST /api/requests/{id}/visit',
  'POST /api/requests/{id}/visit/missed',
  'POST /api/requests/{id}/visit/offer',
  'POST /api/residents/{id}/apartment',
  'POST /api/residents/{id}/buildings',
  'POST /api/residents/{id}/duty',
  'POST /api/residents/{id}/role',
  'POST /api/residents/{id}/unbind',
  'POST /api/staff/ownership',
  'POST /api/stickers/send',
  'POST /api/stickers/sheet',
  'POST /api/support',
  'POST /api/support/{id}/answer',
  'POST /api/support/{id}/close',
  'POST /api/tariffs',
  'POST /api/visits',
  'POST /api/visits/record',
  'POST /api/visits/{id}/cancel',
  'POST /api/visits/{id}/done',
  'POST /api/voice',
  'POST /auth/session',
];

const WEB_DIR = await mkdtemp(join(tmpdir(), 'domovoy-inventory-'));

await writeFile(join(WEB_DIR, 'index.html'), '<!doctype html><title>Домовой</title>');

describe('инвентарь маршрутов', () => {
  it('совпадает со списком, который продукт обещает', async () => {
    const app = await buildServer({
      botToken: 'inventory-bot-token',
      repository: new InMemoryRepository({ buildings: [{ id: 'b1', code: 'Д15' }], apartments: [] }),
      defaultBuildingId: 'b1',
      rateLimit: false,
    });

    const { paths } = (await app.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, unknown>>;
    }>();

    const found = Object.entries(paths)
      .flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`))
      .sort();

    assert.deepEqual(found, ROUTES);

    await app.close();
  });
});
