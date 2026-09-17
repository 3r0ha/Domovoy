# @maxkit/react

React-хуки поверх [`@maxkit/bridge`](../bridge).

Хуки тонкие: вся работа с протоколом остаётся в мосте, здесь только связывание с жизненным
циклом компонентов, то, где обычно и появляются утечки: кнопка «назад», оставшаяся висеть
после ухода с экрана, и запрос, который отвечает уже размонтированному компоненту.

## Подключение

```tsx
import { MaxProvider } from '@maxkit/react';

createRoot(document.getElementById('root')!).render(
  <MaxProvider>
    <App />
  </MaxProvider>,
);
```

Мост создаётся один раз на всё приложение: параметры запуска читаются при старте, а повторное
создание потеряло бы подписки и незавершённые запросы. По умолчанию провайдер сам сообщает
клиенту о готовности; `autoReady={false}` отдаёт это приложению, если нужно дождаться данных
и показать готовый экран.

Для разработки вне мессенджера в провайдер передаётся мост, подключённый к эмулятору:

```tsx
const { bridge } = createMockBridge({ startParam: 'lift_1234' });
<MaxProvider bridge={bridge}>…</MaxProvider>
```

## Хуки

```tsx
const { initData, initDataUnsafe, platform, isInsideMax } = useLaunchParams();
const user = useMaxUser();                    // данные не проверены подписью
const canScanNfc = useSupports('nfc');

useBackButton({ onClick: () => navigate(-1) });   // показывается на время жизни экрана
useClosingConfirmation(hasUnsavedChanges);

const { value, save, remove, loading } = useStorageValue('draft');
const { value: token } = useStorageValue('token', 'secure');

const { data, error, loading, reload } = useBridgeRequest(
  (signal) => bridge.getViewportSize({ signal }),
  [bridge],
);
```

Что делают хуки помимо очевидного:

- `useBackButton` показывает кнопку при появлении экрана и убирает при уходе, она не остаётся
  висеть на следующем экране. Обработчик читается через ref, поэтому смена колбэка не пересоздаёт подписку.
- `useBridgeRequest` отменяет запрос при размонтировании и игнорирует ответ, пришедший позже:
  обновление состояния мёртвого компонента ничего не чинит, а ошибки прячет. Отмена не считается ошибкой.
- `useStorageValue` работает и с обычным, и с шифрованным хранилищем клиента.
- `useLaunchParams` возвращает и сырую строку запуска, её отправляют на сервер, и разобранные
  данные с явной пометкой, что они не проверены.

## Тесты

```bash
npm test --workspace @maxkit/react
```

21 тест на настоящем React с DOM: провайдер отдаёт мост потомкам и не уничтожает чужой,
кнопка «назад» убирается при уходе с экрана, запрос отменяется при размонтировании,
хранилище читается и записывается, ошибки клиента доходят до компонента.
