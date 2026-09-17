# @maxkit/platform-mock

Локальная замена Bot API платформы MAX. Отвечает на те же пути, что вызывает официальный SDK,
и умеет ломаться по команде.

Решает две задачи. Первая, разработка без токена: подключение к платформе для партнёров доступно
юрлицам, ИП и самозанятым, резидентам РФ, а верификация занимает до 48 рабочих часов. До получения
токена написать и проверить бота негде. Вторая, проверка поведения при сбоях: `429`, обрывы
соединения, зависшие ответы и таймауты нельзя вызвать на настоящей платформе по требованию,
а именно они ломают ботов в проде.

## Запуск

```ts
import { startMockPlatform } from '@maxkit/platform-mock';
import { Bot } from '@maxhub/max-bot-api';

const platform = await startMockPlatform({ token: 'test-token' });

const bot = new Bot('test-token', { clientOptions: { baseUrl: platform.url } });
bot.on('message_created', (ctx) => ctx.reply(`Принято: ${ctx.message.body.text}`));
```

## Сценарий

```ts
platform.userSends('течёт кран');                 // пользователь пишет боту
platform.userPressesButton('request:accept');     // нажимает кнопку
platform.botStarted();                            // запускает бота
platform.pushUpdate(customUpdate);                // любой апдейт целиком

const [sent] = await platform.waitForOutgoing(1); // ждём ответ бота
assert.equal(sent.text, 'Принято: течёт кран');

platform.requests;   // журнал всех запросов бота
platform.outgoing;   // всё, что бот отправил
platform.reset();    // чистое состояние между тестами
```

## Общий чат

```ts
platform.botAdded({ userId: 7007, chatId: 500 });      // бота добавили в чат
platform.userAdded({ userId: 4004, chatId: 500 });     // в чат вошёл участник
platform.botRemoved({ chatId: 500 });                  // бота выгнали

platform.chatSends('в подъезде темно', { chatId: 500, mention: true });      // обращение к боту
platform.chatSends('оформи', { chatId: 500, mention: true, quote: 'Лифт стоит' }); // ответом на сообщение соседа
platform.userPressesButton('vote:p1:for', { chatId: 500, chatType: 'chat' }); // кнопка нажата в чате

platform.pinnedIn(500);                       // что бот закрепил
platform.setPinned(500, 'mid.rules', 9999);   // чужое закрепление
platform.setBotPermissions(['write']);        // права бота в чате
```

## Сбои по расписанию

Правила выстраиваются в очередь и расходуются по одному на запрос, поэтому сценарий
воспроизводится точно и тесты не становятся флаки.

```ts
platform.chaos.failNext(429, { times: 2, path: 'messages', retryAfterSeconds: 1 });
platform.chaos.abortNext({ times: 1, path: 'updates' });  // обрыв соединения
platform.chaos.hangNext({ path: 'me' });                  // ответа не будет вовсе
platform.chaos.delayNext(1500);                           // медленный ответ
```

Так проверяется то, что иначе проверить негде: доставит ли бот сообщение после двух `429`,
выживет ли цикл опроса после обрыва, сработает ли таймаут на зависшем запросе.

## Что реализовано

`GET /me`, `PATCH /me/commands`, `GET /updates` с долгим опросом и маркерами, `POST|GET|PUT|DELETE /messages`,
`POST /answers`, `GET|POST|DELETE /subscriptions` с доставкой апдейтов на вебхук, чаты
(`GET /chats/{id}`, закрепление `GET|PUT|DELETE /chats/{id}/pin`, права бота `GET /chats/{id}/members/me`)
и `POST /uploads`. Неизвестный путь отвечает такой же ошибкой, как платформа, опечатка в клиенте
не выглядит успешным вызовом.

Маркеры работают как на платформе: пока позиция не подтверждена следующим запросом,
та же пачка апдейтов выдаётся повторно.

## Тесты

```bash
npm test --workspace @maxkit/platform-mock
```

38 тестов, включая сквозные: настоящий `Bot` из официального SDK работает против эмулятора,
отвечает пользователю, доставляет ответ после двух `429`, переживает обрывы соединения
и не переобрабатывает подтверждённые апдейты после перезапуска.
