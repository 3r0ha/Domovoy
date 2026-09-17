import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Bot API MAX отдаёт сертификат «Russian Trusted Sub CA». Без корня этой цепочки
 * бот не получает апдейты, поэтому корень лежит в репозитории и подключается
 * переменной `NODE_EXTRA_CA_CERTS`.
 */
const PEM = new URL('../../../certs/russian-trusted-root-ca.pem', import.meta.url);

describe('корень доверия платформы', () => {
  it('лежит в репозитории и читается', () => {
    const cert = new X509Certificate(readFileSync(PEM));

    assert.match(cert.subject, /Russian Trusted Root CA/);
    assert.equal(cert.ca, true, 'это должен быть удостоверяющий центр');
  });

  it('действует в момент проверки', () => {
    const cert = new X509Certificate(readFileSync(PEM));
    const now = Date.now();

    assert.ok(Date.parse(cert.validFrom) < now, 'сертификат ещё не начал действовать');
    assert.ok(Date.parse(cert.validTo) > now, 'сертификат просрочен: нужен свежий корень');
  });

  it('образ подключает его переменной окружения', () => {
    const dockerfile = readFileSync(new URL('../../../Dockerfile', import.meta.url), 'utf8');

    assert.match(dockerfile, /COPY --from=build \/app\/certs \.\/certs/);
    assert.match(dockerfile, /ENV NODE_EXTRA_CA_CERTS=\/app\/certs\/russian-trusted-root-ca\.pem/);
  });
});
