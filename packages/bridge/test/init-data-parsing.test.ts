import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDataCheckString, parseInitData } from '../dist/index.js';

describe('разбор initData и разделители в значениях', () => {
  /** Платформа подписывает строку запуска целиком, поэтому подделать её нельзя. */
  const forged = JSON.stringify({ id: 999 });
  const initData = [
    `user=${encodeURIComponent(JSON.stringify({ id: 1, first_name: 'Настоящий' }))}`,
    'auth_date=1756800000',
    `start_param=${encodeURIComponent(`a&user=${forged}`)}`,
  ].join('&');

  it('значение start_param не подменяет пользователя', () => {
    const parsed = parseInitData(initData);

    assert.equal(parsed.user?.id, 1, 'идентификатор пользователя взят из подписанного параметра');
    assert.equal(parsed.user?.first_name, 'Настоящий');
    assert.equal(parsed.start_param, `a&user=${forged}`, 'значение осталось значением целиком');
  });

  it('строка проверки подписи видит те же пары, что и разбор', () => {
    const { dataCheckString } = buildDataCheckString(initData);

    assert.equal(
      dataCheckString,
      `auth_date=1756800000\nstart_param=a&user=${forged}\nuser=${JSON.stringify({ id: 1, first_name: 'Настоящий' })}`,
      'ровно три пары: лишних параметров разделители внутри значения не создают',
    );
  });

  it('разбирает значения с процентом', () => {
    const parsed = parseInitData(`start_param=${encodeURIComponent('скидка 50% на всё')}&auth_date=1`);

    assert.equal(parsed.start_param, 'скидка 50% на всё');
  });

  it('плюс в значении остаётся пробелом, как того требует форма query', () => {
    const parsed = parseInitData('start_param=a+b&auth_date=1');

    assert.equal(parsed.start_param, 'a b');
  });
});
