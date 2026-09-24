# Функционал продукта «Домовой»

Перечень собран по коду репозитория на 2026-09-19. Каждый пункт указывает, где действие доступно (команда бота, кнопка, экран приложения, маршрут API) и в каком файле оно реализовано. Пункты со словом «проверить» требуют ручной сверки.

## Оглавление

- [Роли и границы доступа](#roles)
- [Жилец](#resident)
- [Диспетчер](#dispatcher)
- [Мастер](#technician)
- [Управляющий](#manager)
- [Подрядчик](#contractor)
- [Чат дома и канал](#house-chat)
- [Языки и перевод](#languages)
- [Слой: чат-бот](#bot)
  - [Команды](#bot-commands)
  - [Меню по ролям](#bot-menu)
  - [Кнопки](#bot-buttons)
  - [Разговор словами](#bot-dialog)
  - [Голос и фото](#bot-voice)
  - [Уведомления](#bot-notifications)
- [Слой: мини-приложение](#miniapp)
  - [Вход, сессия, режим без связи](#miniapp-session)
  - [Навигация и разделы по ролям](#miniapp-sections)
  - [Экраны](#miniapp-screens)
  - [Помощник, голос, фото, тур](#miniapp-extra)
- [Слой: API](#api)
- [Слой: правила и сценарии](#rules)
- [Слой: интеграции и инфраструктура](#infra)
- [Что модельное и что настоящее](#mocks)

## Роли и границы доступа <a id="roles"></a>

- Пять ролей: жилец, диспетчер, мастер, управляющий, подрядчик. Список `ROLES`. Файл: `packages/domain/src/types.ts`.
- Сотрудники компании: диспетчер, мастер, управляющий (`COMPANY_ROLES`). Подрядчик к ним не относится. Файл: `packages/domain/src/types.ts`.
- Старший по подъезду: полномочия на два года по итогам собрания, отдельной роли нет; действует в заявках по общему имуществу своего подъезда. Файлы: `packages/domain/src/voting.ts`, `packages/app/src/elders.ts`, `packages/app/src/use-cases/access.ts`.
- Первого управляющего назначает переменная `OWNER_MAX_ID` или команда `make-manager`; дальше роли раздаёт управляющий. Файлы: `apps/domovoy/src/main.ts`, `apps/domovoy/src/cli.ts`, `packages/app/src/setup.ts`, `packages/app/src/roles.ts`.
- Дом принадлежит организации (`companyId`); сотрудник видит дома своей организации и дома, отданные ему вручную (`servesBuildingIds`). Файл: `packages/app/src/buildings.ts`.
- Жилец видит свои заявки и заявки по общему имуществу своего дома; чужая квартирная заявка отвечает отказом. Файл: `packages/app/src/use-cases/access.ts`.
- Подрядчик действует только в заявках, где он исполнитель. Файл: `packages/app/src/use-cases/access.ts`.
- Смена заводит заявку от чужой квартиры только в доме своей организации; жилец заводит от своей квартиры или по коду объекта своего дома. Файл: `packages/app/src/use-cases/access.ts`.
- Дом смены и дом квартиры у сотрудника разделены: очередь, план и сводка идут по дому смены, квитанция и собрание по дому квартиры. Файлы: `packages/app/src/buildings.ts`, `packages/app/src/apartments.ts`.
- Режим проверки `DEMO_ROLES=1`: примерка любой из пяти ролей под своей учётной записью; жильцу выдаётся свободная квартира, сотруднику дом. Файлы: `packages/app/src/demo.ts`, `apps/domovoy/src/main.ts`.
- Виртуальная смена `DEMO_SHIFT=1`: заявку проверяющего и аварию, к которой он присоединился, сотрудники набора принимают через 30 секунд, берут в работу через 20 и сдают через 90; жилец получает обычные уведомления с именем мастера и сам принимает работу. Заявки набора смена не трогает. Файл: `apps/domovoy/src/demo-shift.ts`.
- Ночной пересев сохраняет настоящих людей с языком, согласием, ролью и квартирой набора. Файл: `apps/domovoy/src/reseed.ts`.
- Снимок поломки без слов: GigaChat предлагает короткое название («Разбито стекло в окне на лестнице»), заявка уходит только по кнопке «Отправить так»; неуверенный ответ, пересказ и сбой службы оставляют вопрос словами. Файлы: `apps/domovoy/src/gigachat-files.ts`, `apps/bot/src/dialog.ts`.

## Жилец <a id="resident"></a>

- Оставить адрес дома, которого в продукте ещё нет: форма на экране «Квартира», кнопка `connect` в переписке, маршруты `GET/POST /api/connect`. Управляющая организация видит список тех, кого ждут. Файлы: `packages/app/src/connection.ts`, `apps/miniapp/src/screens/ConnectHouse.tsx`.
- Скан наклейки на подъезде называет дом и до привязки квартиры: после него доступны объявления, контакты и аварии дома. Квитанция, показания и голос по-прежнему за кодом из квитанции. Файл: `packages/app/src/incidents/passport.ts`.
- До привязки квартиры продукт отвечает только просьбой прислать код: меню бота из одного пункта, в приложении один экран «Квартира», маршруты API отдают 403 `apartment_required`. Исключения: выбор языка, документы, `/start`, `/help`, свои данные, удаление профиля, примерка ролей в режиме проверки. Файлы: `packages/app/src/buildings.ts`, `apps/bot/src/apartment.ts`, `apps/api/src/routes.ts`, `apps/miniapp/src/sections.ts`.
- Сообщить о поломке словами: `/new` или любое сообщение боту, экран «Новая заявка». Файлы: `apps/bot/src/dialog.ts`, `apps/miniapp/src/screens/NewRequestScreen.tsx`, `packages/app/src/incidents/submit.ts`.
- Названа вещь без беды («труба», «лифт»): заявки нет, продукт спрашивает, что случилось, и заводит её после ответа, дописав ответ к первому слову. Решает разбор моделью, а не список слов. Снимок отменяет вопрос: по нему смена видит поломку и без слов. Файлы: `packages/app/src/incidents/submit.ts`, `packages/app/src/reasoner.ts`, `apps/bot/src/reply.ts`.
- Сообщить о поломке фотографией или файлом в переписке. Голосом диктуют в мини-приложении: платформа не доставляет боту голосовые из чата (`docs/max-platform.md`). Файлы: `apps/bot/src/dialog.ts`, `packages/app/src/incidents/attachments.ts`.
- Снимок без подписи заявкой не становится: продукт спрашивает, что на нём, и прикладывает его к заявке после ответа. Файл: `apps/bot/src/dialog.ts`.
- Приложить фото к заявке в приложении (уменьшается до 1600 точек, до 1,5 МБ). Файлы: `apps/miniapp/src/use-photos.ts`, `packages/app/src/files.ts`.
- Заявка по коду с наклейки: переход по ссылке `?start=<код>` открывает бота с известным объектом, `?startapp=<код>` открывает паспорт объекта в приложении. Файлы: `apps/bot/src/greeting.ts`, `apps/miniapp/src/screens/ObjectScreen.tsx`.
- Сканировать наклейку камерой клиента MAX на экране «Дом». Файл: `apps/miniapp/src/screens/ScanCode.tsx`.
- Получить номер заявки, категорию, срок ответа и срок выполнения; по аварии совет до приезда мастера. Файлы: `apps/bot/src/reply.ts`, `packages/domain/src/sla.ts`.
- Ответить на уточняющий вопрос об адресе кнопками (варианты из объектов дома). Кнопка `where`, экран заявки. Файлы: `apps/bot/src/reply.ts`, `apps/bot/src/buttons.ts`, `apps/miniapp/src/screens/Clarify.tsx`, `packages/app/src/clarify.ts`.
- Получить ответ вместо заявки, когда по адресу идут объявленные работы; кнопка «Оформить заявку» заводит её всё равно. Кнопка `anyway`. Файлы: `apps/bot/src/reply.ts`, `packages/app/src/incidents/submit.ts`.
- Получить ответ данными дома на вопрос (работы, аварии, квитанция, свои заявки) вместо заявки. Файлы: `packages/app/src/answers.ts`, `apps/bot/src/reply.ts`.
- Присоединиться к открытой заявке соседа автоматически при совпадении категории и адреса. Файл: `packages/app/src/incidents/submit.ts`.
- Подтвердить заявку соседа кнопкой «И у меня»: `/neighbours`, кнопка `support`, экран «Заявки» и паспорт объекта, маршрут `POST /api/requests/{id}/support`. Файлы: `apps/bot/src/pages.ts`, `packages/app/src/support.ts`.
- Ответить на вопрос об аварии «И у меня» или «Всё работает» под уведомлением. Кнопки `same`, `fine`, маршрут `POST /api/requests/{id}/answer`. Файлы: `apps/bot/src/buttons.ts`, `packages/app/src/incidents/neighbours.ts`.
- Постучать к соседу сверху при заливе (один раз, без имён). Экран заявки, маршрут `POST /api/requests/{id}/knock`. Файлы: `apps/miniapp/src/screens/RequestScreen.tsx`, `packages/app/src/incidents/neighbours.ts`.
- Смотреть свои заявки: `/my` (три карточки), экран «Заявки» с фильтром закрытых. Файлы: `apps/bot/src/pages.ts`, `apps/miniapp/src/screens/RequestListScreen.tsx`.
- Открыть заявку по номеру, прислав его сообщением. Файлы: `apps/bot/src/dialog.ts`, `apps/bot/src/pages.ts`.
- Писать по открытой заявке: кнопка `say`, экран заявки, маршрут `POST /api/requests/{id}/comment`. Файлы: `apps/bot/src/dialog.ts`, `packages/app/src/use-cases/requests.ts`.
- Выбрать время визита мастера из предложенных окон: кнопка `slot` под уведомлением, карточка визита на экране заявки, маршрут `POST /api/requests/{id}/visit`. Окна предлагаются сами, как только заявка по квартире уходит в работу. Файлы: `packages/domain/src/appointment.ts`, `packages/app/src/appointments.ts`, `apps/miniapp/src/screens/VisitCard.tsx`.
- Назвать время визита словами в переписке («давайте завтра утром») вместо кнопки: продукт сопоставляет сказанное с предложенными окнами, а при несовпадении называет свободные. Файлы: `packages/app/src/appointments.ts`, `apps/bot/src/dialog.ts`.
- Отменить выбранное время визита: кнопка `drop`, карточка визита, маршрут `DELETE /api/requests/{id}/visit`. Окна остаются, выбрать можно заново. Файлы: `packages/app/src/appointments.ts`, `apps/miniapp/src/screens/VisitCard.tsx`.
- Получить напоминание о визите утром того же дня: одно сообщение жильцу и одно исполнителю. Файл: `packages/app/src/appointments.ts`.
- Узнать, что мастер приезжал и не попал в квартиру: заявка возвращается за новым временем, а срок выполнения сдвигается на сутки. Файлы: `packages/domain/src/appointment.ts`, `packages/app/src/appointments.ts`.
- Вернуть отказ на пересмотр с объяснением, один раз в течение 30 дней: кнопка `dispute`, карточка на экране заявки, маршрут `POST /api/requests/{id}/dispute`. Повторный отказ становится основанием для жилинспекции. Файлы: `packages/domain/src/dispute.ts`, `packages/app/src/disputes.ts`, `apps/miniapp/src/screens/DisputeCard.tsx`.
- Принять работу с оценкой 1..5 или без оценки: кнопки `req`, `rate`, экран заявки. Файлы: `apps/bot/src/buttons.ts`, `apps/miniapp/src/screens/RequestScreen.tsx`.
- Вернуть работу в работу с объяснением: кнопка `ask`, экран заявки. Файлы: `apps/bot/src/dialog.ts`, `apps/miniapp/src/screens/RequestActions.tsx`.
- Ответить на запрос уточнения (переход из `needs_info` в `in_progress`). Файл: `packages/domain/src/status.ts`.
- Снять свою заявку с подтверждением (`withdrawn`). Кнопка `req`, экран заявки. Файлы: `apps/bot/src/buttons.ts`, `packages/app/src/use-cases/requests.ts`.
- Сказать дело словами: «всё сделали», «отзываю заявку»; продукт показывает, что понял, и ждёт кнопку. Файлы: `apps/bot/src/doing.ts`, `packages/app/src/doing.ts`.
- Видеть в карточке зону ответственности с основанием и переданные обращения. Маршрут `GET /api/requests/{id}/responsibility`. Файлы: `apps/miniapp/src/screens/Responsibility.tsx`, `packages/app/src/handoff.ts`.
- Составить и отправить обращение в жилищную инспекцию по просроченной заявке: `/gzhi`, кнопка `gzhi`, экран заявки, маршруты `GET/POST /api/requests/{id}/complaint`. Файлы: `apps/bot/src/commands/house.ts`, `packages/app/src/incidents/escalation.ts`, `packages/domain/src/escalation.ts`.
- Поправить готовый текст обращения перед отправкой: в приложении полем, в переписке словами («допиши, что заливает соседей») кнопкой `gzhi:edit`. Поле `text` в `POST /api/requests/{id}/complaint`. Файлы: `apps/miniapp/src/screens/RequestScreen.tsx`, `apps/bot/src/buttons.ts`, `packages/app/src/reasoner.ts`.
- Привязать квартиру кодом из квитанции: `/flat`, код сообщением, экран «Квартира», маршрут `POST /api/me/apartment`. Файлы: `apps/bot/src/dialog.ts`, `apps/miniapp/src/screens/BindApartmentScreen.tsx`, `packages/app/src/binding.ts`.
- Привязать несколько квартир и переключать текущую: `/flat`, кнопка `flat`, переключатель в шапке приложения. Файлы: `apps/bot/src/commands/basic.ts`, `apps/miniapp/src/use-apartment.ts`, `packages/app/src/apartments.ts`.
- Отвязать квартиру: кнопка `leave`, экран «Профиль». Файлы: `apps/bot/src/buttons.ts`, `apps/miniapp/src/screens/ProfileScreen.tsx`.
- Подать показания: `/meters` по одному прибору с прошлым значением и пропуском, экран «Оплата». Файлы: `apps/bot/src/commands/money.ts`, `apps/bot/src/readings.ts`, `apps/miniapp/src/screens/MetersScreen.tsx`.
- Подать показание свободной фразой («хвс 12350 гвс 9800») или голым числом с выбором прибора; число словами тоже разбирается. Файлы: `apps/bot/src/dialog.ts`, `packages/app/src/meters.ts`, `packages/domain/src/numerals.ts`.
- Подать показание с фотографии табло: бот показывает число и ждёт кнопку `meter-read`, приложение подставляет число в поле. Файлы: `apps/bot/src/readings.ts`, `apps/miniapp/src/screens/MetersScreen.tsx`, `packages/app/src/meter-vision.ts`.
- Исправить показание текущего месяца повторной подачей (прежнее удаляется). Файл: `packages/app/src/meters.ts`.
- Видеть расход по месяцам столбиками и предупреждение о скачке или расходе выше соседского. Файлы: `apps/miniapp/src/screens/MetersScreen.tsx`, `packages/app/src/meters.ts`.
- Видеть квитанцию: `/bill` (сумма, срок, долг), экран «Оплата» построчно с основанием расчёта, ОДН, пенями и историей платежей. Файлы: `apps/bot/src/commands/money.ts`, `apps/miniapp/src/screens/ChargesCard.tsx`, `packages/app/src/billing.ts`.
- Оплатить месяц и погасить долг с подтверждением суммы: кнопки `pay`, `pay-debt`, экран «Оплата», маршруты `POST /api/charges/pay`, `POST /api/charges/debt/pay`. Только при подключённом шлюзе. Файлы: `apps/bot/src/buttons.ts`, `packages/app/src/billing.ts`, `packages/app/src/debt.ts`.
- Заплатить часть суммы за месяц: поле рядом с кнопкой оплаты, тело `{"amount": …}` в `POST /api/charges/pay`. Номер кассового чека возвращает шлюз. Файлы: `packages/app/src/billing.ts`, `apps/miniapp/src/screens/ChargesCard.tsx`.
- Получить напоминание о сроке оплаты за три дня до десятого числа, а не после него. Вид уведомления отключается. Файлы: `packages/app/src/debt.ts`, `packages/app/src/sweep.ts`.
- Открыть домофон или шлагбаум, посмотреть кадр с камеры, выдать гостевой код на 15 минут, отозвать код: `/door`, кнопки `door`, `camera`, `guest`, экран «Дом», экраны камеры и гостя. Файлы: `apps/bot/src/commands/house.ts`, `apps/miniapp/src/screens/HomeScreen.tsx`, `packages/app/src/devices.ts`.
- Получить уведомление, когда гость вошёл по коду. Файл: `packages/app/src/devices.ts`.
- Читать объявления дома: `/news` страницами, экран «Новости»; переслать объявление средствами MAX. Файлы: `apps/bot/src/pages.ts`, `apps/miniapp/src/screens/AnnouncementsScreen.tsx`.
- Видеть «Сейчас в доме» (аварии, идущие работы, настроение дома) и «Скоро в доме» (работы, собрания, обходы на неделю). Файлы: `apps/miniapp/src/screens/HouseNow.tsx`, `apps/miniapp/src/screens/HouseAhead.tsx`, `packages/app/src/now.ts`.
- Голосовать на собрании (за, против, воздержался), видеть доли площади, кворум и недостающие метры, читать протокол. Голосуют собственники помещений, сособственники, каждый своей долей. Кнопка `vote`, экран «Собрания», маршрут `POST /api/polls/{id}/vote`. Файлы: `apps/bot/src/buttons.ts`, `apps/miniapp/src/screens/PollsScreen.tsx`, `packages/app/src/voting.ts`.
- Сказать, собственник ли ты этой квартиры: вопрос сразу после привязки, переключатель в профиле, маршрут `POST /api/flat/ownership`. Управляющая организация подтверждает право и долю. Файлы: `packages/app/src/binding.ts`, `apps/miniapp/src/screens/FlatPeople.tsx`.
- Видеть, кто ещё привязан к квартире, и убрать чужого: раздел в профиле, кнопка `drop` под уведомлением о новой привязке, маршруты `GET/DELETE /api/flat/neighbours`. Собственника снимает собственник или управляющая организация. Файлы: `packages/app/src/binding.ts`, `apps/miniapp/src/screens/FlatPeople.tsx`.
- Завести предложение соседям и подписать чужое: кнопка `sign`, экран «Собрания», маршруты `/api/initiatives`. Файлы: `packages/app/src/initiatives.ts`, `apps/miniapp/src/screens/PollsScreen.tsx`.
- Смотреть работу компании по дому: `/house`, экран «Работа дома». Файлы: `apps/bot/src/commands/house.ts`, `packages/app/src/quality.ts`.
- Смотреть капитальный ремонт дома: экран «Капремонт», маршрут `GET /api/capital-repair`. Файлы: `apps/miniapp/src/screens/CapitalRepairScreen.tsx`, `packages/app/src/capital.ts`.
- Задать вопрос управляющей организации и продолжить переписку: `/support`, кнопка `ticket`, экран «Поддержка». Файлы: `apps/bot/src/commands/house.ts`, `apps/miniapp/src/screens/SupportScreen.tsx`, `packages/app/src/helpdesk.ts`.
- Закрыть свой вопрос. Маршрут `POST /api/support/{id}/close`. Файл: `packages/app/src/helpdesk.ts`.
- Видеть контакты дома: `/contacts`, экран «Поддержка» (аварийная служба, дежурный, ответственный, телефон и почта, приём). Файлы: `apps/bot/src/commands/house.ts`, `packages/app/src/buildings.ts`.
- Записаться на приём в офис, отменить запись: `/visit` (своя запись и отмена в переписке, выбор часа в приложении), экран «Приём». Файлы: `apps/bot/src/commands/visits.ts`, `apps/miniapp/src/screens/VisitsScreen.tsx`, `packages/app/src/visits.ts`.
- Получить наклейку своего подъезда, стояка, квартиры или оборудования картинкой или файлом в переписку: `/stickers` открывает раздел, экран «Наклейки». Файлы: `apps/bot/src/commands/stickers.ts`, `apps/miniapp/src/screens/StickersScreen.tsx`, `packages/app/src/stickers.ts`.
- Настроить уведомления (показания, работы, собрания, объявления) в профиле и кнопками `mute`/`unmute` под сообщением. Файлы: `packages/app/src/notices.ts`, `apps/bot/src/buttons.ts`.
- Поделиться телефоном из платформы и убрать его: экран «Профиль», маршруты `POST/DELETE /api/me/contact`. Файлы: `apps/miniapp/src/screens/ProfileScreen.tsx`, `packages/app/src/contact.ts`.
- Выгрузить свои данные файлом и удалить профиль: `/mydata`, кнопки `mydata`, `forget`, экран «Профиль», маршруты `GET /api/me/data`, `DELETE /api/me`. Файлы: `packages/app/src/privacy.ts`.
- Принять документы продукта (политика и соглашение) до первого действия; читать их в приложении и на сайте: `/legal`, кнопка `legal`, экран согласия. Файлы: `apps/bot/src/commands/legal.ts`, `apps/miniapp/src/screens/Consent.tsx`, `packages/domain/src/legal.ts`.
- Спросить помощника словами: `/help`, кнопка в шапке приложения, готовые вопросы роли. Помощник знает, на каком экране человек стоит, и подсказывает действие здесь, а не отправляет в этот же раздел. Поля `screen` и `doing` в `POST /api/me/assistant`. Файлы: `apps/bot/src/talk.ts`, `apps/miniapp/src/screens/Assistant.tsx`, `packages/app/src/assistant.ts`.
- Быть понятым на своём языке и без модели: готовый вопрос роли и название раздела ищутся на языке человека, а не только по русским словам. Файл: `packages/app/src/assistant.ts`.
- Задать себе имя вместо того, которое пришло из MAX: `/name`, экран «Профиль», маршрут `POST /api/me/name`. Имя из платформы подтягивается на каждом входе, но заданное самим человеком не перетирается. Файлы: `packages/app/src/naming.ts`, `packages/app/src/use-cases/entry.ts`.
- Быть старшим по подъезду: принимать работу и писать в заявках по общему имуществу своего подъезда. Файл: `packages/app/src/use-cases/access.ts`.

## Диспетчер <a id="dispatcher"></a>

- Видеть очередь дома с сортировкой по срочности и прогнозом срыва срока: `/queue` (три строки), экран «Очередь» с отбором «просрочено», «новые», «без мастера», по категории и поиском. Файлы: `apps/bot/src/commands/staff.ts`, `apps/miniapp/src/screens/QueueScreen.tsx`, `packages/app/src/incidents/passport.ts`.
- Принять заявку из строки очереди или кнопкой под уведомлением; отклонить с причиной. Кнопки `req`, `ask`, маршрут `POST /api/requests/{id}/transition`. Файлы: `apps/bot/src/buttons.ts`, `packages/domain/src/status.ts`.
- Назначить исполнителя из списка с загрузкой: кнопка `assign`, экран заявки, маршрут `GET /api/staff`. Файлы: `apps/bot/src/buttons.ts`, `apps/miniapp/src/screens/RequestActions.tsx`, `packages/app/src/report.ts`.
- Поручить наряд словами «назначь Сергея на 0007». Файлы: `packages/app/src/doing.ts`, `apps/bot/src/doing.ts`.
- Завести заявку по звонку от выбранной квартиры или по дому: экран «Новая заявка» с выбором квартиры, поле `apartmentId`/`house` в `POST /api/requests`. Файлы: `apps/miniapp/src/screens/NewRequestScreen.tsx`, `packages/app/src/use-cases/access.ts`.
- Уточнить квартиру заявки, заведённой по дому, списком квартир. Файлы: `packages/app/src/clarify.ts`, `apps/miniapp/src/screens/Clarify.tsx`.
- Закрыть заявку за жильца и вернуть работу мастеру с обязательным объяснением. Файл: `packages/domain/src/status.ts`.
- Писать по заявке, видеть телефон автора открытой заявки. Маршрут `GET /api/requests/{id}/contact`. Файл: `packages/app/src/contact.ts`.
- Видеть опрос соседей по стояку и ответ на стук соседу сверху. Файлы: `packages/app/src/incidents/neighbours.ts`, `apps/miniapp/src/screens/RequestScreen.tsx`.
- Передать обращение смежной организации (ресурсники, подрядчик, муниципальная служба, инспекция) и записать её ответ: кнопки `pass`, `pass-to`, `handoff`, экран заявки, маршруты `POST /api/requests/{id}/handoff`, `POST /api/handoffs/{id}/answer`. Файлы: `apps/bot/src/buttons.ts`, `packages/app/src/handoff.ts`.
- Публиковать объявления и плановые работы адресату (дом, подъезд, стояк) с охватом: экран «Новости», маршрут `POST /api/announcements`. Файл: `packages/app/src/use-cases/announcements.ts`.
- Рассылать сообщения в личные переписки: адресаты дом, подъезд, стояк, квартиры номерами, должники, не подавшие показания, не проголосовавшие, смена; охват до отправки. `/broadcast` открывает раздел, кнопка `cast` из долгов, экран «Рассылка». Файлы: `packages/app/src/use-cases/broadcast.ts`, `apps/miniapp/src/screens/BroadcastScreen.tsx`.
- Не будить дом ночью: рассылка, отправленная в часы тишины, уходит утром. Авария идёт сразу. Файлы: `packages/app/src/quiet.ts`, `packages/app/src/use-cases/broadcast.ts`.
- Отвечать на вопросы жильцов и закрывать обращения: `/support`, кнопка `ticket`, экран «Поддержка» со временем ожидания и отметкой просрочки. Файлы: `apps/bot/src/pages.ts`, `packages/app/src/helpdesk.ts`.
- Видеть долги дома и напоминать одному должнику: `/debts`, экран «Долги», маршрут `POST /api/debtors/{id}/remind`. Файлы: `apps/bot/src/pages.ts`, `packages/app/src/collection.ts`.
- Снимать показания узла учёта: экран «Узел учёта», маршрут `POST /api/house-meters/{id}/readings`. Файл: `packages/app/src/house-meters.ts`.
- Смотреть сводку за месяц, квартал, год с пересказом модели: `/report`, экран «Сводка». Файлы: `apps/bot/src/commands/staff.ts`, `apps/miniapp/src/screens/ReportScreen.tsx`, `packages/app/src/report.ts`, `packages/app/src/digest-text.ts`.
- Выгружать реестр заявок и показания CSV/XLSX или файлом в переписку. Экраны «Сводка», «Узел учёта». Файлы: `packages/app/src/export.ts`, `packages/app/src/exports-to-chat.ts`, `apps/api/src/xlsx.ts`.
- Смотреть план дома с обстановкой по квартирам: экран «План дома». Файл: `packages/app/src/plan.ts`.
- Смотреть здоровье оборудования и прогноз отказов: экран «Оборудование». Файл: `packages/app/src/health.ts`.
- Вести осмотры: отметить пункт, завести заявку по недостатку, отметиться сканом наклейки. Экран «Осмотры». Файл: `packages/app/src/inspections.ts`.
- Вести приём: задать окна и длительность (проверить: `POST /api/reception` доступен любому сотруднику компании, экран показывает форму только управляющему), видеть записи, отметить состоявшийся приём, записать пришедшего без записи, отменить запись жильца. Экран «Приём». Файл: `packages/app/src/visits.ts`.
- Принять и сдать дежурство: `/duty`, переключатель в профиле; ставить дежурство другому сотруднику на экране «Люди дома». Файлы: `apps/bot/src/commands/staff.ts`, `packages/app/src/roles.ts`.
- Видеть людей дома, привязывать жильца к квартире без кода, отвязывать съехавшего, видеть пришедших из чата дома без квартиры. Экран «Люди дома». Файл: `packages/app/src/binding.ts`.
- Объявлять собрание собственников или опрос жильцов, созывать собрание по инициативе, объявлять выборы старшего. Экраны «Собрания», «Люди дома». Файлы: `packages/app/src/voting.ts`, `packages/app/src/initiatives.ts`, `packages/app/src/elders.ts`.
- Получать наклейки на весь дом и лист для печати: экран «Наклейки», маршрут `POST /api/stickers/sheet`. Файл: `packages/app/src/stickers.ts`.
- Смотреть датчики дома и журнал открытий: экран «Дом» у сотрудника. Файлы: `apps/miniapp/src/screens/HomeScreen.tsx`, `apps/miniapp/src/screens/JournalScreen.tsx`.
- Переключать дом в шапке приложения (дома своей организации), видеть список домов с показателями. Файлы: `apps/miniapp/src/screens/TopBar.tsx`, `packages/app/src/portfolio.ts`.
- Получать утреннюю сводку за ночь, предупреждения о сроках, новые заявки, вопросы жильцов, записи на приём. Файлы: `packages/app/src/digest.ts`, `packages/app/src/incidents/reminders.ts`, `packages/app/src/incidents/notify.ts`.
- Всё, что доступно жильцу по своей квартире (показания, квитанция, собрания), группа «Моя квартира» в меню бота. Файл: `apps/bot/src/menu.ts`.

## Мастер <a id="technician"></a>

- Видеть свои наряды: `/my` карточками, экран «Наряды» первым в панели. Файлы: `apps/bot/src/pages.ts`, `apps/miniapp/src/sections.ts`.
- Видеть день целиком: `/day` и раздел «Мой день». Сначала наряды с назначенным временем визита, дальше по сроку, а внутри одного подъезда, подряд. Маршрут `GET /api/workday`. Файлы: `packages/app/src/workday.ts`, `apps/miniapp/src/screens/WorkdayScreen.tsx`.
- Предложить жильцу окна визита и отметить неудачный выезд: карточка визита на экране заявки, кнопка `missed` в переписке, маршруты `POST /api/requests/{id}/visit/offer` и `/visit/missed`. Файлы: `packages/app/src/appointments.ts`, `apps/miniapp/src/screens/VisitCard.tsx`.
- Списать израсходованные материалы вместе со сдачей работы: название, количество и единица, лишнее убирается до отправки; `materials` в теле перехода. Списанное остаётся в карточке заявки и в «Моём дне». Файлы: `packages/domain/src/status.ts`, `apps/miniapp/src/screens/RequestActions.tsx`.
- Взять наряд в работу на себя (исполнитель не выбирается). Файл: `packages/domain/src/status.ts`.
- Спросить уточнение у жильца с вопросом, сдать работу с отметкой о сделанном и фотографией результата. Кнопки `ask`, `req`, экран заявки. Файлы: `apps/bot/src/dialog.ts`, `apps/miniapp/src/screens/RequestActions.tsx`.
- Подтвердить выезд сканом наклейки объекта (отметка `onSite` в истории): переход по коду в боте, кнопка «Сканировать код» в приложении, поле `provedBy`. Файлы: `apps/bot/src/greeting.ts`, `packages/app/src/use-cases/requests.ts`, `packages/domain/src/deep-link.ts`.
- Сдать работу словами: «починил трубу», «выехал». Файлы: `packages/app/src/doing.ts`, `apps/bot/src/doing.ts`.
- Вести осмотры и плановое ТО по чек-листу, получать назначенный обход уведомлением. Файл: `packages/app/src/inspections.ts`.
- Видеть очередь дома (без приёма заявок), план, оборудование, датчики, журнал открытий, поддержку, приём, сводку. Файлы: `apps/miniapp/src/sections.ts`, `apps/miniapp/src/screens/registry.tsx`.
- Принимать и сдавать дежурство: `/duty` (проверить: `setDuty` разрешён диспетчеру и управляющему, мастер получает отказ). Файлы: `apps/bot/src/commands/staff.ts`, `packages/app/src/roles.ts`.
- Получать предупреждения о сроке по своим нарядам и сообщение о передаче наряда другому. Файлы: `packages/app/src/incidents/reminders.ts`, `packages/app/src/use-cases/requests.ts`.
- Рассылка мастеру недоступна, долги дома не показываются. Файлы: `apps/bot/src/menu.ts`, `apps/miniapp/src/sections.ts`.

## Управляющий <a id="manager"></a>

- Всё, что доступно диспетчеру. Файлы: `packages/domain/src/status.ts`, `apps/bot/src/menu.ts`.
- Назначать роли и снимать их, ставить дежурство, раздавать сотруднику дома организации. Экран «Люди дома», маршруты `POST /api/residents/{id}/role`, `/duty`, `/buildings`. Файл: `packages/app/src/roles.ts`.
- Вести карточку дома: код, адрес, организация, часовой пояс, ответственный, аварийная служба, телефон, почта, режим работы, адрес и часы приёма, приёмные окна, смежные организации. Экран «Карточка дома», маршрут `POST /api/buildings/card`, команда `building`. Файл: `packages/app/src/setup.ts`.
- Заводить квартиры и оборудование списком CSV: экран «Карточка дома», маршруты `POST /api/import/apartments`, `POST /api/import/equipment`, команды `import-apartments`, `import-equipment`. Файлы: `packages/app/src/import.ts`, `packages/app/src/setup.ts`.
- Заводить новый дом компании: экран «Дома», маршрут `POST /api/buildings`, команда `add-building`. Файл: `packages/app/src/setup.ts`.
- Привязывать чат дома добавлением бота или `/here`, отвязывать `/unhere` и из карточки дома. Файлы: `apps/bot/src/events.ts`, `apps/bot/src/commands/staff.ts`, `packages/app/src/setup.ts`.
- Передавать дом другой управляющей организации с подтверждением названия: экран «Карточка дома», маршрут `POST /api/buildings/handover`. Файл: `packages/app/src/handover.ts`.
- Задавать тарифы и ключевую ставку с датой начала: экран «Тарифы», маршрут `POST /api/tariffs`. Файл: `packages/app/src/tariffs.ts`.
- Заводить общедомовые приборы: экран «Узел учёта», маршрут `POST /api/house-meters`. Файл: `packages/app/src/house-meters.ts`.
- Читать журнал действий сотрудников: экран «Действия», маршрут `GET /api/audit`. Файл: `packages/app/src/audit.ts`.
- Задавать приёмные окна на экране «Приём» (`canSchedule`). Файл: `apps/miniapp/src/screens/registry.tsx`.
- Видеть в чате привязку и получать сообщение, если написать в чат дома не удалось. Файл: `packages/app/src/broadcast.ts`.

## Подрядчик <a id="contractor"></a>

- Видеть только порученные наряды: `/my`, экран «Наряды». Файлы: `packages/app/src/use-cases/requests.ts`, `apps/miniapp/src/sections.ts`.
- Взять наряд в работу, запросить уточнение, сдать работу с отметкой и фото; отметиться сканом наклейки. Файлы: `packages/domain/src/status.ts`, `apps/bot/src/greeting.ts`.
- Меню бота: наряды, свои данные, группа «Дела дома» (вопрос компании, контакты, объявления, двери, квитанция, счётчики). Файл: `apps/bot/src/menu.ts`.
- Своя квартира: привязка, показания, квитанция, собрания, работа дома (при привязке). Файл: `apps/miniapp/src/sections.ts`.
- Наклейки, обращение в инспекцию, очередь дома, план, сводка, рассылка недоступны. Файлы: `packages/app/src/stickers.ts`, `apps/bot/src/commands/house.ts`, `apps/miniapp/src/screens/registry.tsx`.
- Объявления по дому целиком подрядчику не приходят. Файл: `packages/app/src/use-cases/announcements.ts`.

## Чат дома и канал <a id="house-chat"></a>

- Привязка чата к дому при добавлении бота управляющим; иначе просьба дать `/here`. Событие `bot_added`. Файлы: `apps/bot/src/events.ts`, `packages/app/src/setup.ts`.
- Один чат на дом; чужой чат к своему дому не привязать. Файл: `packages/app/src/setup.ts`.
- Снятие привязки при удалении бота (`bot_removed`), из приложения (`DELETE /api/buildings/chat`) и командой `/unhere`. Файлы: `apps/bot/src/events.ts`, `apps/api/src/routes/buildings.ts`.
- Просьба дать право закреплять сообщения при привязке. Файл: `apps/bot/src/chat-binding.ts`.
- Приветствие новому участнику чата (`user_added`). Файл: `apps/bot/src/events.ts`.
- Бот отвечает в чате только на упоминание, ответ на своё сообщение или команду. Файлы: `apps/bot/src/chat.ts`, `apps/bot/src/max.ts`.
- Заявка из чата по упоминанию «@Домовой ...» и ответом на сообщение соседа; адрес по дому чата, если жилец не привязан. Файл: `apps/bot/src/chat.ts`.
- Вопрос о доме в чате получает ответ данными; квитанция и свои заявки уходят в личную переписку. Файл: `apps/bot/src/reply.ts`.
- Личные команды в чате отвечают в переписку со строкой «ответил вам лично»; дела смены уходят молча; команды с продолжением (`/new`, `/meters`, `/support`, `/broadcast`) зовут в переписку. Файлы: `apps/bot/src/bot.ts`, `apps/bot/src/max.ts`.
- `/help` и `/start` в чате отвечают правилами чата. Файл: `apps/bot/src/greeting.ts`.
- `/contacts` в чате отдаёт только аварийный телефон. Файл: `apps/bot/src/commands/house.ts`.
- `/neighbours` в чате показывает свежее обращение с кнопкой «И у меня». Файл: `apps/bot/src/pages.ts`.
- Голос на собрании из чата показывает счёт без строки «Ваш голос», подтверждение уходит в переписку. Файл: `apps/bot/src/buttons.ts`.
- Объявления по дому, подтверждённая авария (закрепляется) и начало работ (закрепляется) уходят в чат; устранение и окончание работ снимают закрепление. Чужие закрепления не трогаются. Файлы: `packages/app/src/broadcast.ts`, `packages/app/src/incidents/reminders.ts`, `apps/bot/src/bot.ts`.
- Канал вместо чата: заявка комментарием под постом с упоминанием, ответ в ту же ветку. Событие `comment_created`. Файл: `apps/bot/src/chat.ts`.
- Если написать в чат не удалось, диспетчер и управляющий получают сообщение с просьбой дать `/here`. Файл: `packages/app/src/broadcast.ts`.

## Языки и перевод <a id="languages"></a>

- Тринадцать языков: русский, английский, татарский, узбекский, таджикский, киргизский, казахский, азербайджанский, армянский, туркменский, грузинский, румынский (молдавский), китайский. Файл: `packages/i18n/src/languages.ts`.
- Выбор языка первым делом: `/start` спрашивает язык до документов и до привязки квартиры, мини-приложение показывает тот же список первым экраном. Вопрос написан по-русски и по-английски, названия языков идут на них самих. Язык клиента MAX из апдейта и из `initData` стоит в списке первым. Файлы: `apps/bot/src/language.ts`, `apps/miniapp/src/screens/LanguageScreen.tsx`.
- Язык есть только у жильца. Смену, подрядчика и управляющего о языке не спрашивают, раздела языка у них нет, а продукт говорит с ними по-русски, даже если язык был выбран в роли жильца при проверке. Файлы: `packages/app/src/language.ts`, `apps/miniapp/src/App.tsx`.
- Смена языка: `/lang`, пункт меню «🌐 Язык», раздел «Язык» в приложении, маршруты `GET /api/languages` и `POST /api/me/language`. Работает до согласия с документами и до привязки квартиры. Файлы: `apps/bot/src/language.ts`, `apps/api/src/routes/me.ts`.
- Код из ссылки (наклейка, ключ квартиры) откладывается до выбора языка и разбирается сразу после него. Файлы: `apps/bot/src/language.ts`, `apps/bot/src/greeting.ts`.
- Словари по языкам и областям (`app`, `bot`, `miniapp`, `when`), русский исходный и запасной, подстановки именованные. Файлы: `packages/i18n/src/locales/`, `packages/i18n/src/translate.ts`.
- Даты, время и числа идут на языке человека: названия месяцев из словаря, порядок частей задаёт сам язык, «сегодня», «вчера» и «завтра» словами, разделитель дробной части по языку, форма слова по правилам языка, а не по русским. У смены дата и число остаются русскими. Рубль остаётся рублём. Файлы: `packages/i18n/src/when.ts`, `packages/domain/src/moment.ts`, `packages/app/src/language.ts`.
- Язык человека хранится в его карточке и в сессии бота; миграция `061_resident_language.sql`. Файлы: `packages/app/src/language.ts`, `packages/storage/migrations/061_resident_language.sql`.
- Документы на языке человека: ссылки бота ведут на страницу его языка, `GET /api/legal` отдаёт его редакцию, на сайте адреса `/<код>/privacy/` и `/<код>/terms/` с переключателем языка. Дата редакции по-русски словами, на остальных языках цифрами. Файлы: `packages/i18n/src/legal/`, `packages/domain/src/legal.ts`, `landing/vite.config.ts`.
- Написанное жильцом не по-русски переводится для смены; под переводом идёт исходный текст с названием языка, а автор видит своё сообщение как написал. В карточке заявки смена видит оригинал и описания, и каждой реплики. По русскому тексту считаются категория, срок и поиск. Файлы: `packages/app/src/translation.ts`, `apps/domovoy/src/translator.ts`, `apps/miniapp/src/screens/RequestScreen.tsx`.
- Отказ сервера приходит на языке человека: мини-приложение берёт строку словаря по коду отказа, а по-русски оставляет текст сервера, который подробнее. Файл: `apps/miniapp/src/api.ts`.
- Ответ смены и уведомления по заявке переводятся обратно на язык жильца. Файлы: `packages/app/src/use-cases/requests.ts`, `packages/app/src/helpdesk.ts`.
- Написанное одним человеком для многих переводит отдельная бесплатная служба, а не модель продукта: объявления управляющей организации, названия плановых работ, названия и вопросы собраний и предложений жильцов, суть и описание заявок соседей в ленте дома и в паспорте объекта. Служба выбирается `TRANSLATE_KIND` (`libre` или `mymemory`). Перевод идёт только жильцу с нерусским языком, пачкой и не дольше трёх секунд; отказ оставляет исходный текст. Файлы: `packages/app/src/machine-translation.ts`, `apps/domovoy/src/machine-translator.ts`.
- Переводы хранятся по паре «отпечаток текста и язык», поэтому текст переводится один раз; отказ запоминается на десять минут. Миграция `063_translation.sql`. Файлы: `packages/app/src/memory-repository.ts`, `packages/storage/src/postgres-repository.ts`, `packages/storage/migrations/063_translation.sql`.
- Машинный перевод отмечен: API отдаёт `machineTranslated`, мини-приложение ставит рядом пометку, бот помечает объявления одной строкой в конце сообщения. Файлы: `apps/api/src/serialize.ts`, `apps/miniapp/src/screens/MachineNote.tsx`, `apps/bot/src/pages.ts`.
- Подписи кнопок под уведомлением идут на языке получателя: язык передаётся вместе с уведомлением. Файлы: `packages/app/src/notifier.ts`, `apps/bot/src/bot.ts`.
- Помощник отвечает на языке вопроса. Если этот язык у продукта есть, под ответом стоит вторая кнопка: перейти на него, не потеряв сам ответ. В переписке она меняет язык на месте, в приложении переключает интерфейс. Просьба сменить язык словами распознаётся на всех тринадцати языках и ведёт в выбор языка. Файлы: `packages/app/src/assistant.ts`, `apps/bot/src/talk.ts`, `apps/miniapp/src/screens/Assistant.tsx`.
- Расшифровка учитывает язык человека: и GigaChat, и отдельная служба за `SPEECH_URL` получают его языком записи, а `SPEECH_LANGUAGE` остаётся значением по умолчанию для тех, кто язык не выбрал. Файлы: `apps/domovoy/src/gigachat-files.ts`, `apps/domovoy/src/transcriber.ts`.
- Написанное словами модель разбирает на любом языке, а не только на тринадцати языках продукта: об этом сказано в каждом системном запросе, и разбор она отдаёт по-русски. Поэтому «open the door» открывает двери, а не заводит заявку о поломке. Файл: `apps/domovoy/src/reasoner.ts`.
- Экраны смены, общий чат дома и события чата остаются русскими. Файлы: `apps/bot/src/commands/staff.ts`, `apps/bot/src/chat.ts`.
- Проверки сверяют, что у всех языков один набор ключей и одни подстановки. Файл: `packages/i18n/test/i18n.test.ts`.

## Слой: чат-бот <a id="bot"></a>

Файлы адаптера: `apps/bot/src/bot.ts` (сборка, диспетчер команд и кнопок, уведомитель), `apps/bot/src/max.ts` (контекст, ожидания, экран разговора), `apps/bot/src/keyboards.ts` (клавиатуры).

### Команды <a id="bot-commands"></a>

Регистрируются в `apps/bot/src/commands/*.ts`, `/start` в `apps/bot/src/bot.ts`. Всего 27.

- `/start`: приветствие по роли, меню; с кодом объекта в `?start=` сразу ожидание описания, с кодом квартиры `key_<код>` привязка; первый разговор начинается с документов. Файл: `apps/bot/src/greeting.ts`.
- `/new`: ожидание описания поломки (текст, фото, файл). Файл: `apps/bot/src/commands/basic.ts`.
- `/my`: до трёх карточек открытых заявок или нарядов с кнопками; при большем числе строка с числом и кнопка в приложение. Файл: `apps/bot/src/pages.ts`.
- `/meters`: список приборов без показаний, ожидание числа по выбранному, поверка истекла отдельным сообщением. Файл: `apps/bot/src/commands/money.ts`.
- `/bill`: сумма к оплате, срок, старый долг, кнопки оплаты при подключённом шлюзе. Файл: `apps/bot/src/commands/money.ts`.
- `/flat`: ожидание кода квартиры или выбор из привязанных. Файл: `apps/bot/src/commands/basic.ts`.
- `/help`: разговор с помощником; в чате дома правила чата. Файлы: `apps/bot/src/commands/basic.ts`, `apps/bot/src/talk.ts`.
- `/demo`: выбор роли; вне `DEMO_ROLES` отказ. Файл: `apps/bot/src/commands/basic.ts`.
- `/mydata`: сводка хранимого и кнопки выгрузки файлом, уведомлений, отвязки, удаления. Файл: `apps/bot/src/commands/basic.ts`.
- `/door`: список дверей, шлагбаумов и камер подъезда. Файл: `apps/bot/src/commands/house.ts`.
- `/vote`: счёт открытых собраний и предложений с переходом в приложение; без открытых протокол последнего. Файл: `apps/bot/src/commands/house.ts`.
- `/news`: объявления по два на страницу, у работ срок окончания. Файл: `apps/bot/src/pages.ts`.
- `/neighbours`: заявки соседей по общему имуществу с переходом в приложение. Файл: `apps/bot/src/pages.ts`.
- `/house`: работа компании одной строкой. Файл: `apps/bot/src/commands/house.ts`.
- `/contacts`: карточка контактов дома. Файл: `apps/bot/src/commands/house.ts`.
- `/support`: у жильца ожидание вопроса, у смены список вопросов и кнопка «Свой вопрос». Файл: `apps/bot/src/commands/house.ts`.
- `/gzhi`: обращение в инспекцию по первой своей заявке с основанием. Файл: `apps/bot/src/commands/house.ts`.
- `/queue`: открыто и просрочено, три строки очереди. Файл: `apps/bot/src/commands/staff.ts`.
- `/report`: сводка коротко, вопросы без ответа, переданные обращения, следом пересказ моделью. Файл: `apps/bot/src/commands/staff.ts`.
- `/duty`: переключение своего дежурства с именами дежурящих. Файл: `apps/bot/src/commands/staff.ts`.
- `/debts`: долг дома и число должников, кнопка рассылки должникам у диспетчера и управляющего. Файл: `apps/bot/src/pages.ts`.
- `/here`, `/unhere`: привязка и отвязка чата дома, только в чате. Файл: `apps/bot/src/commands/staff.ts`.
- `/stickers`: число объектов с кодами и переход в раздел. Файл: `apps/bot/src/commands/stickers.ts`.
- `/broadcast`: переход в раздел рассылки. Файл: `apps/bot/src/commands/broadcast.ts`.
- `/visit`: своя запись с кнопкой отмены, число свободных часов и переход в приложение; смене число записей. Файл: `apps/bot/src/commands/visits.ts`.
- `/legal`: ссылки на документы и согласие. Файл: `apps/bot/src/commands/legal.ts`.
- В меню клиента публикуются `new`, `my`, `meters`, `bill`, `door`, `news`, `support`, `contacts`, `help`, плюс `demo` в режиме проверки (`BOT_COMMANDS`, `DEMO_COMMAND`). Файл: `apps/bot/src/bot.ts`.
- До согласия с документами работают только `start`, `help`, `legal`, `contacts`; запрошенное выполняется после согласия. Файлы: `apps/bot/src/bot.ts`, `apps/bot/src/commands/legal.ts`.
- Неизвестная команда получает ответ с меню. Файл: `apps/bot/src/bot.ts`.
- Команда отменяет начатый разговор. Файл: `apps/bot/src/bot.ts`.

### Меню по ролям <a id="bot-menu"></a>

Файл: `apps/bot/src/menu.ts`.

- Двухуровневое меню: первый экран частые дела и группы, второй пункты группы и «Меню»; по две кнопки в ряд; кнопка «Открыть приложение» при заданном `MINI_APP_URL`.
- Жилец: «Что сломалось», «Мои обращения», «Двери и камеры»; группы «Деньги и счётчики», «Новости дома» (объявления, собрания, заявки соседей, работа компании, капремонт), «Связь и профиль» (вопрос, приём, контакты, квартира, данные, уведомления).
- Сотрудник: «Очередь дома», «Мои наряды», «Дежурство»; группы «Жильцы», «Дела дома», «Связь и профиль», «В приложении» (осмотры, план, оборудование, узел учёта, люди, наклейки), «Управление домом» (тарифы, карточка, дома, журнал; только управляющему), «Моя квартира» (при привязке) или пункт привязки.
- Подрядчик: «Наряды», «Мои данные»; группа «Дела дома».
- «Долги дома» видят диспетчер и управляющий, «Рассылка» скрыта у мастера, «Двери и камеры» скрыты без домофонии, «Роль» добавляется в режиме проверки.
- Пункт с признаком `app` рассказывает о разделе и открывает приложение ссылкой `?startapp=go-<раздел>`. Подпись кнопки раздела не обещает: клиент MAX открывает мини-приложение на стартовом экране и параметр запуска до него не доносит, поэтому кнопка подписана «Открыть приложение», а сам раздел назван в сообщении над ней. Параметр в ссылке остаётся: он сработает, когда платформа начнёт его передавать. Файлы: `apps/bot/src/buttons.ts`, `apps/bot/src/commands/in-app.ts`, `apps/bot/src/keyboards.ts`, `packages/domain/src/deep-link.ts`.
- Экраны меню, группы и подсказки переписываются на месте, прежняя подсказка удаляется, ответ на подсказку убирается. Файл: `apps/bot/src/max.ts`.
- Под ответом бота кнопки «Назад» и «Меню». Файл: `apps/bot/src/max.ts`.

### Кнопки <a id="bot-buttons"></a>

Обработчики в `BUTTONS`, файл `apps/bot/src/buttons.ts`; клавиатуры в `apps/bot/src/keyboards.ts`.

- `menu:<команда>`, `group:<ключ>`, `group:back`, `app:<пункт>`, `cancel`, `more:<список>:<смещение>` (объявления и вопросы), `talk:stop`, `starter:<n>`.
- `legal:accept`: согласие с документами.
- `anyway`: заявка из сохранённого текста после ответа про работы или вопрос.
- `where:<заявка>:<n>` и `where:<заявка>:skip`: уточнение адреса.
- `req:<заявка>:<статус>[:yes]`: переход состояния; отзыв с подтверждением; приёмка жильцом через оценку.
- `rate:<заявка>:<звёзды>`: приёмка с оценкой или без.
- `ask:<заявка>:<статус>`: переход с причиной следующим сообщением.
- `do:<метка>:<заявка>`: дело, названное словами, с одноразовой меткой.
- `assign:<заявка>[:<сотрудник>]`: список исполнителей с загрузкой и назначение; новая заявка сначала принимается.
- `say:<заявка>`: сообщение по заявке следующим текстом или фото.
- `same:<заявка>`, `fine:<заявка>`: ответ соседа об аварии.
- `support:<заявка>` («И у меня»), `support:own` (свой вопрос сотрудника).
- `ticket:<обращение>`: реплика или ответ смены в поддержке.
- `pass:<заявка>`, `pass-to:<заявка>:<адресат>`, `handoff:<передача>`: передача смежной организации и запись ответа.
- `gzhi:<заявка>[:send|:yes]`: текст обращения в инспекцию, подтверждение, отправка.
- `meter:<прибор>`, `meter-skip:<прибор>`, `meter-read:<прибор>:<значение>`: выбор, пропуск, подтверждение числа с фото или из слов.
- `flat:<квартира>`, `bind:<код>`, `leave[:yes]`, `forget[:yes]`, `mydata:file`.
- `pay[:yes]`, `pay-debt[:yes]`: оплата с подтверждением суммы.
- `door:<устройство>`, `camera:<устройство>`, `guest:<устройство>`: открыть, кадр в переписку, гостевой код с кнопкой копирования.
- `vote:<собрание>:<выбор>`, `sign:<предложение>`.
- `mute:<вид>`, `unmute:<вид>`: уведомления.
- `demo:<роль>`.
- `visit:<время>`, `visit-cancel:<запись>`: тема приёма следующим сообщением, отмена записи.
- `cast:debtors`: переход в рассылку из списка долгов.
- Кнопка из старого сообщения отвечает всплывающим уведомлением и меню. Файлы: `apps/bot/src/bot.ts`, `apps/bot/src/buttons.ts`.
- Отказ правила на нажатие приходит всплывающим уведомлением и сообщением с подсказкой действия. Файлы: `apps/bot/src/buttons.ts`, `apps/bot/src/keyboards.ts`.

### Разговор словами <a id="bot-dialog"></a>

Файл: `apps/bot/src/dialog.ts`, если не указано иное.

- Ожидания разговора: описание, показание, вопрос в поддержку, сообщение по заявке, причина перехода, тема приёма, ответ организации, код квартиры, помощник. Тип `Awaiting` в `apps/bot/src/max.ts`.
- Выход словом «отмена», «стоп», «хватит», «выход». Файл: `apps/bot/src/max.ts`.
- Порядок разбора свободного сообщения: дело по заявке, показание словами, голое число, короткая вежливость, код квартиры, номер заявки, посторонняя просьба, обращение.
- Дело по открытой заявке словами с подтверждением кнопкой; при нескольких заявках выбор из четырёх; отказ с объяснением при отсутствии права. Файлы: `apps/bot/src/doing.ts`, `packages/app/src/doing.ts`.
- Поручение наряда по имени мастера (имя сверяется по основе слова). Файл: `packages/app/src/doing.ts`.
- Показание словами: «хвс 12350», несколько приборов в сообщении, выбор при нескольких приборах одного вида. Файл: `packages/app/src/meters.ts`.
- Голое число: вопрос, чей это счётчик, с числом в кнопке. Клавиатура `metersForValueKeyboard`.
- Короткая вежливость отвечает меню (`isChatter`, `SMALL_TALK`, `SHORT_BUT_CLEAR`). Файл: `apps/bot/src/max.ts`.
- Код квартиры сообщением: проверка алфавита и длины, подтверждение при смене квартиры. Файл: `packages/domain/src/apartment-code.ts`.
- Номер заявки в сообщении открывает её карточку с зоной ответственности и передачами. Файлы: `packages/domain/src/request.ts`, `apps/bot/src/pages.ts`.
- Посторонняя просьба (по модели `onTopic`) получает отказ словами роли и кнопку в поддержку. Файл: `packages/app/src/assistant.ts`.
- Просьба открыть раздел («открой дверь», «капитальный ремонт») выполняет команду или открывает раздел (`sectionFor`). Файл: `packages/app/src/incidents/submit.ts`.
- Вопрос о доме получает ответ данными и кнопки раздела и «Оформить заявку». Файлы: `apps/bot/src/reply.ts`, `packages/app/src/answers.ts`.
- Пустое сообщение, наклейка, геометка отвечают просьбой написать словами.
- Отметка «Думаю…» при разборе дольше секунды. Файл: `apps/bot/src/thinking.ts`.
- Помощник: старт с готовыми вопросами роли, ответы подряд, кнопка раздела, память шести пар реплик, выход кнопкой; рассказ о поломке уводит в заявку. Файлы: `apps/bot/src/talk.ts`, `apps/bot/src/max.ts`.
- Отказы при подаче обращения: без адреса совет отсканировать код, при пределе заявок телефон аварийной службы.

### Голос и фото <a id="bot-voice"></a>

- Записанное в чате голосовое платформа боту не доставляет: апдейт приходит без тела сообщения. Голосом пользуются в мини-приложении. Разбор: `docs/max-platform.md`.
- Путь расшифровки в боте написан и работает на аудиофайлах: запись расшифровывается до разбора (`readAloud`), расшифровка остаётся при вложении; без расшифровщика заявка заводится с вложением и просьбой написать суть. Он включится, когда платформа начнёт доставлять голосовые. Файлы: `apps/bot/src/dialog.ts`, `packages/app/src/incidents/attachments.ts`.
- Число словами («сто двадцать три запятая четыре») переспрашивается кнопкой. Файлы: `apps/bot/src/readings.ts`, `packages/domain/src/numerals.ts`.
- Фото табло в ожидании показания читается моделью, число подтверждается кнопкой `meter-read`. Файл: `apps/bot/src/readings.ts`.
- Фото и файл как обращение, фото как отчёт о работе или сообщение по заявке. Файлы: `apps/bot/src/dialog.ts`, `apps/bot/src/max.ts`.
- Файлы в переписку: выгрузка данных, наклейки, лист для печати, реестр и показания, кадр камеры (`sendFile`). Файл: `apps/bot/src/bot.ts`.

### Уведомления <a id="bot-notifications"></a>

Тексты в `packages/app/src/notifier.ts`, доставка через `createBotNotifier` в `apps/bot/src/bot.ts`; под каждым уведомлением есть кнопка (действия, ответ, раздел приложения, отключение).

- Новая заявка смене дома; ночью дежурному; без своих сотрудников всем управляющим; мастеру только при отсутствии принимающих. Файл: `packages/app/src/incidents/notify.ts`.
- Смена состояния всем сообщившим, старшему подъезда и исполнителю; назначение исполнителю; передача наряда другому. Файл: `packages/app/src/use-cases/requests.ts`.
- Сообщение по заявке: от смены заявителям, от жильца исполнителю и писавшим сотрудникам, соседям по заявке. Файл: `packages/app/src/use-cases/requests.ts`.
- Вопрос соседям по адресу при приёме аварии в работу с кнопками «И у меня» и «Всё работает». Файл: `packages/app/src/use-cases/requests.ts`.
- Стук соседу сверху. Файл: `packages/app/src/incidents/neighbours.ts`.
- Повторный вызов смены и объявление дому при третьем сообщившем. Файлы: `packages/app/src/incidents/notify.ts`, `packages/app/src/broadcast.ts`.
- Смене при пятом поддержавшем неаварийную заявку. Файл: `packages/app/src/support.ts`.
- Предупреждение о последней четверти срока исполнителю или смене; нарушение срока заявителям с кнопкой обращения в инспекцию и смене. Файл: `packages/app/src/incidents/reminders.ts`.
- Напоминание о приёмке на середине срока автозакрытия; сообщение о закрытии молчанием. Файл: `packages/app/src/incidents/reminders.ts`.
- Работы завтра, начались, закончились затронутым квартирам. Файл: `packages/app/src/incidents/reminders.ts`.
- Объявление затронутым квартирам с кнопкой отключения; рассылка получателям. Файлы: `packages/app/src/use-cases/announcements.ts`, `packages/app/src/use-cases/broadcast.ts`.
- Собрание объявлено, напоминание за два дня не голосовавшим, итоги, замена голоса соседом. Файл: `packages/app/src/voting.ts`.
- Предложение соседа с кнопкой «Поддержать», требование собрания смене, созыв автору. Файл: `packages/app/src/initiatives.ts`.
- Избрание старшего ему и смене. Файл: `packages/app/src/voting.ts`.
- Передача обращения и ответ организации заявителям. Файл: `packages/app/src/handoff.ts`.
- Отправка обращения в инспекцию заявителю. Файл: `packages/app/src/incidents/escalation.ts`.
- Вопрос в поддержку смене с кнопкой ответа; ответ смены жильцу с именем ответившего. Файл: `packages/app/src/helpdesk.ts`.
- Запись на приём смене; запись пришедшего и отмена жильцу. Файл: `packages/app/src/visits.ts`.
- Напоминание о показаниях в окне подачи, о поверке; смене о показании узла учёта. Файлы: `packages/app/src/meters.ts`, `packages/app/src/house-meters.ts`.
- Напоминание о долге после срока оплаты; напоминание одному должнику и его соседям по квартире. Файлы: `packages/app/src/debt.ts`, `packages/app/src/collection.ts`.
- Утренняя сводка смене. Файл: `packages/app/src/digest.ts`.
- Назначенный обход мастеру. Файл: `packages/app/src/inspections.ts`.
- Роль назначена или снята, дежурство, дома сотрудника. Файл: `packages/app/src/roles.ts`.
- Привязка соседа к квартире, привязка и отвязка сотрудником. Файл: `packages/app/src/binding.ts`.
- Заявка смены по квартире её жильцам. Файл: `packages/app/src/incidents/submit.ts`.
- Гость вошёл по коду. Файл: `packages/app/src/devices.ts`.
- Смена управляющей организации жильцам. Файл: `packages/app/src/handover.ts`.
- Отключаемые виды: показания, работы, собрания, объявления; аварии и свои заявки не отключаются. Файлы: `packages/domain/src/types.ts`, `packages/app/src/notices.ts`.
- Ошибка доставки уходит в журнал и сценарий не отменяет. Файл: `packages/app/src/notifier.ts`.

## Слой: мини-приложение <a id="miniapp"></a>

### Вход, сессия, режим без связи <a id="miniapp-session"></a>

- Вход обменом параметров запуска на сессионный токен, токен в шифрованном хранилище клиента, протухшая сессия заменяется молча. Файлы: `apps/miniapp/src/session.ts`, `apps/miniapp/src/api.ts`.
- Профиль `GET /api/me` определяет роль, привязку, подключённые службы (`doors`, `payments`, `reception`, `files`, `voice`, `meterPhoto`, `demo`, `model`, `legal`). Файл: `apps/api/src/routes/me.ts`.
- Ответы кешируются в `localStorage`; без связи экран показывает сохранённый ответ и метку «нет связи» в шапке; кнопка «Обновить». Файлы: `apps/miniapp/src/api.ts`, `apps/miniapp/src/screens/TopBar.tsx`.
- Согласие с документами при первом входе, документы открываются своим экраном с копированием. Файлы: `apps/miniapp/src/screens/Consent.tsx`, `apps/miniapp/src/screens/DocumentScreen.tsx`.
- Тур при первом входе по вкладкам и помощнику, отметка в хранилище клиента и `localStorage`. Файлы: `apps/miniapp/src/use-tour.ts`, `apps/miniapp/src/screens/Tour.tsx`.
- Тема системная, кит `@maxhub/max-ui`, кнопка «назад» платформы, тактильная отдача, подтверждение закрытия с недописанным текстом. Файлы: `apps/miniapp/src/App.tsx`, `apps/miniapp/src/haptics.ts`.

### Навигация и разделы по ролям <a id="miniapp-sections"></a>

Файлы: `apps/miniapp/src/navigation.ts`, `apps/miniapp/src/sections.ts`, `apps/miniapp/src/screens/registry.tsx`.

- Стартовый экран: жилец «Заявки», диспетчер и управляющий «Очередь», мастер и подрядчик «Наряды». У жильца без привязки один экран «Квартира», панели разделов и помощника нет.
- Панель до пяти разделов, остальное в «Ещё» с группами «Смена», «Дом», «Деньги», «Управление», «Своё», «Проверка».
- Жилец: Заявки, Дом, Оплата, Новости; в «Ещё» Собрания, Работа дома, Поддержка, Приём, Капремонт, Помощник, Профиль, Квартира.
- Сотрудник: Очередь, Наряды, Дом, Новости; в «Ещё» Поддержка, Приём, Рассылка (диспетчер, управляющий), Сводка, План дома, Осмотры, Оборудование, Наклейки, Узел учёта, Тарифы, Долги, Дома, Люди дома, Карточка дома (управляющий), Действия (управляющий), Собрания, Капремонт, Оплата, Работа дома, Профиль; свои разделы у смены только в режиме проверки.
- Подрядчик: Наряды, Профиль; при привязке Оплата, Поддержка, Собрания, Работа дома.
- Раздел без поставщика скрыт и по ссылке не открывается: «Дом» без домофонии, «Приём» без окон, «Наклейки» без доставки файлов, «Роль» без `DEMO_ROLES`.
- Ссылка `?startapp=go-<раздел>` открывает раздел, код объекта открывает паспорт. Файл: `apps/miniapp/src/navigation.ts`.
- Значки с числом дел: у диспетчера новые и просроченные заявки и вопросы без ответа, у мастера просроченные наряды, у жильца заявки, ждущие его, и ответы поддержки. Файл: `apps/miniapp/src/App.tsx`.
- Переключатель дома в шапке у сотрудника, переключатель квартиры на экранах «Оплата», «Собрания», «Работа дома» и у жильца на корневых экранах. Файл: `apps/miniapp/src/App.tsx`.
- Раздел, закрытый роли, показывает пояснение и кнопку в меню. Файл: `apps/miniapp/src/screens/registry.tsx`.
- Разделы смены грузятся отдельными кусками сборки. Файл: `apps/miniapp/src/screens/registry.tsx`.

### Экраны <a id="miniapp-screens"></a>

Файлы в `apps/miniapp/src/screens/`.

- Квартира (`BindApartmentScreen.tsx`): ввод кода, подсказка где он, переход в поддержку, контакты дома.
- Заявки (`RequestListScreen.tsx`, `HouseNow.tsx`, `HouseAhead.tsx`, `HouseRequests.tsx`, `RequestRow.tsx`): «Сейчас в доме», «Скоро в доме», свои заявки с остатком срока и метками, закрытые страницами, заявки соседей с «И у меня», кнопка новой заявки; у смены «В работу» из строки.
- Новая заявка (`NewRequestScreen.tsx`, `Composer.tsx`, `PhotoField.tsx`): текст, фото, голос, объект с наклейки, выбор квартиры или дома у смены, ответ про работы с «всё равно», ответ на вопрос с «всё равно» и «в поддержку», ответ соседа об аварии по объекту.
- Заявка (`RequestScreen.tsx`, `RequestActions.tsx`, `Attachments.tsx`, `Clarify.tsx`, `Responsibility.tsx`): история с вложениями, переписка, действия по роли с исполнителем и фото результата, скан наклейки при сдаче, оценка звёздами, опрос соседей, стук наверх, телефон автора смене, уточнение адреса, зона ответственности с передачей и записью ответа, обращение в инспекцию с текстом и отправкой, «И у меня».
- Объект (`ObjectScreen.tsx`): паспорт по коду: открытые заявки, история, поломки по месяцам, последний ремонт, прогноз, устройства подъезда, кнопка «Сообщить о поломке».
- Дом (`HomeScreen.tsx`, `DoorRow.tsx`, `CameraScreen.tsx`, `GuestScreen.tsx`, `JournalScreen.tsx`): двери и шлагбаумы, камеры, гостевые коды с отзывом, сканирование наклейки; у смены датчики со связью и журнал открытий; строка о модельном подключении.
- Оплата (`MetersScreen.tsx`, `ChargesCard.tsx`): счётчики с прошлым показанием и поверкой, ввод показания, «Снять табло», расход столбиками, прогресс дома по показаниям, квитанция построчно с основанием, ОДН, пени, долг по месяцам, оплата и погашение, история платежей.
- Новости (`AnnouncementsScreen.tsx`): лента по адресату страницами, пересылка в MAX, у смены публикация объявления и плановых работ с адресатом и охватом.
- Рассылка (`BroadcastScreen.tsx`): выбор адресата из подъездов, стояков, номеров квартир, должников, не подавших показания, не проголосовавших, смены; охват; подтверждение.
- Собрания (`PollsScreen.tsx`): бюллетень с долями, кворумом и недостающими метрами, голос с подтверждением замены, протокол, номера в системе, предложения с подписями, своё предложение, у смены объявление собрания или опроса и созыв по инициативе.
- Работа дома (`QualityScreen.tsx`): подано, закрыто, в срок, среднее время, оценка жильцов, сравнение с прошлым периодом, «Сейчас в доме».
- Поддержка (`SupportScreen.tsx`): контакты дома с вызовом и письмом, дежурный, приём; переписка по вопросам; у смены вопросы дома с ожиданием и ответ.
- Приём (`VisitsScreen.tsx`): свободные часы по дням, своя запись и отмена; у смены записи с квартирой и темой, отметка «принят», запись пришедшего, отмена записи жильца, у управляющего окна приёма.
- Капремонт (`CapitalRepairScreen.tsx`): взнос, накопленное, оператор, работы по годам, пометка о модельном источнике.
- Помощник (`Assistant.tsx`): разговор с историей, готовые вопросы, кнопка раздела, голосовой ввод.
- Профиль (`ProfileScreen.tsx`): телефон из платформы, уведомления, документы, данные файлом, отвязка квартиры, удаление профиля; у смены переключатель дежурства.
- Роль (`DemoScreen.tsx`): примерка роли в режиме проверки.
- Очередь (`QueueScreen.tsx`): отбор и поиск, риск срыва, приём из строки у диспетчера и управляющего, заявка по звонку.
- Наряды (`RequestListScreen.tsx`): порученная работа, «В работу» из строки.
- Сводка (`ReportScreen.tsx`): месяц, квартал, год; сравнение с прошлым периодом; график подач по дням; категории, исполнители, объекты, аварии, осмотры, переданные обращения; пересказ моделью; выгрузка CSV/XLSX или в чат.
- План дома (`PlanScreen.tsx`): подъезды, стояки, квартиры с состоянием, заявки по стояку, подъезду и дому; переход в заявку.
- Осмотры (`InspectionsScreen.tsx`): обходы и ТО, отметка пунктов с комментарием и фото, заявки из недостатков, отметка на месте сканом.
- Оборудование (`EquipmentScreen.tsx`): отказы, последняя поломка, средний промежуток, прогноз, переход к паспорту.
- Наклейки (`StickersScreen.tsx`): поиск объекта, стиль из пяти, своя надпись, предпросмотр, отправка картинкой или файлом, пересылка в MAX, у смены лист для печати.
- Узел учёта (`HouseMetersScreen.tsx`): общедомовые приборы, расход за месяц, показание, у управляющего заведение прибора, выгрузка показаний CSV/XLSX или в чат.
- Тарифы (`TariffsScreen.tsx`): ставки с пометкой умолчания, правка управляющим.
- Долги (`DebtorsScreen.tsx`): должники с пенями и месяцами, напоминание одному.
- Дома (`BuildingsScreen.tsx`, `BuildingPicker.tsx`): парк компании с показателями, переключение, у управляющего новый дом.
- Люди дома (`ResidentsScreen.tsx`, `ApartmentPicker.tsx`): поиск, роли, дежурство, дома сотрудника, привязка жильца, пришедшие из чата дома без квартиры, отвязка, выборы старшего.
- Карточка дома (`ImportScreen.tsx`): контакты, обслуживание, часы приёма, часовой пояс, чат дома с отвязкой, квартиры и оборудование с импортом CSV, передача дома другой организации.
- Действия (`AuditScreen.tsx`): журнал сотрудников страницами.

### Помощник, голос, фото, тур <a id="miniapp-extra"></a>

- Помощник в шапке каждого экрана после согласия и в «Ещё»; ответ, раздел, история шести пар, готовые вопросы. Файлы: `apps/miniapp/src/screens/Assistant.tsx`, `apps/miniapp/src/App.tsx`.
- Запись голоса кнопкой у помощника, в новой заявке, в сообщениях по заявке и в поддержке; короткое нажатие включает, долгое как рация; предел 60 секунд и 2 МБ; расшифровка подставляется в поле; без микрофона системная запись файлом. Если расшифровывать нечем, кнопки записи нет: сервер говорит об этом признаком `voice` в профиле. Файлы: `apps/miniapp/src/use-voice.ts`, `apps/miniapp/src/screens/VoiceButton.tsx`, `apps/miniapp/src/capabilities.tsx`.
- Фото: уменьшение на устройстве, загрузка при выборе, показ по токену сессии. Файлы: `apps/miniapp/src/photo-input.ts`, `apps/miniapp/src/use-photos.ts`, `apps/miniapp/src/screens/Photo.tsx`.
- Снимок табло: кнопка при пустом поле, распознанное число подставляется. Файл: `apps/miniapp/src/screens/MetersScreen.tsx`.
- Возможности клиента проверяются у моста: сканер кода, запрос телефона, пересылка, тактильная отдача. Файлы: `apps/miniapp/src/screens/ScanCode.tsx`, `apps/miniapp/src/screens/ProfileScreen.tsx`, `apps/miniapp/src/screens/AnnouncementsScreen.tsx`.
- Стенд разработки с эмулятором клиента MAX и подписью параметров запуска. Файлы: `apps/miniapp/src/stand.ts`, `scripts/stand.mjs`, `packages/devhost/src/dev-host.ts`.

## Слой: API <a id="api"></a>

Fastify, файлы `apps/api/src/routes.ts` и `apps/api/src/routes/*.ts`. 119 путей, 135 операций в `openapi.json`. Все маршруты `/api/*`, кроме отмеченных «без входа», требуют сессионный токен; роль указана словами прикладного слоя.

Вход и документы (`apps/api/src/routes.ts`, `apps/api/src/routes/me.ts`):

- `POST /auth/session`: токен по `x-max-init-data`; без входа.
- `GET /api/legal`: документы; без входа.
- `POST /api/me/logout`: отзыв токена.
- `GET /api/me`, `POST /api/me/legal`, `DELETE /api/me` (жилец), `GET /api/me/data`, `GET/POST /api/me/notices`, `POST/DELETE /api/me/contact`.
- `GET /api/assistant`, `POST /api/assistant`: помощник; все роли.
- `GET/POST /api/demo`: роли проверки; только в `DEMO_ROLES`.
- `GET /api/context/{startParam}`: что означает код объекта.
- `POST /api/me/apartment`, `GET /api/me/apartments`, `POST /api/me/apartment/use`: привязка и переключение квартир.

Заявки (`apps/api/src/routes/requests.ts`, `handoffs.ts`, `complaint.ts`):

- `POST /api/requests`: обращение; 201 новая, 200 присоединение, ответ про работы или ответ на вопрос; `apartmentId`/`house` смене.
- `GET /api/requests?scope=mine|queue|closed`: свои, очередь дома с риском (смена), закрытые страницами.
- `GET /api/requests/house`: заявки дома, касающиеся жильца.
- `GET /api/requests/{id}`, `GET /api/requests/{id}/actions`, `POST /api/requests/{id}/transition`, `POST /api/requests/{id}/comment`.
- `POST /api/requests/{id}/answer`, `POST /api/requests/{id}/support`, `POST /api/requests/{id}/knock`.
- `GET /api/requests/{id}/contact`: телефон автора; сотрудник компании.
- `GET /api/requests/{id}/clarify`, `POST /api/requests/{id}/target`: уточнение адреса автором.
- `GET /api/requests/{id}/responsibility`, `POST /api/requests/{id}/handoff` (смена), `POST /api/handoffs/{id}/answer` (смена), `GET /api/handoffs` (смена).
- `GET/POST /api/requests/{id}/complaint`: обращение в инспекцию заявителем; 409 без основания.
- `GET /api/objects/{startParam}`: паспорт объекта.
- `POST /api/files`, `GET /api/files/{id}`: снимки.
- `POST /api/voice`: расшифровка записи; без расшифровщика отказ. Файл: `apps/api/src/routes/voice.ts`.

Деньги (`apps/api/src/routes/billing.ts`, `meters.ts`):

- `GET /api/charges`, `GET /api/payments`, `POST /api/charges/pay`, `POST /api/charges/debt/pay`: жилец с квартирой.
- `GET /api/debtors`, `POST /api/debtors/{id}/remind`: сотрудник компании.
- `GET /api/tariffs` (сотрудник), `POST /api/tariffs` (управляющий).
- `GET /api/meters`, `GET /api/meters/progress`, `POST /api/meters/{id}/photo`, `POST /api/meters/{id}/readings`, `GET /api/meters/{id}/history`.
- `GET /api/house-meters` (сотрудник), `POST /api/house-meters` (управляющий), `POST /api/house-meters/{id}/readings` (сотрудник).
- `GET /api/export/readings.csv`, `GET /api/export/readings.xlsx`, `POST /api/export/readings/send`: сотрудник.

Собрания (`apps/api/src/routes/voting.ts`):

- `GET /api/polls`, `POST /api/polls` (диспетчер, управляющий; `mode` meeting или survey), `POST /api/polls/elder` (диспетчер, управляющий), `POST /api/polls/{id}/vote`, `GET /api/polls/{id}/protocol`, `GET /api/polls/{id}/protocol.txt`.
- `GET /api/initiatives`, `POST /api/initiatives`, `POST /api/initiatives/{id}/support`, `POST /api/initiatives/{id}/meeting` (диспетчер, управляющий).

Умный дом (`apps/api/src/routes/devices.ts`, `apps/api/src/routes.ts`):

- `GET /api/devices`, `POST /api/devices/{id}/open`, `GET /api/devices/{id}/snapshot`, `POST /api/devices/{id}/guest`, `GET /api/devices/guest-codes`, `POST /api/devices/guest-codes/{code}/revoke`.
- `GET /api/devices/sensors`, `GET /api/devices/journal`: сотрудник компании.
- `POST /api/hub/alarm`, `POST /api/hub/guest-entry`: события оборудования с `x-hub-secret`; только при `HUB_SECRET`.

Люди и дома (`apps/api/src/routes/staff.ts`, `buildings.ts`, `handover.ts`, `house.ts`):

- `GET /api/staff`, `GET /api/residents`, `GET /api/residents/unbound`, `GET /api/apartments`, `POST /api/residents/{id}/apartment`, `POST /api/residents/{id}/unbind`: сотрудник компании.
- `POST /api/residents/{id}/role`, `POST /api/residents/{id}/buildings`: управляющий; `POST /api/residents/{id}/duty`: диспетчер, управляющий.
- `GET /api/audit`: управляющий.
- `GET /api/buildings`, `GET /api/buildings/report` (сотрудник), `POST /api/buildings` (управляющий), `POST /api/buildings/card` (управляющий), `DELETE /api/buildings/chat` (управляющий), `POST /api/buildings/handover` (управляющий).
- `POST /api/import/apartments`, `POST /api/import/equipment`: управляющий.
- `GET /api/announcements`, `POST /api/announcements` (диспетчер, управляющий).
- `GET /api/inspections`, `POST /api/inspections/{id}/prove`, `POST /api/inspections/{id}/items/{index}`: сотрудник компании.
- `GET /api/report`, `GET /api/report/digest`, `GET /api/report/requests.csv`, `GET /api/report/requests.xlsx`, `POST /api/report/requests/send`: сотрудник компании.
- `GET /api/quality`, `GET /api/now`, `GET /api/ahead`, `GET /api/house/contacts`: все роли.
- `GET /api/plan`, `GET /api/equipment`: сотрудник компании.
- `GET /api/capital-repair`: все роли; без порта пустой список.

Рассылка, наклейки, поддержка, приём (`apps/api/src/routes/broadcast.ts`, `stickers.ts`, `support.ts`, `visits.ts`):

- `GET /api/broadcast/targets`, `POST /api/broadcast/preview`, `POST /api/broadcast`: диспетчер, управляющий.
- `GET /api/stickers`, `GET /api/stickers/image`, `POST /api/stickers/send`: жилец и сотрудник; `POST /api/stickers/sheet`: сотрудник.
- `GET /api/support`, `POST /api/support`, `GET /api/support/{id}`, `POST /api/support/{id}/answer` (сотрудник), `POST /api/support/{id}/close`, `GET /api/support/waiting`.
- `GET /api/reception`, `POST /api/reception` (сотрудник), `GET /api/visits`, `POST /api/visits`, `POST /api/visits/record` (сотрудник), `POST /api/visits/{id}/cancel`, `POST /api/visits/{id}/done` (сотрудник).

Служебное (`apps/api/src/server.ts`, `routes.ts`, `metrics.ts`, `rate-limit.ts`, `compress.ts`, `openapi.ts`, `errors.ts`):

- `GET /health` с проверкой хранилища, `GET /metrics` в формате Prometheus с `METRICS_TOKEN`, `GET /openapi.json`.
- `POST /bot/updates`: вебхук платформы с секретом.
- Раздача лендинга в корне и приложения в `/app/`, страница `404.html`, кеш по типу файла, предсжатые копии.
- Пределы частоты: 300 запросов в минуту на сессию, 10 на вход, 10 на выгрузки и импорт; `429` с `retry-after`.
- Заголовки безопасности, `frame-ancestors` для приложения, CORS по списку.
- Коды ошибок по смыслу: 401, 403, 404, 409, 400, 503 для внешних служб.
- `buildingId` в строке запроса у маршрутов смены с проверкой границы организации. Файл: `apps/api/src/context.ts`.

## Слой: правила и сценарии <a id="rules"></a>

Заявки и сроки:

- Категории: лифт, вода и канализация, отопление, электричество, уборка, двор, безопасность, справки и документы, другое; у каждой минуты на реакцию и часы на выполнение и срочность по умолчанию. `CATEGORY_RULES`. Файл: `packages/domain/src/sla.ts`.
- Срочность сжимает сроки: авария 0,25, обычная 1, плановая 2. Авария ограничена 30 минутами локализации и 72 часами устранения, засор двумя часами. Файлы: `packages/domain/src/sla.ts`, `packages/domain/src/request.ts`.
- Категория и срочность по ключевым словам; аварийные слова «залив», «прорыв», «застрял», «дым», «искр», «запах газа», «без отопления». Файл: `packages/domain/src/request.ts`.
- Номер заявки «код дома-ГГММ-порядковый» по календарю дома. Файл: `packages/domain/src/request.ts`.
- Переходы состояний с ролями и обязательным объяснением (`TRANSITIONS`); в работу только с исполнителем; оценка только при приёмке; снятие только автором. Файлы: `packages/domain/src/status.ts`, `packages/app/src/use-cases/requests.ts`.
- Ожидание ответа жильца и сданная работа в просрочку не идут. Файл: `packages/domain/src/sla.ts`.
- Предупреждение на последней четверти срока, нарушение по пересечению между проверками. Файл: `packages/domain/src/sla.ts`.
- Автозакрытие через 72 часа молчания с напоминанием на середине. Файл: `packages/domain/src/status.ts`.
- Прогноз срыва срока по медиане закрытых заявок категории за полгода, не менее трёх. Файлы: `packages/domain/src/sla.ts`, `packages/app/src/incidents/passport.ts`.
- Очередь: сначала открытые, потом ждущие приёмки, потом закрытые; внутри просроченные, подтверждённые аварии, ближайший срок. Файл: `packages/domain/src/sla.ts`.
- Предел 10 заявок в час на жильца; повтор того же текста за две минуты возвращает первую заявку. Файл: `packages/app/src/incidents/submit.ts`.
- Обращение длиннее 2000 знаков сокращается моделью или до последней целой фразы. Файл: `packages/app/src/incidents/submit.ts`.
- Проверка сказанного: отписки, набор знаков, короткие ответы через модель. Файл: `packages/app/src/said.ts`.
- Адрес обращения: код наклейки, названная квартира, дом, привязка автора; из разбора текста подъезд, дом или оборудование. Файлы: `packages/app/src/use-cases/requests.ts`, `packages/app/src/incidents/submit.ts`.
- Уточнение адреса кнопками при нескольких квартирах, названном оборудовании или адресе домом; варианты только из объектов дома. Файл: `packages/app/src/clarify.ts`.
- Заявка смены по квартире делает её жильцов заявителями. Файл: `packages/app/src/incidents/submit.ts`.
- Совет при аварии по категории. Файл: `packages/domain/src/sla.ts`.

Склейка, соседи, объявления:

- Склейка обращений по общему имуществу: та же категория, покрывающая зона, открыта, в пределах 24 часов, другой автор; квартира переходит на стояк. Файлы: `packages/domain/src/incident.ts`, `packages/app/src/incidents/submit.ts`.
- Три сообщивших дают подтверждённую аварию, объявление дому и повторный вызов смены. Файлы: `packages/domain/src/incident.ts`, `packages/app/src/incidents/notify.ts`.
- Опрос соседей при приёме в работу; два ответа «работает» указывают на квартиру; картина ответов по квартирам. Файлы: `packages/domain/src/incident.ts`, `packages/app/src/incidents/neighbours.ts`.
- Стук соседу сверху один раз, квартира выше по номеру в стояке. Файлы: `packages/domain/src/audience.ts`, `packages/app/src/incidents/neighbours.ts`.
- Плановые работы объясняют обращение при совпадении категории, времени и зоны; сообщения за 24 часа, о начале и окончании. Файлы: `packages/domain/src/works.ts`, `packages/app/src/incidents/reminders.ts`.
- Адресат объявления и заявки: дом, подъезд, стояк, квартира, оборудование. Файл: `packages/domain/src/audience.ts`.
- Заявка от датчика протечки или дыма от имени управляющего, аварийная, по стояку или подъезду. Файл: `packages/app/src/sensors.ts`.
- Зона ответственности: управляющая, ресурсники, подрядчик, муниципалитет, собственник; по категории, адресу и опросу; с основанием и словами жильца. Файл: `packages/domain/src/responsibility.ts`.
- Передача смежной организации из карточки дома: срок ответа 2 часа ресурсникам, 24 часа подрядчику, 30 дней муниципалитету и инспекции; повторная передача тому же адресату запрещена; статус и ответ. Файлы: `packages/domain/src/responsibility.ts`, `packages/app/src/handoff.ts`.
- Обращение в инспекцию: основание при нарушенном сроке реакции или двукратном превышении срока выполнения; текст с хронологией и участниками; отправка каналом передачи; один раз; смена по своему дому не составляет. Файлы: `packages/domain/src/escalation.ts`, `packages/app/src/incidents/escalation.ts`.
- Настроение дома: спокоен, просрочка, авария. Файл: `packages/domain/src/mood.ts`.

Счётчики и деньги:

- Виды приборов с единицами, разрядностью и знаками; окно подачи 20..25; поверка с предупреждением за 60 дней и отказом после. Файл: `packages/domain/src/meters.ts`.
- Проверки показания: число не меньше нуля, не длиннее табло, не меньше прошлого кроме переполнения, одно на расчётный период, поверка не истекла. Файл: `packages/domain/src/meters.ts`.
- Расчётный период с учётом окна: до 20 числа показание относится к прошлому месяцу. Файл: `packages/domain/src/meters.ts`.
- Скачок расхода втрое и сравнение с медианой соседей (три и более). Файлы: `packages/domain/src/meters.ts`, `packages/app/src/meters.ts`.
- Без показаний три месяца по среднему за полгода, дальше норматив с коэффициентом 1,5 на воду и электричество. Файлы: `packages/domain/src/norms.ts`, `packages/app/src/consumption.ts`.
- Квитанция: строки по ресурсам с объёмом, тарифом и основанием, ОДН, содержание по площади, срок оплаты до 10 числа. Файлы: `packages/domain/src/billing.ts`, `packages/app/src/billing.ts`.
- ОДН: разница узла учёта и суммы квартир по площади, только положительная. Файлы: `packages/domain/src/common.ts`, `packages/app/src/house-meters.ts`.
- Пени: 30 дней без пеней, до 90 дня 1/300 ставки, дальше 1/130. Файл: `packages/domain/src/penalty.ts`.
- Долг за шесть месяцев по тарифам своего месяца, оплата на каждый месяц отдельно, напоминание после срока. Файл: `packages/app/src/debt.ts`.
- Долги дома по помещениям, крупные сверху, напоминание одному с записью в журнал. Файл: `packages/app/src/collection.ts`.
- Тарифы с датой начала, умолчания помечены, ключевая ставка среди тарифов. Файл: `packages/app/src/tariffs.ts`.
- Общедомовой прибор один на ресурс, показание снимает смена с исправлением в месяце. Файл: `packages/app/src/house-meters.ts`.
- Выгрузка показаний и реестра заявок за календарный период, CSV с BOM и защитой от формул, XLSX. Файлы: `packages/app/src/export.ts`, `packages/app/src/report.ts`, `packages/app/src/csv.ts`, `apps/api/src/xlsx.ts`.

Собрания и соседи:

- Голос долей площади, простое большинство от участвующих, квалифицированное две трети от дома, кворум более половины; без площадей решение не подтверждается; недостающие метры. Файл: `packages/domain/src/voting.ts`.
- Один голос на помещение, считается последний, сосед уведомляется. Файл: `packages/app/src/voting.ts`.
- Сроки собрания по ст. 47.1 ЖК РФ при подключённой системе; опрос без сроков и кворума. Файлы: `packages/domain/src/meeting.ts`, `packages/app/src/voting.ts`.
- Итоги и протокол по сроку, напоминание за два дня без кворума. Файлы: `packages/app/src/voting.ts`, `packages/app/src/sweep.ts`.
- Инициатива: одна открытая на человека, подписи по площади, десятая часть даёт требование, созыв кнопкой. Файлы: `packages/domain/src/voting.ts`, `packages/app/src/initiatives.ts`.
- Старший по подъезду на два года по решению собрания. Файлы: `packages/domain/src/voting.ts`, `packages/app/src/elders.ts`.

Дом и обслуживание:

- Осмотры: подъезд 30 дней, кровля 90, подвал 30, вентканалы 180, лифт 30, домофон 180, узел учёта 90; пункты чек-листа; недостаток требует комментария и становится заявкой. Файлы: `packages/domain/src/inspection.ts`, `packages/app/src/inspections.ts`.
- Обходы заводятся по сроку от последнего законченного, мастеру с наименьшей загрузкой. Файл: `packages/app/src/inspections.ts`.
- Прогноз отказов по среднему промежутку между поломками объекта. Файлы: `packages/domain/src/wear.ts`, `packages/app/src/health.ts`.
- План дома: состояние квартиры авария, открыто, работает, тихо. Файл: `packages/app/src/plan.ts`.
- Паспорт объекта: открытые заявки, история, последний ремонт, прогноз; видимость по дому и своей квартире. Файл: `packages/app/src/incidents/passport.ts`.
- Наклейки: подъезды, стояки, оборудование, квартиры; пять стилей; надпись до 80 знаков; ссылки `?start=` и `?startapp=`; жильцу свои объекты и оборудование. Файлы: `packages/domain/src/stickers.ts`, `packages/domain/src/deep-link.ts`, `packages/app/src/stickers.ts`, `packages/stickers/src/render.ts`.
- Код квартиры: восемь знаков из алфавита без похожих символов, пять промахов закрывают привязку на час, соседи по квартире уведомляются. Файлы: `packages/domain/src/apartment-code.ts`, `packages/app/src/binding.ts`.
- Импорт квартир: колонки помещение, подъезд, стояк, площадь, жильцов, приборы по ресурсам; повтор обновляет; оборудование по видам лифт, домофон, шлагбаум, узел учёта. Файлы: `packages/app/src/import.ts`, `packages/app/src/setup.ts`.
- Карточка дома: контакт, служба, приёмные окна, длительность приёма 5..240 минут, смежные организации по категориям и каналу. Файлы: `packages/app/src/setup.ts`, `packages/domain/src/reception.ts`.
- Приём: окна по дням недели, слоты на 14 дней, одна запись на человека, отмена до начала, запись пришедшего без проверки окон. Файлы: `packages/domain/src/reception.ts`, `packages/app/src/visits.ts`.
- Дежурство: рабочие часы 8..20 по поясу дома, ночью дежурные, без дежурных вся смена. Файл: `packages/domain/src/duty.ts`.
- Поддержка: состояния открыт, отвечен, закрыт; срок ответа 10 рабочих дней с праздниками; ждущие первыми. Файлы: `packages/domain/src/helpdesk.ts`, `packages/app/src/helpdesk.ts`.
- Рассылка: адресаты и отключаемые виды; отправитель исключается; журнал. Файлы: `packages/domain/src/broadcast.ts`, `packages/app/src/use-cases/broadcast.ts`.
- Смена управляющей организации: новый владелец, старая смена теряет дом, чат и история остаются. Файл: `packages/app/src/handover.ts`.
- Несколько организаций: код дома уникален в организации, дома чужой организации закрыты. Файл: `packages/app/src/buildings.ts`.
- Часовой пояс дома для сроков, периодов и утра. Файлы: `packages/app/src/zone.ts`, `packages/domain/src/reception.ts`.

Данные и учёт:

- Журнал действий сотрудников: 30 видов действия, действия жильца не пишутся, доступ управляющему. Файл: `packages/app/src/audit.ts`.
- Выгрузка данных: имя, адрес, телефон, отключённые уведомления, заявки с репликами, показания, голоса, платежи. Файл: `packages/app/src/privacy.ts`.
- Удаление профиля обезличивает: имя, MAX id, квартиры, телефон, настройки; профиль сотрудника не удаляется. Файл: `packages/app/src/privacy.ts`.
- Согласие с версией документов, повторный запрос при новой редакции. Файлы: `packages/domain/src/legal.ts`, `packages/app/src/legal.ts`.
- Телефон принимается с подписью платформы, виден смене по открытой заявке. Файлы: `apps/api/src/routes/me.ts`, `packages/app/src/contact.ts`.
- Основания рядом с числами: норма, регламент, расчёт продукта, модель, модельное подключение (`BASIS`, `PLAIN`). Файл: `packages/domain/src/basis.ts`.
- Сводка: состояние сейчас, период и предыдущий, категории, исполнители с возвратами и оценкой, проблемные объекты от трёх заявок, аварии, осмотры, подачи по дням. Файлы: `packages/domain/src/analytics.ts`, `packages/app/src/report.ts`.
- Дома компании списком с просрочкой и долей в срок. Файл: `packages/app/src/portfolio.ts`.
- Обход по расписанию каждые 5 минут: работы, сроки, автозакрытие, итоги собраний; суточные с 9 утра по дому: показания, узел учёта, собрания, долг; с 8 утра сводка и осмотры; отметки в файле или Redis. Файлы: `packages/app/src/sweep.ts`, `apps/domovoy/src/main.ts`, `apps/domovoy/src/sweep-store.ts`.
- Помощник: возможности по ролям, стартовые вопросы, знания о продукте, проверка сумм по фактам, раздел только из доступных, отказ в постороннем. Файл: `packages/app/src/assistant.ts`.
- Досье помощника: своё, аварии и работы дома, соседские заявки по общему имуществу, начисления, долг, счётчики, собрания, капремонт, контакты; у смены очередь, вопросы, передачи, исполнители ролью и загрузкой, долг дома числом. Файл: `packages/app/src/dossier.ts`.

## Слой: интеграции и инфраструктура <a id="infra"></a>

Модель (`apps/domovoy/src/gigachat.ts`, `apps/domovoy/src/reasoner.ts`, `packages/app/src/reasoner.ts`):

- GigaChat по `GIGACHAT_AUTH_KEY` (модель `GigaChat-2-Max`, токен обновляется сам, один поток); иначе любая служба формата OpenAI по `REASONER_URL`; без них ключевые слова.
- Девять дел модели: разбор обращения (категория, срочность, объект, часть дома, заголовок, вопрос), вопрос или заявка с темой, маршрут в раздел, уточнение адреса, помощник, тема вопроса, смысл короткого ответа, дело по заявке, пересказ сводки.
- В модель уходит: текст человека в границах `<<<>>>`, адрес дома, подъезды и оборудование с кодами, номер квартиры обратившегося, разделы роли, знания о продукте, досье человека, история разговора помощника. Не уходит: имена и квартиры других людей, телефоны, чужие квартирные заявки.
- Ответ модели проверяется: категория из списка, приоритет не ниже ключевых слов, заголовок без новых чисел и слов, оборудование из списка дома, раздел из списка роли, суммы из фактов, числа пересказа из сводки. Файлы: `packages/app/src/reasoner.ts`, `packages/app/src/assistant.ts`, `packages/app/src/digest-text.ts`.
- Таймауты 8 секунд, помощнику 20; память ответов 30 секунд до 32 записей.

Речь и табло (`apps/domovoy/src/gigachat-files.ts`, `apps/domovoy/src/transcriber.ts`, `apps/domovoy/src/meter-vision.ts`):

- GigaChat расшифровывает голосовые и читает табло тем же ключом: файл загружается в хранилище модели, прикладывается к вопросу, удаляется после ответа; пределы 15 МБ снимок, 35 МБ запись, 30 секунд.
- Отдельные службы `SPEECH_URL` (форма `file`, ответ `{text}`) и `METER_VISION_URL` (ответ `{value}` или `{text}`) идут первыми, если заданы.
- Запись из приложения передаётся `data:`-строкой и не сохраняется. Файл: `apps/api/src/routes/voice.ts`.

Заглушки (`packages/app/src/devices-mock.ts`, `billing-mock.ts`, `handoff-mock.ts`, `meetings.ts`, `capital.ts`):

- `HUB=mock`: устройства демо-дома, журнал открытий, гостевые коды, кадр камеры рисуется SVG.
- `PAYMENTS=mock`: оплаты в памяти, история платежей.
- `HANDOFF=mock`: подтверждение приёма и номер вида `РСО-0001`, `ГЖИ-0001`.
- `MEETINGS=mock`: номера сообщения, решений и протокола.
- `CAPITAL_REPAIR=mock`: типовой план с взносом и работами.
- `REGISTRY=mock`: обмен с внешним реестром заявок, принимает записи и ведёт журнал; канал задаётся `REGISTRY_CHANNEL`. Файл: `apps/domovoy/src/registry-mock.ts`.
- `CITY_FEED=mock`: завтрашнее отключение горячей воды по первому дому установки; `CITY_FEED_URL`: настоящий источник в формате продукта; `GRID_FEED_URL`: диспетчерская сетевой организации в её собственном формате.

Хранилище и состояние:

- Postgres через `DATABASE_URL`, 64 миграции при старте; без базы память и набор для показа. Файлы: `packages/storage/src/postgres-repository.ts`, `packages/storage/migrations/`, `packages/app/src/memory-repository.ts`, `apps/domovoy/src/main.ts`.
- Redis через `REDIS_URL`: состояние диалога, сессии, распределённая блокировка склейки, отметки обхода. Файлы: `apps/domovoy/src/main.ts`, `packages/sessions/src/`.
- Позиция в потоке апдейтов в файле `MARKER_FILE`. Файлы: `apps/domovoy/src/main.ts`, `packages/runtime/src/marker-store.ts`.

Платформа MAX:

- Апдейты опросом или вебхуком `WEBHOOK_URL` с секретом; подписка при старте; повторная доставка отсеивается. Файлы: `apps/domovoy/src/main.ts`, `packages/runtime/src/webhook.ts`, `apps/api/src/server.ts`.
- Транспорт с таймаутами, повторами и лимитом 30 rps; сессия под блокировкой в репликах. Файлы: `packages/runtime/src/`, `apps/bot/src/bot.ts`.
- Проверка подписи `initData` на сервере, обмен на токен сессии. Файлы: `packages/server/src/init-data.ts`, `packages/server/src/session-auth.ts`.
- Корень «Russian Trusted Root CA» в образе, `NODE_EXTRA_CA_CERTS` без Docker. Файлы: `certs/`, `apps/domovoy/src/main.ts`.
- Форк SDK `@maxkit/max-bot-api` с описанием отличий. Файлы: `packages/max-bot-api/UPSTREAM.md`, `upstream/`.
- Эмулятор Bot API и стенд мини-приложения для разработки без токена. Файлы: `packages/platform-mock/src/`, `packages/devhost/src/`, `scripts/stand.mjs`.

Сборка и проверка:

- Один процесс: бот и API вместе, лендинг в корне, приложение в `/app/`. Файлы: `apps/domovoy/src/main.ts`, `apps/api/src/server.ts`.
- Docker: Postgres 16, Redis 7, продукт, Caddy с сертификатом. Файлы: `docker-compose.yml`, `Dockerfile`, `Caddyfile`.
- CI и выкладка по SSH после зелёного CI. Файлы: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`.
- Команды консоли: `seed`, `stickers`, `make-manager`, `add-building`, `building`, `import-equipment`, `import-apartments`, `export-readings`, `export-requests`, `walkthrough`. Файл: `apps/domovoy/src/cli.ts`.
- Сквозной прогон `walkthrough`: работы, код с наклейки, заявка вопреки работам, приём, опрос соседа, назначение, переписка, сдача, возврат, закрытие смены за жильца, домофон, гостевой код, датчик дыма, показания, квитанция, оплата, долги, чат дома, документы, привязка кодом, собрание и протокол, выгрузка данных, вопрос вместо заявки, вторая квартира, подрядчик, поддержка, наклейка, рассылка, приём, дежурство, сводка. Файл: `apps/domovoy/src/walkthrough.ts`.
- Набор для показа: два дома, восемь квартир, жильцы и смена, оборудование, заявки в разных состояниях, история месяца, плановые работы, собрание. Файлы: `apps/domovoy/src/demo.ts`, `testdata/demo.json`, `testdata/apartments.csv`, `testdata/equipment.csv`.
- `DATA-API.yaml` в формате DATA-API 1.0: 31 проверка с ролями, кодами, полями и схемой ответа, переменные через `extract`, очистка; проходит эталонный валидатор организаторов. `npm run check-api` прогоняет проверки и очистку по установке, `scripts/token.mjs` выдаёт токен на 12 часов, команда `check-tokens` выдаёт токены ролей до даты окончания проверки. Файлы: `DATA-API.yaml`, `scripts/check-api.mjs`, `scripts/token.mjs`, `apps/domovoy/src/cli.ts`.
- `openapi.json` собирается из схем Fastify командой `npm run openapi`. Файлы: `scripts/openapi.mjs`, `apps/api/src/openapi.ts`.
- Лендинг: главная, 11 страниц разделов, политика и соглашение из доменного слоя, `sitemap.xml`, `404.html`, `noscript` с описанием, ссылкой на бота и документами, предсжатые копии. Файлы: `landing/index.html`, `landing/src/sections.ts`, `landing/src/legal.tsx`, `landing/vite.config.ts`, `scripts/precompress.mjs`, `scripts/landing.mjs`.
- Тесты встроенным `node --test` во всех пакетах; экраны в happy-dom; API без Postgres; отдельный тест старта процесса. Файлы: `apps/*/test/`, `packages/*/test/`.

## Что модельное и что настоящее <a id="mocks"></a>

Настоящее (работает с данными продукта без внешних служб):

- Заявки, сроки, склейка, опрос соседей, стук наверх, уточнение адреса, зона ответственности, обращение в инспекцию (текст). Файлы: `packages/domain/src/`, `packages/app/src/incidents/`.
- Показания, квитанция, нормативы, ОДН, пени, долги, тарифы, узел учёта, выгрузки CSV/XLSX. Файлы: `packages/app/src/meters.ts`, `billing.ts`, `debt.ts`, `house-meters.ts`, `export.ts`.
- Собрания, инициативы, старший по подъезду, протокол. Файлы: `packages/app/src/voting.ts`, `initiatives.ts`, `elders.ts`.
- Осмотры, прогноз отказов, план дома, сводка, журнал действий, наклейки, поддержка, приём, рассылка, объявления, чат дома. Файлы: `packages/app/src/`.
- Бот на Bot API MAX, мини-приложение на Bridge, сессии, Postgres, Redis, вебхук. Файлы: `apps/`, `packages/`.
- Разбор текста, расшифровка речи, чтение табло через GigaChat или заданные службы; без них ключевые слова и ручной ввод. Файлы: `apps/domovoy/src/gigachat.ts`, `gigachat-files.ts`.

Модельное (заглушка за портом, включается переменной, помечено в `GET /api/me` полем `model` и на экранах):

- Домофония, камеры, датчики, гостевые коды, журнал открытий: `HUB=mock`; кадр камеры рисуется. Файл: `packages/app/src/devices-mock.ts`.
- Оплата и история платежей: `PAYMENTS=mock`. Файл: `packages/app/src/billing-mock.ts`.
- Передача обращений смежным организациям и в инспекцию: `HANDOFF=mock` выдаёт номер, наружу не уходит; без переменной передача записывается как ручная. Файлы: `packages/app/src/handoff-mock.ts`, `packages/app/src/handoff.ts`.
- Обмен с внешним реестром заявок (ГИС ЖКХ, учётная система организации): `REGISTRY=mock` принимает записи и ведёт журнал, наружу ничего не уходит; без переменной обмена нет, а выгрузка файлом остаётся. Файлы: `packages/app/src/registry.ts`, `apps/domovoy/src/registry-mock.ts`.
- Система собраний (ГИС ЖКХ): `MEETINGS=mock` выдаёт номера; без переменной сроки закона не применяются. Файл: `packages/app/src/meetings.ts`.
- Капитальный ремонт: `CAPITAL_REPAIR=mock` даёт типовой план; без переменной раздела нет. Файл: `packages/app/src/capital.ts`.
- Перерасчёт за отключение дольше нормы: часы сверх допустимого перерыва по приложению 1 к Правилам № 354 снижают плату за ресурс на 0,15% за час отдельной строкой квитанции; перерывы берутся из объявленных отключений, касавшихся квартиры. Файлы: `packages/domain/src/outages.ts`, `packages/app/src/billing.ts`.
- Отключения по данным города: `CITY_FEED_URL` читает события в общем формате продукта, `CITY_FEED=mock` показывает завтрашнее отключение; дома сверяются по адресу, событие становится объявлением о работах и уходит жильцам раз в обход. Файлы: `packages/app/src/city.ts`, `packages/app/src/sweep.ts`.
- Диспетчерская сетевой организации напрямую: `GRID_FEED_URL` читает отключения электричества в формате АО «Сетевая компания» без посредника, запрос идёт названием улицы по каждому дому установки за ближайшие дни, дом отбирается на нашей стороне. Файл: `packages/app/src/grid-feed.ts`.
- Обмена с ГИС ЖКХ и биллингом нет: данные заводятся импортом CSV и отдаются файлами. Файлы: `packages/app/src/import.ts`, `packages/app/src/export.ts`.
- Демонстрационный дом и люди вымышленные. Файл: `apps/domovoy/src/demo.ts`.
