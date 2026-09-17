# Протокол MAX Bridge (reverse engineering)

Источник: `https://st.max.ru/js/max-web-app.js`
Документация MAX описывает публичный API `window.WebApp`, но не описывает транспорт и точные имена событий.
Ниже, восстановленный протокол; он лежит в основе `@maxkit/bridge` и эмулятора `@maxkit/devhost`.

## 1. Параметры запуска

Клиент MAX открывает мини-аппу с параметрами в **hash** URL:

```
https://example.ru/app#WebAppData=<urlencoded>&WebAppPlatform=ios&WebAppVersion=25.9.16&WebAppDeviceName=iPhone
```

- Значения кешируются в `sessionStorage` под теми же ключами: при потере hash (SPA-роутинг, перезагрузка) они берутся оттуда.
- Если `location.hash` уже затёрт роутером, скрипт достаёт исходный URL из `performance.getEntriesByType('navigation')[0].name`.
- `WebAppPlatform` валидируется по списку `ios | android | desktop | web`, иначе `platform === null`.

### Формат `WebAppData`

URL-encoded query string. Известные ключи:

| Ключ | Тип | Примечание |
|---|---|---|
| `hash` | string | подпись, см. `docs/init-data-validation.md` |
| `ip` | string | IP пользователя |
| `query_id` | string | идентификатор сессии запуска, автоматически подмешивается в storage/biometry/nfc-запросы |
| `start_param` | string | payload из диплинка `https://max.ru/<bot>?startapp=<payload>` |
| `auth_date` | number | unix-время |
| `user` | JSON | `{ id, first_name, last_name, username, language_code, photo_url }`, `id` приводится к `Number` |
| `chat` | JSON | `{ id, type: 'DIALOG' \| 'CHAT' \| 'CHANNEL' }` |

Неизвестные ключи Bridge молча логирует и отбрасывает, при появлении новых полей `initDataUnsafe` их не отдаст, а `initData` (сырая строка) сохранит.

## 2. Транспорт

Bridge выбирает транспорт один раз в конструкторе:

1. **iframe** (`window.self !== window.top`), `window.parent.postMessage(JSON.stringify({ type, ...payload }), '*')`.
   Входящие сообщения принимаются только если `origin` матчит `/^https:\/\/.*\.(?:max|oneme)\.ru$/`, `event.data`, строка, а `type` начинается с `WebApp`.
2. **WebView** (`window.WebViewHandler`), `WebViewHandler.postEvent(type, JSON.stringify(payload))`.
3. **Fallback**, `console.warn`, событие не уходит (обычный браузер).

Клиент может доставлять события и напрямую вызовом `window.WebApp.sendEvent(type, jsonString)`.

## 3. Модель запрос/ответ

Запросы получают `requestId` (uuid v4 через `crypto.randomUUID`) и резолвятся по нему.
Ответ считается ответом на запрос, если в payload есть непустая строка `requestId`; иначе это broadcast-событие для подписчиков `onEvent`.

Ошибка приходит как `{ requestId, error: { code } }` и попадает в `reject`.
Таймаут отклоняет промис с `{ error: { code: 'client.<snake_case_method>.request_timeout' } }`,
где имя метода получается из `WebAppOpenCodeReader` → `open_code_reader`.

Таймауты: обычный, **10 с**, `WebAppNfcEmulateNfcTag`, **30 с**, биометрия / `RequestPhone` / `DownloadFile` / `Share`, **60 с**, `OpenCodeReader`, **600 с**.

## 4. Каталог событий

### Запросы (ждут ответ)

| Событие | Payload | Ответ |
|---|---|---|
| `WebAppSecureStorageSaveKey` | `{ key, value \| null, queryId }` |: |
| `WebAppSecureStorageGetKey` | `{ key, queryId }` | `{ value }` |
| `WebAppSecureStorageClear` | `{ queryId }` |: |
| `WebAppDeviceStorageSaveKey` | `{ key, value \| null, queryId }` |: |
| `WebAppDeviceStorageGetKey` | `{ key, queryId }` | `{ value }` |
| `WebAppDeviceStorageClear` | `{ queryId }` |: |
| `WebAppBiometryGetInfo` | `{ queryId }` | `BiometryInfo` |
| `WebAppBiometryRequestAccess` | `{ reason?, queryId }` | `BiometryInfo` |
| `WebAppBiometryRequestAuth` | `{ reason?, queryId }` | `{ token? }` |
| `WebAppBiometryUpdateToken` | `{ token?, reason?, queryId }` | `{ status: 'updated' \| ... }` |
| `WebAppBiometryOpenSettings` | `{ queryId }` | `{ status: 'opened' }` |
| `WebAppNfcGetInfo` | `{ queryId }` | `NfcInfo` |
| `WebAppNfcEmulateNfcTag` | `{ nfctag?, queryId }` |: |
| `WebAppNfcOpenSystemSettings` | `{ queryId }` | `{ status: 'opened' }` |
| `WebAppHapticFeedbackImpact` | `{ impactStyle, disableVibrationFallback }` |: |
| `WebAppHapticFeedbackNotification` | `{ notificationType, disableVibrationFallback }` |: |
| `WebAppHapticFeedbackSelectionChange` | `{ disableVibrationFallback }` |: |
| `WebAppSetupSwipesBehavior` | `{ allowVerticalSwipes }` | `{ allowVerticalSwipes }` |
| `WebAppSetupScreenCaptureBehavior` | `{ isScreenCaptureEnabled }` | `{ isScreenCaptureEnabled }` |
| `WebAppChangeScreenBrightness` | `{ maxBrightness }` | `{ maxBrightness }` |
| `WebAppRequestPhone` | `{}` | `{ phone, authDate, hash }` |
| `WebAppGetViewportSize` | `{}` | `{ height, width }` |
| `WebAppGetLaunchContext` | `{}` | `{ entryPoint: 'tabbar' \| 'default' }` |
| `WebAppDownloadFile` | `{ url, file_name }` |: |
| `WebAppShare` | `{ text?, link? }` |: |
| `WebAppMaxShare` | `{ text?, link? } \| { chatId, messageId }` |: |
| `WebAppOpenCodeReader` | `{ fileSelect }` | результат сканирования |

### Fire-and-forget (ответа нет)

`WebAppReady`, `WebAppClose`, `WebAppSetupBackButton { isVisible }`,
`WebAppSetupClosingBehavior { needConfirmation }`, `WebAppOpenLink { url }`, `WebAppOpenMaxLink { url }`.

### Входящие события клиента

`WebAppBackButtonPressed`, нажата системная кнопка «назад».

## 5. Расхождения с документацией

1. `DeviceStorage` / `SecureStorage` в доках описаны как синхронные (`getItem(key): string`), фактически **все методы возвращают Promise**, это запросы к клиенту.
2. `ready()` и `close()` в доках `dev.max.ru/docs/webapps/bridge` не описаны, но в скрипте есть.
3. `shareMaxContent({ mid, chatType })` на клиенте разбирает `mid`: убирает префикс `mid.`, первые 16 hex-символов → `chatId`, остальные → `messageId`; для `chatType === 'CHAT'` из `chatId` вычитается 2^64.
4. Ошибки бросаются не как `Error`, а как «голый» объект `{ error: { code } }`, `try/catch` с `err instanceof Error` их не поймает. `@maxkit/bridge` нормализует это в класс `MaxBridgeError`.
