import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyTransition,
  audienceForTarget,
  buildBotDeepLink,
  buildDeepLink,
  compareByUrgency,
  createRequest,
  timeToDeadline,
  describeAudience,
  describeTarget,
  isInAudience,
  type Apartment,
  type ServiceRequest,
} from '../dist/index.js';

const CREATED_AT = new Date('2026-09-03T10:00:00Z');

const request = (overrides: Partial<Parameters<typeof createRequest>[0]> = {}): ServiceRequest =>
  createRequest({
    id: 'req-1',
    buildingId: 'b1',
    buildingCode: 'Д15',
    sequence: 1,
    authorId: 'user-1',
    category: 'plumbing',
    target: { kind: 'apartment', apartmentId: 'apt-1' },
    description: 'Течёт кран',
    createdAt: CREATED_AT,
    ...overrides,
  });

describe('описание адресата', () => {
  it('называет каждый вид адресата словами жильца', () => {
    assert.equal(describeAudience({ kind: 'building', buildingId: 'b1' }), 'весь дом');
    assert.equal(describeAudience({ kind: 'entrance', buildingId: 'b1', entrance: 3 }), 'подъезд 3');
    assert.equal(describeAudience({ kind: 'riser', buildingId: 'b1', entrance: 3, riser: 2 }), 'подъезд 3, стояк 2');
  });

  it('описывает объект заявки для каждого вида', () => {
    assert.equal(describeTarget({ kind: 'building', buildingId: 'b1' }), 'дом целиком');
    assert.equal(describeTarget({ kind: 'entrance', buildingId: 'b1', entrance: 2 }), 'подъезд 2');
    assert.equal(describeTarget({ kind: 'riser', buildingId: 'b1', entrance: 2, riser: 1 }), 'подъезд 2, стояк 1');
    assert.equal(describeTarget({ kind: 'apartment', apartmentId: 'apt-1' }), 'квартира');
  });
});

describe('кого предупредить из-за заявки', () => {
  it('заявка по подъезду касается подъезда', () => {
    assert.deepEqual(audienceForTarget({ kind: 'entrance', buildingId: 'b1', entrance: 4 }), {
      kind: 'entrance',
      buildingId: 'b1',
      entrance: 4,
    });
  });

  it('поломка общего оборудования касается всего дома', () => {
    assert.deepEqual(audienceForTarget({ kind: 'equipment', buildingId: 'b1', equipmentId: 'lift-1' }), {
      kind: 'building',
      buildingId: 'b1',
    });
  });

  it('заявка по дому касается всего дома', () => {
    assert.deepEqual(audienceForTarget({ kind: 'building', buildingId: 'b1' }), { kind: 'building', buildingId: 'b1' });
  });
});

describe('попадание квартиры в адресата', () => {
  const apartment: Apartment = { id: 'a1', buildingId: 'b1', number: 5, entrance: 2, riser: 3 };

  it('дом целиком включает любую свою квартиру', () => {
    assert.equal(isInAudience(apartment, { kind: 'building', buildingId: 'b1' }), true);
  });

  it('чужой подъезд и чужой стояк не включаются', () => {
    assert.equal(isInAudience(apartment, { kind: 'entrance', buildingId: 'b1', entrance: 1 }), false);
    assert.equal(isInAudience(apartment, { kind: 'riser', buildingId: 'b1', entrance: 2, riser: 1 }), false);
    assert.equal(isInAudience(apartment, { kind: 'riser', buildingId: 'b1', entrance: 2, riser: 3 }), true);
  });
});

describe('ссылки для наклеек', () => {
  it('ссылка на бота и на приложение отличаются параметром', () => {
    const target = { kind: 'riser', buildingId: 'b1', entrance: 1, riser: 2 } as const;

    assert.equal(buildBotDeepLink('uk_bot', target), 'https://max.ru/uk_bot?start=rsr_b1_1_2');
    assert.equal(buildDeepLink('uk_bot', target), 'https://max.ru/uk_bot?startapp=rsr_b1_1_2');
  });

  it('слишком длинный идентификатор в ссылку не попадает', () => {
    const target = { kind: 'building', buildingId: 'b'.repeat(600) } as const;

    assert.throws(() => buildBotDeepLink('uk_bot', target), /ограничения платформы/);
  });
});

describe('порядок очереди при равных условиях', () => {
  it('из двух непросроченных первой идёт та, у которой срок ближе', () => {
    const soon = request({ id: 'soon', category: 'electricity' });
    const later = request({ id: 'later', category: 'cleaning' });
    const now = new Date(CREATED_AT.getTime() + 60_000);

    const sorted = [later, soon].sort((left, right) => compareByUrgency(left, right, now));

    assert.deepEqual(
      sorted.map((item) => item.id),
      ['soon', 'later'],
    );
  });

  it('непринятая заявка меряется сроком ответа, а принятая сроком работ', () => {
    const now = new Date(CREATED_AT.getTime() + 60_000);
    // Уборка: четыре часа на ответ и трое суток на работу.
    const fresh = request({ id: 'fresh', category: 'cleaning' });

    const accepted = applyTransition(request({ id: 'accepted', category: 'cleaning' }), {
      to: 'accepted',
      role: 'dispatcher',
      actorId: 'd1',
      at: CREATED_AT,
    });

    assert.ok(timeToDeadline(fresh, now) < timeToDeadline(accepted, now), 'у непринятой срок ближе');

    const sorted = [accepted, fresh].sort((left, right) => compareByUrgency(left, right, now));

    assert.deepEqual(
      sorted.map((item) => item.id),
      ['fresh', 'accepted'],
    );
  });

  it('из двух просроченных порядок тоже по остатку времени', () => {
    const veryLate = request({ id: 'very-late', category: 'electricity' });
    const late = request({ id: 'late', category: 'plumbing' });
    const now = new Date(CREATED_AT.getTime() + 30 * 24 * 3600_000);

    const sorted = [late, veryLate].sort((left, right) => compareByUrgency(left, right, now));

    assert.equal(sorted[0]?.id, 'very-late', 'кто просрочен сильнее, тот и первый');
  });
});
