import {
  bindApartment,
  choiceTitle,
  formatDemand,
  type InitiativeView,
  type OwnApartment,
  type AppDeps,
  type BindResult,
  type MeterState,
  type Resident,
} from '@domovoy/app';
import {
  formatMeterValue,
  formatMoney,
  type MeterKind,
  DomainError,
  METER_RULES,
  OPEN_STATUSES,
  formatDate,
  sectionParam,
} from '@domovoy/domain';
import type { NotificationAction } from '@domovoy/app';
import { Keyboard } from '@maxkit/max-bot-api';

import { PROMPTS, SCREENS } from './max.js';
import type { Extra } from './kit.js';

/** Опрос соседа об аварии: два ответа и ни одного поля для ввода. */
export const alertKeyboard = (requestId: string) => ({
  attachments: [
    Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback('🙋 И у меня', `same:${requestId}`),
        Keyboard.button.callback('👌 Всё работает', `fine:${requestId}`),
      ],
    ]),
  ],
});


/** Числа с запятой: «126,5». */
export const decimal = (value: number): string => value.toLocaleString('ru-RU', { maximumFractionDigits: 4 });



/** Ряды оплаты: месяц и долг за прошлые месяцы платят отдельно. */
export const payRows = (month: number | undefined, debt: number | undefined): ButtonRows => [
  ...(month === undefined ? [] : [[Keyboard.button.callback(`💳 За месяц: ${formatMoney(month)}`, 'pay')]]),
  ...(debt === undefined ? [] : [[Keyboard.button.callback(`💰 Долг: ${formatMoney(debt)}`, 'pay-debt')]]),
];

/** Каждая дверь своей кнопкой. */
export const doorKeyboard = (
  devices: readonly { id: string; title: string }[],
  cameras: readonly { id: string; title: string }[] = [],
) => ({
  attachments: [
    Keyboard.inlineKeyboard([
      ...devices.map((device) => [Keyboard.button.callback(`🚪 ${device.title}`, `door:${device.id}`)]),
      ...cameras.map((device) => [Keyboard.button.callback(`📷 ${device.title}`, `camera:${device.id}`)]),
    ]),
  ],
});

/** Обращение в поддержку: ответить можно прямо из уведомления. */
export const supportKeyboard = (ticketId: string) => ({
  attachments: [
    Keyboard.inlineKeyboard([[Keyboard.button.callback('💬 Ответить по обращению', `ticket:${ticketId}`)]]),
  ],
});

/** Ряды кнопок: обычные и открывающие мини-приложение. */
export type ButtonRows = (
  | ReturnType<typeof Keyboard.button.callback>
  | ReturnType<typeof Keyboard.button.openApp>
  | ReturnType<typeof Keyboard.button.link>
)[][];

/** Ссылка на мини-приложение с разделом внутри. */
export const appLink = (miniAppUrl: string, startParam?: string): string =>
  startParam ? `${miniAppUrl}${miniAppUrl.includes('?') ? '&' : '?'}startapp=${startParam}` : miniAppUrl;

/** Роли для проверки: примерка идёт нажатием. */
export const demoKeyboard = (roles: readonly { role: string; title: string; current: boolean }[]) =>
  keyboardOf([
    ...pairs(
      roles.map((item) =>
        Keyboard.button.callback(`${item.current ? '✅' : '👤'} ${item.title}`, `demo:${item.role}`),
      ),
    ),
    [Keyboard.button.callback('🏠 Меню', 'group:back')],
  ]);

/** Свободные часы приёма: день и время на кнопке, по две в ряд. */
export const visitKeyboard = (slots: readonly { at: string; title: string }[]) =>
  keyboardOf([
    ...pairs(slots.map((slot) => Keyboard.button.callback(`🗓 ${slot.title}`, `visit:${slot.at}`))),
    [Keyboard.button.callback('🏠 Меню', 'group:back')],
  ]);

/** Под своей записью на приём: отмена и возврат в меню. */
export const visitCancelKeyboard = (visitId: string) =>
  keyboardOf([
    [Keyboard.button.callback('✖️ Отменить запись', `visit-cancel:${visitId}`)],
    [Keyboard.button.callback('🏠 Меню', 'group:back')],
  ]);

/** Личная переписка: собеседник известен и без контекста сообщения. */
export const PERSONAL = {};

/**
 * Клавиатура из готовых рядов: пустые ряды выбрасываются. Если известно, где
 * идёт разговор, и кнопок не осталось, в переписке остаётся меню.
 */
export const keyboardOf = (rows: ButtonRows, where?: Parameters<typeof menuButton>[0]) => {
  const filled = rows.filter((row) => row.length > 0);

  if (filled.length > 0) return { attachments: [Keyboard.inlineKeyboard(filled)] };

  return where ? menuButton(where) : undefined;
};

/**
 * Ряд с кнопкой приложения. С разделом она открывает приложение сразу на нём,
 * без него, на стартовом экране.
 */
export const appRow = (miniAppUrl: string | undefined, title: string, screen?: string): ButtonRows =>
  miniAppUrl
    ? [
        [
          Keyboard.button.openApp(`📱 ${title}`, appLink(miniAppUrl, screen ? sectionParam(screen) : undefined)),
        ],
      ]
    : [];

/** Кнопки в два столбца: так экран остаётся коротким. */
const pairs = (
  buttons: readonly ReturnType<typeof Keyboard.button.callback>[],
): ReturnType<typeof Keyboard.button.callback>[][] => {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];

  for (let at = 0; at < buttons.length; at += 2) rows.push([...buttons.slice(at, at + 2)]);

  return rows;
};

/** Адресат по адресу: дом, подъезд, стояк и перечисленные квартиры. */
export const guestKeyboard = (deviceId: string) => ({
  attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback('🔑 Код гостю', `guest:${deviceId}`)]])],
});

/** Заявка, по которой ещё есть смысл разговаривать. */
export const replyIfOpen = (request: { id: string; status: string }): string | undefined =>
  OPEN_STATUSES.includes(request.status as never) ? request.id : undefined;

/** Кнопки под уведомлением. `undefined`, если делать нечего. */
export const actionKeyboard = (
  actions: NotificationAction[] = [],
  replyTo?: string,
  assignTo?: string,
  passTo?: string,
) => {
  const buttons = actions.map((action) =>
    Keyboard.button.callback(
      actionTitle(action.from, action.to, action.requiresComment),
      `${action.requiresComment ? 'ask' : 'req'}:${action.requestId}:${action.to}`,
    ),
  );

  return keyboardOf([
    buttons,
    ...(assignTo ? [[Keyboard.button.callback('👷 Назначить', `assign:${assignTo}`)]] : []),
    ...(passTo ? [[Keyboard.button.callback('📨 Передать', `pass:${passTo}`)]] : []),
    ...(replyTo ? [[Keyboard.button.callback('💬 Написать по заявке', `say:${replyTo}`)]] : []),
  ]);
};

/** Уточнение адреса: варианты идут кнопками, номер варианта лежит в payload. */
export const whereKeyboard = (requestId: string, options: readonly { label: string }[]) =>
  keyboardOf([
    ...options.map((option, index) => [Keyboard.button.callback(option.label, `where:${requestId}:${index}`)]),
    [Keyboard.button.callback('✖️ Не уточнять', 'cancel')],
  ]);

/** Кому передать обращение: организации дома по одной кнопке на строку. */
export const passKeyboard = (requestId: string, targets: readonly { to: string; organization: string }[]) =>
  keyboardOf([
    ...targets.map((target) => [
      Keyboard.button.callback(`📨 ${target.organization}`, `pass-to:${requestId}:${target.to}`),
    ]),
    [Keyboard.button.callback('✖️ Отмена', 'cancel')],
  ]);

/** Ответ смежной организации записывают той же кнопкой, что и передали. */
export const handoffKeyboard = (handoffId: string) =>
  keyboardOf([[Keyboard.button.callback('✅ Ответ получен', `handoff:${handoffId}`)]]);

/** Кому показывать «Назначить»: наряд без исполнителя и право его ставить. */
export const assignable = (
  request: { id: string; status: string; assigneeId?: string },
  role: string,
): string | undefined =>
  (role === 'dispatcher' || role === 'manager') &&
  request.assigneeId === undefined &&
  OPEN_STATUSES.includes(request.status as never)
    ? request.id
    : undefined;

/** Кому поручить: наименее загруженные сверху, рядом число открытых нарядов. */
export const assignKeyboard = (
  requestId: string,
  staff: readonly { id: string; displayName: string; role: string; load: number }[],
) =>
  keyboardOf([
    ...staff
      .slice(0, ASSIGNEES_SHOWN)
      .map((person) => [
        Keyboard.button.callback(
          `👷 ${person.displayName} · ${person.load}`,
          `assign:${requestId}:${person.id}`,
        ),
      ]),
    [Keyboard.button.callback('✖️ Отмена', 'cancel')],
  ]);

/** Сколько исполнителей показываем кнопками: остальных выбирают в приложении. */
export const ASSIGNEES_SHOWN = 5;

/** Подписи кнопок перехода. */
export const ACTION_TITLES: Record<string, string> = {
  accepted: '✅ Принять',
  in_progress: '🔧 В работу',
  needs_info: '❓ Уточнить',
  done: '🏁 Выполнена',
  confirmed: '✅ Принять работу',
  rejected: '⛔ Отклонить',
  withdrawn: '↩️ Отозвать заявку',
};

/**
 * Возврат сданной работы жилец видит своими словами, а не словами наряда.
 * Приёмку за жильца делает смена, и у неё это не «принять работу», а закрытие
 * заявки: такой переход требует объяснения, по нему их и различаем.
 */
export const actionTitle = (from: string, to: string, explains = false): string => {
  if (from === 'done' && to === 'in_progress') return '↩️ Вернуть';
  if (from === 'done' && to === 'confirmed' && explains) return '✅ Закрыть заявку';

  return ACTION_TITLES[to] ?? to;
};

/** Следующая страница того же списка. */
export const moreKeyboard = (what: string, offset: number, title = '⬇️ Ещё') => ({
  attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback(title, `more:${what}:${offset}`)]])],
});

/** Заявка соседа: подтвердить, что то же самое. */
export const alsoKeyboard = (requestId: string) => ({
  attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback('🙋 И у меня', `support:${requestId}`)]])],
});

/** Единственное продолжение разговора: одна кнопка под ответом. */
export const oneKeyboard = (title: string, payload: string) => ({
  attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback(title, payload)]])],
});

/** Код или ссылку из сообщения кладут в буфер обмена нажатием. */
export const copyKeyboard = (title: string, payload: string) => ({
  attachments: [Keyboard.inlineKeyboard([[Keyboard.button.clipboard(title, payload)]])],
});

/**
 * Возврат в меню: под ответом, за которым ничего не следует. В общем чате кнопки
 * нет: меню там личное, и в разговор соседей оно не выносится.
 */
export const menuButton = (context?: { message?: { recipient?: { chat_type?: string } } }) => {
  const where = context?.message?.recipient?.chat_type;

  return where === 'chat' || where === 'channel' ? undefined : oneKeyboard('🏠 Меню', 'group:back');
};

/**
 * Текст отказа целой фразой. Внутри продукта причины пишутся без точки, потому
 * что подставляются в строку, а человеку отказ приходит отдельным сообщением.
 */
export const errorText = (error: unknown): string => {
  const said = error instanceof Error ? error.message : String(error);

  return /[.!?…)]$/.test(said) ? said : `${said}.`;
};

/** Кнопка, которой отказ исправляют. Пусто, если исправлять нечем. */
export const errorAction = (error: unknown) =>
  error instanceof DomainError && error.code === 'apartment_not_bound'
    ? oneKeyboard('🏢 Квартира', 'menu:flat')
    : undefined;

/** Куда идти после отказа: непривязанной квартире нужна привязка, остальным меню. */
export const afterError = (error: unknown, context?: Parameters<typeof menuButton>[0]) =>
  errorAction(error) ?? menuButton(context);

/** Под своими данными: отвязка квартиры и удаление профиля. */
export const dataKeyboard = (bound: boolean, context?: Parameters<typeof menuButton>[0]) =>
  keyboardOf(
    [
      [Keyboard.button.callback('📄 Выгрузить мои данные', 'mydata:file')],
      ...(bound ? [[Keyboard.button.callback('🚪 Отвязать квартиру', 'leave:ask')]] : []),
      [Keyboard.button.callback('🗑 Удалить профиль', 'forget:ask')],
      [Keyboard.button.callback('🏠 Меню', 'group:back')],
    ],
    context,
  );

/** Оценка работы при приёмке: пять звёзд и возможность промолчать. */
export const rateKeyboard = (requestId: string): Extra => ({
  attachments: [
    Keyboard.inlineKeyboard([
      [1, 2, 3, 4, 5].map((stars) =>
        Keyboard.button.callback('⭐'.repeat(stars), `rate:${requestId}:${stars}`),
      ),
      [Keyboard.button.callback('Принять без оценки', `rate:${requestId}:0`)],
    ]),
  ],
});

/** Подтверждение того, что не отменить: согласие и отказ. */
export const confirmKeyboard = (title: string, payload: string) => ({
  attachments: [
    Keyboard.inlineKeyboard([
      [Keyboard.button.callback(title, payload), Keyboard.button.callback('✖️ Отмена', 'cancel')],
    ]),
  ],
});

/**
 * Разговор, из которого нужно уметь выйти, не набирая команду. Такой экран
 * помечается подсказкой: он живёт до ответа или отмены и потом убирается.
 */
export const cancelKeyboard = (): Extra => {
  const built = {
    attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback('✖️ Отмена', 'cancel')]])],
  };

  PROMPTS.add(built);
  SCREENS.add(built);

  return built;
};

/** Под вопросом о показании: пропустить прибор или выйти из подачи. */
/**
 * Список счётчиков: каждый своей кнопкой, поданные помечены. Так человек
 * подаёт показание с любого прибора, а не идёт по ним подряд.
 */
export const metersKeyboard = (
  states: readonly { meter: { id: string; kind: string; serial: string }; submittedThisMonth: boolean }[],
): Extra => ({
  attachments: [
    Keyboard.inlineKeyboard(
      states.map((state) => [
        Keyboard.button.callback(
          `${state.submittedThisMonth ? '✅' : '💧'} ${METER_RULES[state.meter.kind as MeterKind].title}`,
          `meter:${state.meter.id}`,
        ),
      ]),
    ),
  ],
});

export const readingKeyboard = (meterId: string, canSkip: boolean) => ({
  attachments: [
    Keyboard.inlineKeyboard([
      [
        ...(canSkip ? [Keyboard.button.callback('⏭ Пропустить', `meter-skip:${meterId}`)] : []),
        Keyboard.button.callback('✖️ Отмена', 'cancel'),
      ],
    ]),
  ],
});

/** Что спросить по счётчику. */
export const readingPrompt = (state: MeterState): string => {
  const rule = METER_RULES[state.meter.kind];
  const previous = state.last
    ? `\nПрошлое показание: ${formatMeterValue(state.last.value)} ${rule.unit} от ${formatDate(state.last.at)}`
    : '';

  return `${rule.title}, счётчик ${state.meter.serial}.${previous}\nОтправьте показание числом.`;
};

/** Привязка по коду квартиры, если код именно от неё. */
export const bindIfApartment = async (deps: AppDeps, resident: Resident, code: string): Promise<BindResult | null> => {
  try {
    return await bindApartment(deps, resident, code);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'code_not_apartment') return null;
    throw error;
  }
};

/** Ряд бюллетеня: три ответа, как в бумажном бланке. */
export const pollRow = (pollId: string): ButtonRows[number] =>
  (['for', 'against', 'abstain'] as const).map((choice) => {
    const title = choiceTitle(choice);
    const mark = choice === 'for' ? '✅' : choice === 'against' ? '❌' : '⚪';

    return Keyboard.button.callback(
      `${mark} ${title.slice(0, 1).toUpperCase()}${title.slice(1)}`,
      `vote:${pollId}:${choice}`,
    );
  });

/** Бюллетень: три кнопки, как в бумажном бланке. */
export const pollKeyboard = (pollId: string) => ({
  attachments: [Keyboard.inlineKeyboard([pollRow(pollId)])],
});

export const flatTitle = (apartment: OwnApartment): string =>
  apartment.address ? `квартира ${apartment.number}, ${apartment.address}` : `квартира ${apartment.number}`;

/** Выбор одной из своих квартир. */
export const flatKeyboard = (own: readonly OwnApartment[]) => ({
  attachments: [
    Keyboard.inlineKeyboard(
      own
        .filter((apartment) => !apartment.current)
        .map((apartment) => {
          const title = flatTitle(apartment);

          return [
            Keyboard.button.callback(
              `🏢 ${title.slice(0, 1).toUpperCase()}${title.slice(1)}`,
              `flat:${apartment.id}`,
            ),
          ];
        }),
    ),
  ],
});

/** Подпись под предложением соседа: одна кнопка. */
export const initiativeKeyboard = (initiativeId: string) => ({
  attachments: [
    Keyboard.inlineKeyboard([[Keyboard.button.callback('🙋 Поддержать', `sign:${initiativeId}`)]]),
  ],
});

export const formatInitiative = (view: InitiativeView): string =>
  `${view.initiative.title}\n${view.initiative.question}\n\n` +
  `${formatDemand(view)}. Подписей: ${view.signatures}.`;

/** О чём спросить, прежде чем выполнить переход. */
export const COMMENT_PROMPTS: Record<string, string> = {
  in_progress: 'Что именно не сделано? Напишите одним сообщением, передам мастеру.',
  needs_info: 'Что нужно уточнить у жильца? Напишите вопрос одним сообщением.',
  rejected: 'Почему заявка отклоняется? Причину увидит жилец.',
  // Мастер сдаёт работу с телефона и на ходу: длинного рассказа от него не ждут.
  done: 'Что сделано? Напишите коротко, отметку увидит жилец.',
  // Заявку за жильца закрывает смена, когда он сказал о приёмке голосом.
  confirmed: 'Кто принял работу? Напишите одним сообщением, запишу в историю заявки.',
};

/** Чем подтверждается написанное: у сдачи это отметка о работе, а не причина. */
export const COMMENT_DONE: Record<string, string> = {
  done: 'Отметку увидит жилец.',
  confirmed: 'Записал в историю заявки.',
};

