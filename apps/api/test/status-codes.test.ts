import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STATUS_BY_CODE } from '../dist/index.js';

/** Смысл кода читается по его окончанию: так проще заметить неверный статус. */
const RULES: { match: RegExp; status: number; about: string }[] = [
  { match: /_not_found$|_unknown$/, status: 404, about: 'не найдено' },
  { match: /_unavailable$/, status: 503, about: 'внешняя служба не отвечает' },
  { match: /^file_too_large$|^payload_too_long$|^message_too_long$/, status: 413, about: 'запрос слишком велик' },
];

describe('коды отказов и ответы HTTP', () => {
  it('каждый код домена получает свой статус, а не общий четырёхсотый', () => {
    const codes = Object.keys(STATUS_BY_CODE);

    assert.ok(codes.length > 70, `кодов в таблице: ${codes.length}`);

    for (const [code, status] of Object.entries(STATUS_BY_CODE)) {
      assert.ok(status >= 400 && status < 600, `${code}: ${status}`);
    }
  });

  it('окончание кода соответствует статусу', () => {
    const wrong: string[] = [];

    for (const [code, status] of Object.entries(STATUS_BY_CODE)) {
      for (const rule of RULES) {
        if (!rule.match.test(code)) continue;
        // «квартира не привязана» это состояние человека, а не отсутствие объекта,
        // а «вид уведомления неизвестен» это значение поля запроса.
        if (code === 'apartment_not_bound' || code === 'resident_not_found' || code === 'notice_unknown') continue;

        if (status !== rule.status) wrong.push(`${code}: ${status}, ожидался ${rule.status} (${rule.about})`);
      }
    }

    assert.deepEqual(wrong, []);
  });

  it('сессия без профиля отвечает 401, а нехватка прав 403', () => {
    assert.equal(STATUS_BY_CODE.resident_not_found, 401);
    assert.equal(STATUS_BY_CODE.forbidden, 403);
    assert.equal(STATUS_BY_CODE.role_self_change, 403);
    assert.equal(STATUS_BY_CODE.duty_for_staff_only, 403);
  });

  it('длина поля это разбор запроса, а не размер тела', () => {
    for (const code of ['description_too_long', 'initiative_too_long', 'reading_too_large'] as const) {
      assert.equal(STATUS_BY_CODE[code], 400, code);
    }
  });

  it('конфликт состояния отвечает 409, а не 400', () => {
    for (const code of ['request_closed', 'transition_not_allowed', 'poll_closed', 'nothing_to_pay'] as const) {
      assert.equal(STATUS_BY_CODE[code], 409, code);
    }
  });
});
