# Корневой сертификат для Bot API MAX

`platform-api2.max.ru`, к которому ходит чат-бот, отдаёт сертификат, выпущенный
«Russian Trusted Sub CA». Корень этой цепочки, «Russian Trusted Root CA», не входит
в набор доверенных корней Node.js, поэтому без него любой запрос к Bot API падает
с `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, а бот не получает апдейты.

| Поле | Значение |
| --- | --- |
| Файл | `russian-trusted-root-ca.pem` |
| Субъект | `C=RU, O=The Ministry of Digital Development and Communications, CN=Russian Trusted Root CA` |
| Срок | 1 марта 2022 - 27 февраля 2032 |
| Отпечаток SHA-256 | `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31` |
| Источник | https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt |

Это требование самой платформы: с 19 июля 2026 года запросы идут на `platform-api2.max.ru`,
и сертификат Минцифры нужно добавить в доверенные
([история изменений API MAX](https://dev.max.ru/docs-api/changelog-api)).

Как используется:

- в образе он лежит рядом с продуктом, а `NODE_EXTRA_CA_CERTS` задан в `Dockerfile`;
- при запуске без Docker переменную задают самостоятельно:
  `NODE_EXTRA_CA_CERTS=./certs/russian-trusted-root-ca.pem npm start --workspace @domovoy/server`.

`NODE_EXTRA_CA_CERTS` добавляет корень к набору Node.js, а не заменяет его: остальные
проверки сертификатов работают как прежде.

Проверить, что связь с платформой есть:

```bash
NODE_EXTRA_CA_CERTS=./certs/russian-trusted-root-ca.pem \
  node -e 'fetch("https://platform-api2.max.ru/me?access_token=x").then(r => console.log(r.status))'
```

Ответ `401` означает, что сертификат принят и платформа отвечает; `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
означает, что корень не подключён.
