import {
  bindApartment,
  choiceTitle,
  errorTextFor,
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
  meterKindKey,
  meterUnitKey,
  OPEN_STATUSES,
  formatDate,
  sectionParam,
} from '@domovoy/domain';
import type { NotificationAction } from '@domovoy/app';
import { numberIn, type Translate } from '@domovoy/i18n';
import { Keyboard } from '@maxkit/max-bot-api';

import { RU } from './i18n.js';
import { PROMPTS, ROOT_MENUS, SCREENS } from './max.js';
import type { Extra } from './kit.js';

/**
 * Экран разговора: меню, список, подтверждение. Такие сообщения живут по
 * одному, прежнее убирается, когда появился новый. Чек заявки и код гостя
 * экранами не помечаются: их из переписки стирать нельзя.
 */
export const screenOf = <T>(extra: T): T => {
  if (extra && typeof extra === 'object') SCREENS.add(extra);

  return extra;
};

/** Опрос соседа об аварии: два ответа и ни одного поля для ввода. */
export const alertKeyboard = (requestId: string, t: Translate = RU) => ({
  attachments: [
    Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback(t('button.also_me'), `same:${requestId}`),
        Keyboard.button.callback(t('button.works'), `fine:${requestId}`),
      ],
    ]),
  ],
});


/** Число с разделителем своего языка: «126,5», «126.5». */
export const decimal = (value: number, t: Translate = RU): string =>
  numberIn(t, value, { maximumFractionDigits: 4 });



/** Ряды оплаты: месяц и долг за прошлые месяцы платят отдельно. */
export const payRows = (month: number | undefined, debt: number | undefined, t: Translate = RU): ButtonRows => [
  ...(month === undefined
    ? []
    : [[Keyboard.button.callback(t('button.pay_month', { сумма: formatMoney(month, t) }), 'pay')]]),
  ...(debt === undefined
    ? []
    : [[Keyboard.button.callback(t('button.pay_debt', { сумма: formatMoney(debt, t) }), 'pay-debt')]]),
];

/** Каждая дверь своей кнопкой. */
export const doorKeyboard = (
  devices: readonly { id: string; title: string }[],
  cameras: readonly { id: string; title: string }[] = [],
  guestFor?: string,
  t: Translate = RU,
) => ({
  attachments: [
    Keyboard.inlineKeyboard([
      ...devices.map((device) => [Keyboard.button.callback(`🚪 ${device.title}`, `door:${device.id}`)]),
      ...cameras.map((device) => [Keyboard.button.callback(`📷 ${device.title}`, `camera:${device.id}`)]),
      // Список дверей остаётся и после открытия: нажали не ту, открывают рядом.
      ...(guestFor ? [[Keyboard.button.callback(t('button.guest_code'), `guest:${guestFor}`)]] : []),
    ]),
  ],
});

/** Обращение в поддержку: ответить можно прямо из уведомления. */
export const supportKeyboard = (ticketId: string, t: Translate = RU) => ({
  attachments: [
    Keyboard.inlineKeyboard([[Keyboard.button.callback(t('button.answer_ticket'), `ticket:${ticketId}`)]]),
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
    [Keyboard.button.callback(RU('button.menu'), 'group:back')],
  ]);

/** Свободные часы приёма: день и время на кнопке, по две в ряд. */
export const visitKeyboard = (
  slots: readonly { at: string; title: string }[],
  miniAppUrl?: string,
  t: Translate = RU,
) =>
  keyboardOf([
    ...pairs(slots.map((slot) => Keyboard.button.callback(`🗓 ${slot.title}`, `visit:${slot.at}`))),
    // Остальные дни открываются календарём: кнопками их два десятка.
    ...appRow(miniAppUrl, t('button.other_days'), 'visits'),
    [Keyboard.button.callback(t('button.menu'), 'group:back')],
  ]);

/** Под своей записью на приём: отмена и возврат в меню. */
export const visitCancelKeyboard = (visitId: string, t: Translate = RU) =>
  keyboardOf([
    [Keyboard.button.callback(t('button.cancel_visit'), `visit-cancel:${visitId}`)],
    [Keyboard.button.callback(t('button.menu'), 'group:back')],
  ]);

/** Личная переписка: собеседник известен и без контекста сообщения. */
export const PERSONAL = {};

/**
 * Клавиатура из готовых рядов: пустые ряды выбрасываются. Если известно, где
 * идёт разговор, и кнопок не осталось, в переписке остаётся меню.
 */
export const keyboardOf = (rows: ButtonRows, where?: Parameters<typeof menuButton>[0], t: Translate = RU) => {
  const filled = rows.filter((row) => row.length > 0);

  if (filled.length > 0) return { attachments: [Keyboard.inlineKeyboard(filled)] };

  return where ? menuButton(where, t) : undefined;
};

/**
 * Ряд с кнопкой приложения. Раздел уходит в ссылку параметром запуска, но
 * подпись его не обещает: клиент MAX открывает приложение на стартовом экране,
 * и подпись «Квитанция в приложении» оказывалась неправдой. Сам раздел назван
 * в сообщении над кнопкой.
 */
export const appRow = (
  miniAppUrl: string | undefined,
  title: string,
  screen?: string,
  t: Translate = RU,
): ButtonRows => {
  void title;

  return miniAppUrl
    ? [
        [
          Keyboard.button.openApp(
            t('button.open_app'),
            appLink(miniAppUrl, screen ? sectionParam(screen) : undefined),
          ),
        ],
      ]
    : [];
};

/** Кнопки в два столбца: так экран остаётся коротким. */
const pairs = (
  buttons: readonly ReturnType<typeof Keyboard.button.callback>[],
): ReturnType<typeof Keyboard.button.callback>[][] => {
  const rows: ReturnType<typeof Keyboard.button.callback>[][] = [];

  for (let at = 0; at < buttons.length; at += 2) rows.push([...buttons.slice(at, at + 2)]);

  return rows;
};

/** Адресат по адресу: дом, подъезд, стояк и перечисленные квартиры. */
export const guestKeyboard = (deviceId: string, t: Translate = RU) => ({
  attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback(t('button.guest_code'), `guest:${deviceId}`)]])],
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
  t: Translate = RU,
) => {
  const buttons = actions.map((action) =>
    Keyboard.button.callback(
      actionTitle(action.from, action.to, action.requiresComment, t),
      `${action.requiresComment ? 'ask' : 'req'}:${action.requestId}:${action.to}`,
    ),
  );

  return keyboardOf([
    buttons,
    ...(assignTo ? [[Keyboard.button.callback('👷 Назначить', `assign:${assignTo}`)]] : []),
    ...(passTo ? [[Keyboard.button.callback('📨 Передать', `pass:${passTo}`)]] : []),
    ...(replyTo ? [[Keyboard.button.callback(t('button.reply_request'), `say:${replyTo}`)]] : []),
  ]);
};

/** Уточнение адреса: варианты идут кнопками, номер варианта лежит в payload. */
export const whereKeyboard = (requestId: string, options: readonly { label: string }[], t: Translate = RU) => {
  const built = keyboardOf([
    ...options.map((option, index) => [Keyboard.button.callback(option.label, `where:${requestId}:${index}`)]),
    // Не «Отмена»: заявка уже принята, и отменой человек читает отказ от неё.
    [Keyboard.button.callback(t('button.where_unknown'), `where:${requestId}:skip`)],
  ]);

  // Выход здесь свой: без пометки к нему дописывались бы ещё «Назад» и «Меню»,
  // и под вопросом «где именно» стояли бы три похожих выхода.
  if (built) ROOT_MENUS.add(built);

  return built;
};

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
  miniAppUrl?: string,
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
    // Шестого и дальше выбирают в очереди: кнопками они не помещаются.
    ...(staff.length > ASSIGNEES_SHOWN ? appRow(miniAppUrl, 'Вся смена в приложении', 'queue') : []),
    [Keyboard.button.callback('✖️ Отмена', 'cancel')],
  ]);

/** Сколько исполнителей показываем кнопками: остальных выбирают в приложении. */
export const ASSIGNEES_SHOWN = 5;

/** Подписи кнопок перехода. */
export const ACTION_TITLES: Record<string, string> = {
  accepted: 'action.accepted',
  in_progress: 'action.in_progress',
  needs_info: 'action.needs_info',
  done: 'action.done',
  confirmed: 'action.confirmed',
  rejected: 'action.rejected',
  withdrawn: 'action.withdrawn',
};

/**
 * Возврат сданной работы жилец видит своими словами, а не словами наряда.
 * Приёмку за жильца делает смена, и у неё это не «принять работу», а закрытие
 * заявки: такой переход требует объяснения, по нему их и различаем. Ответ на
 * уточняющий вопрос тоже подписан по-разному: жилец отвечает, смена возвращает
 * наряд в работу.
 */
export const actionTitle = (from: string, to: string, explains = false, t: Translate = RU): string => {
  if (from === 'done' && to === 'in_progress') return t('action.return');
  if (from === 'done' && to === 'confirmed' && explains) return t('action.close');
  // Заявка ждёт ответа жильца: «В работу» на этой кнопке не говорит ему ничего.
  if (from === 'needs_info' && to === 'in_progress') return t('action.answer');

  const key = ACTION_TITLES[to];

  return key ? t(key) : to;
};

/** Следующая страница того же списка. */
export const moreKeyboard = (what: string, offset: number, title = RU('button.more')) => ({
  attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback(title, `more:${what}:${offset}`)]])],
});

/** Заявка соседа: подтвердить, что то же самое. */
export const alsoKeyboard = (requestId: string, t: Translate = RU) => ({
  attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback(t('button.also_me'), `support:${requestId}`)]])],
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
export const menuButton = (
  context?: { message?: { recipient?: { chat_type?: string } } },
  t: Translate = RU,
) => {
  const where = context?.message?.recipient?.chat_type;

  return where === 'chat' || where === 'channel' ? undefined : oneKeyboard(t('button.menu'), 'group:back');
};

/**
 * Текст отказа целой фразой. Внутри продукта причины пишутся без точки, потому
 * что подставляются в строку, а человеку отказ приходит отдельным сообщением.
 */
export const errorText = (error: unknown, t: Translate = RU): string => {
  const said = errorTextFor(t, error);

  return /[.!?…)]$/.test(said) ? said : `${said}.`;
};

/** Кнопка, которой отказ исправляют. Пусто, если исправлять нечем. */
export const errorAction = (error: unknown, t: Translate = RU) =>
  error instanceof DomainError && error.code === 'apartment_not_bound'
    ? oneKeyboard(t('button.flat'), 'menu:flat')
    : undefined;

/** Куда идти после отказа: непривязанной квартире нужна привязка, остальным меню. */
export const afterError = (error: unknown, context?: Parameters<typeof menuButton>[0], t: Translate = RU) =>
  errorAction(error, t) ?? menuButton(context, t);

/** Под своими данными: отвязка квартиры и удаление профиля. */
export const dataKeyboard = (
  bound: boolean,
  context?: Parameters<typeof menuButton>[0],
  t: Translate = RU,
) =>
  screenOf(keyboardOf(
    [
      [Keyboard.button.callback(t('button.export'), 'mydata:file')],
      // Настройка уведомлений живёт здесь же по смыслу: «отпишите меня от
      // уведомлений» приводило на этот экран, а выключателя на нём не было.
      [Keyboard.button.callback(t('button.notices'), 'app:notices')],
      ...(bound ? [[Keyboard.button.callback(t('button.unbind'), 'leave:ask')]] : []),
      [Keyboard.button.callback(t('button.forget'), 'forget:ask')],
      [Keyboard.button.callback(t('button.menu'), 'group:back')],
    ],
    context,
    t,
  ));

/** Оценка работы при приёмке: пять звёзд и возможность промолчать. */
export const rateKeyboard = (requestId: string, t: Translate = RU): Extra => ({
  attachments: [
    Keyboard.inlineKeyboard([
      // Пять звёзд в один ряд сжимаются до нечитаемых: цифра рядом со значком
      // понятнее, чем ряд из одинаковых картинок разной длины.
      [1, 2, 3].map((stars) => Keyboard.button.callback(`${stars} ⭐`, `rate:${requestId}:${stars}`)),
      [4, 5].map((stars) => Keyboard.button.callback(`${stars} ⭐`, `rate:${requestId}:${stars}`)),
      [Keyboard.button.callback(t('button.rate_none'), `rate:${requestId}:0`)],
    ]),
  ],
});

/** Подтверждение того, что не отменить: согласие и отказ. */
export const confirmKeyboard = (title: string, payload: string, t: Translate = RU) =>
  screenOf({
    attachments: [
      Keyboard.inlineKeyboard([
        [Keyboard.button.callback(title, payload), Keyboard.button.callback(t('button.cancel'), 'cancel')],
      ]),
    ],
  });

/**
 * Разговор, из которого нужно уметь выйти, не набирая команду. Такой экран
 * помечается подсказкой: он живёт до ответа или отмены и потом убирается.
 */
export const cancelKeyboard = (t: Translate = RU): Extra => {
  const built = {
    attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback(t('button.cancel'), 'cancel')]])],
  };

  PROMPTS.add(built);
  SCREENS.add(built);

  return built;
};

/**
 * Начало разговора: готовые вопросы кнопками. Человеку, который не знает, что
 * спросить, проще нажать пример, чем придумывать формулировку.
 */
export const startersKeyboard = (starters: readonly string[], t: Translate = RU): Extra => {
  const built = {
    attachments: [
      Keyboard.inlineKeyboard([
        ...starters.slice(0, 3).map((_, at) => [Keyboard.button.callback(starters[at]!, `starter:${at}`)]),
        [Keyboard.button.callback(t('button.cancel'), 'cancel')],
      ]),
    ],
  };

  PROMPTS.add(built);
  SCREENS.add(built);

  return built;
};

/**
 * Разговор с помощником: под ответом стоит переход в названный раздел и выход.
 * Пока выход не нажали, следующее сообщение человека это следующий вопрос, и
 * снова нажимать «Спросить» не нужно.
 */
export const talkKeyboard = (
  section?: { title: string; command: string },
  t: Translate = RU,
  language?: { title: string; code: string },
): Extra => {
  const built = {
    attachments: [
      Keyboard.inlineKeyboard([
        ...(section ? [[Keyboard.button.callback(section.title, `menu:${section.command}`)]] : []),
        ...(language ? [[Keyboard.button.callback(language.title, `lang:${language.code}`)]] : []),
        [Keyboard.button.callback(t('button.end_talk'), 'talk:stop')],
        [Keyboard.button.callback(t('button.menu'), 'group:back')],
      ]),
    ],
  };

  // Ответ помощника не подсказка: вопросы и ответы остаются в переписке, иначе
  // разговор стирает сам себя и читать его будет нечего.
  ROOT_MENUS.add(built);

  return built;
};

/** Под вопросом о показании: пропустить прибор или выйти из подачи. */
/**
 * Список счётчиков: каждый своей кнопкой, поданные помечены. Так человек
 * подаёт показание с любого прибора, а не идёт по ним подряд.
 */
/**
 * Тот же выбор прибора, но число уже названо: нажатие сразу подаёт показание.
 * Так человек не набирает его второй раз, а продукт не решает за него, чей
 * это счётчик.
 */
export const metersForValueKeyboard = (
  states: readonly { meter: { id: string; kind: string } }[],
  value: number,
  t: Translate = RU,
): Extra =>
  screenOf({
    attachments: [
      Keyboard.inlineKeyboard(
        states.map((state) => [
          Keyboard.button.callback(
            `💧 ${t(meterKindKey(state.meter.kind as MeterKind))}`,
            `meter-read:${state.meter.id}:${value}`,
          ),
        ]),
      ),
    ],
  });

export const metersKeyboard = (
  states: readonly { meter: { id: string; kind: string; serial: string }; submittedThisMonth: boolean }[],
  t: Translate = RU,
): Extra =>
  screenOf({
    attachments: [
      Keyboard.inlineKeyboard(
        states.map((state) => [
          Keyboard.button.callback(
            `${state.submittedThisMonth ? '✅' : '💧'} ${t(meterKindKey(state.meter.kind as MeterKind))}`,
            `meter:${state.meter.id}`,
          ),
        ]),
      ),
    ],
  });

export const readingKeyboard = (meterId: string, canSkip: boolean, t: Translate = RU) => ({
  attachments: [
    Keyboard.inlineKeyboard([
      [
        ...(canSkip ? [Keyboard.button.callback(t('button.skip_meter'), `meter-skip:${meterId}`)] : []),
        Keyboard.button.callback(t('button.cancel'), 'cancel'),
      ],
      // Список приборов показывали экраном раньше: без этой кнопки к нему
      // не вернуться, а отмена уводит из счётчиков совсем.
      [Keyboard.button.callback(t('button.to_meters'), 'menu:meters')],
    ]),
  ],
});

/** Что спросить по счётчику. */
export const readingPrompt = (state: MeterState, t: Translate = RU): string => {
  const unit = t(meterUnitKey(state.meter.kind));
  const previous = state.last
    ? `\n${t('meters.previous', {
        значение: `${formatMeterValue(state.last.value, t)} ${unit}`,
        дата: formatDate(state.last.at, undefined, t),
      })}`
    : '';

  const прибор = t(meterKindKey(state.meter.kind));

  return `${t('meters.prompt', { прибор, номер: state.meter.serial })}${previous}\n${t('meters.send_number')}`;
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
export const pollRow = (pollId: string, t: Translate = RU): ButtonRows[number] =>
  (['for', 'against', 'abstain'] as const).map((choice) => {
    // «Воздержался» на кнопке человек читает как отказ от голосования вообще:
    // в протоколе слово остаётся прежним, а на кнопке говорится просто.
    const title = choice === 'abstain' ? t('vote.abstain') : choiceTitle(t, choice);
    const mark = choice === 'for' ? '✅' : choice === 'against' ? '❌' : '⚪';

    return Keyboard.button.callback(
      `${mark} ${title.slice(0, 1).toUpperCase()}${title.slice(1)}`,
      `vote:${pollId}:${choice}`,
    );
  });

/** Бюллетень: три кнопки, как в бумажном бланке. */
export const pollKeyboard = (pollId: string, t: Translate = RU) => ({
  attachments: [Keyboard.inlineKeyboard([pollRow(pollId, t)])],
});

export const flatTitle = (apartment: OwnApartment, t: Translate = RU): string =>
  apartment.address
    ? t('flat.title_address', { номер: apartment.number, адрес: apartment.address })
    : t('flat.title', { номер: apartment.number });

/** Выбор одной из своих квартир. */
export const flatKeyboard = (own: readonly OwnApartment[], t: Translate = RU) =>
  screenOf({
  attachments: [
    Keyboard.inlineKeyboard([
      ...own
        .filter((apartment) => !apartment.current)
        .map((apartment) => {
          const title = flatTitle(apartment, t);

          return [
            Keyboard.button.callback(
              `🏢 ${title.slice(0, 1).toUpperCase()}${title.slice(1)}`,
              `flat:${apartment.id}`,
            ),
          ];
        }),
      // Квартиру могли привязать по чужому коду: отсюда это и исправляют.
      [Keyboard.button.callback(t('button.unbind'), 'leave:ask')],
    ]),
  ],
  });

/** Подпись под предложением соседа: одна кнопка. */
export const initiativeKeyboard = (initiativeId: string, t: Translate = RU) => ({
  attachments: [
    Keyboard.inlineKeyboard([[Keyboard.button.callback(t('button.sign'), `sign:${initiativeId}`)]]),
  ],
});

export const formatInitiative = (view: InitiativeView, t: Translate = RU): string =>
  `${view.initiative.title}\n${view.initiative.question}\n\n` +
  `${formatDemand(t, view)}. ${t('app.initiative.signatures', { сколько: view.signatures })}`;

/** О чём спросить, прежде чем выполнить переход. */
export const COMMENT_PROMPTS: Record<string, string> = {
  in_progress: 'comment.in_progress',
  needs_info: 'comment.needs_info',
  rejected: 'comment.rejected',
  // Мастер сдаёт работу с телефона и на ходу: длинного рассказа от него не ждут.
  done: 'comment.done',
  // Заявку за жильца закрывает смена, когда он сказал о приёмке голосом.
  confirmed: 'comment.confirmed',
};

/** Чем подтверждается написанное: у сдачи это отметка о работе, а не причина. */
export const COMMENT_DONE: Record<string, string> = {
  done: 'Отметку увидит жилец.',
  confirmed: 'Записал в историю заявки.',
};
