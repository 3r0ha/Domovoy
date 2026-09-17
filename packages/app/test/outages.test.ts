import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DomainError } from '@domovoy/domain';

import {
  InMemoryRepository,
  chargesForResident,
  createServiceRequest,
  devicesFor,
  openDevice,
  payCharges,
  transitionRequest,
  type AppDeps,
  type Notifier,
  type Resident,
} from '../dist/index.js';

const BUILDING_ID = 'b1';

const APARTMENTS = [{ id: 'apt-1', buildingId: BUILDING_ID, number: 1, entrance: 1, riser: 1, area: 50 }];

const maria: Resident = {
  id: 'res-1',
  maxUserId: 1001,
  displayName: 'Мария',
  role: 'resident',
  apartmentId: 'apt-1',
  apartmentIds: ['apt-1'],
  buildingId: BUILDING_ID,
};

const dispatcher: Resident = {
  id: 'disp-1',
  maxUserId: 5005,
  displayName: 'Ольга',
  role: 'dispatcher',
  buildingId: BUILDING_ID,
};

/** Канал, который падает на каждой отправке: так ведёт себя недоступная платформа. */
const brokenNotifier = (): Notifier & { failures: unknown[] } => {
  const failures: unknown[] = [];

  return {
    failures,
    async send() {
      throw new Error('MAX недоступен');
    },
    onError(error) {
      failures.push(error);
    },
  };
};

const setup = (notifier?: Notifier): AppDeps => {
  let counter = 0;

  return {
    repository: new InMemoryRepository({
      buildings: [{ id: BUILDING_ID, code: 'Д15', address: 'ул. Ленина, 15' }],
      apartments: APARTMENTS,
      residents: [maria, dispatcher],
    }),
    now: () => new Date('2026-09-22T10:00:00Z'),
    createId: () => `id-${++counter}`,
    defaultBuildingId: BUILDING_ID,
    ...(notifier ? { notifier } : {}),
  };
};

describe('отказ внешней службы', () => {
  it('недоступный канал уведомлений не отменяет перевод заявки', async () => {
    const notifier = brokenNotifier();
    const deps = setup(notifier);

    const request = await createServiceRequest(deps, { resident: maria, description: 'Течёт кран на кухне' });

    const moved = await transitionRequest(deps, {
      resident: dispatcher,
      requestId: request.id,
      to: 'accepted',
    });

    assert.equal(moved.status, 'accepted');
    assert.equal((await deps.repository.findRequest(request.id))?.status, 'accepted');
    assert.ok(notifier.failures.length > 0, 'об отказе доставки продукт узнал');
  });

  it('недоступная домофония отвечает «служба не отвечает», а не падением', async () => {
    const deps: AppDeps = {
      ...setup(),
      hub: {
        async list() {
          throw new Error('домофония недоступна');
        },
        async open() {
          throw new Error('домофония недоступна');
        },
        async snapshot() {
          throw new Error('домофония недоступна');
        },
        async issueGuestCode() {
          throw new Error('домофония недоступна');
        },
        async revokeCode() {
          throw new Error('домофония недоступна');
        },
        async journal() {
          throw new Error('домофония недоступна');
        },
        async openWithCode() {
          throw new Error('домофония недоступна');
        },
        async activeCodes() {
          throw new Error('домофония недоступна');
        },
      },
    };

    await assert.rejects(devicesFor(deps, maria, 1), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, 'devices_unavailable');
      return true;
    });

    await assert.rejects(openDevice(deps, maria, 'intercom-1'), /не отвечает|не подключён/);
  });

  it('недоступный платёжный шлюз не роняет квитанцию пятисоткой', async () => {
    const deps: AppDeps = {
      ...setup(),
      payments: {
        async paid() {
          throw new Error('шлюз недоступен');
        },
        async pay() {
          throw new Error('шлюз недоступен');
        },
        async history() {
          return [];
        },
      },
    };

    await assert.rejects(chargesForResident(deps, maria), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, 'payments_unavailable');
      return true;
    });

    await assert.rejects(payCharges(deps, maria), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, 'payments_unavailable');
      return true;
    });
  });
});
