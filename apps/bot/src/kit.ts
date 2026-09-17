import type { AppDeps, Building, MeterVision, Resident, SubmitResult, Transcriber } from '@domovoy/app';
import type { Bot } from '@maxkit/max-bot-api';

import type { BotContext } from './max.js';

/** Дополнение к сообщению: клавиатура и вложения, как их принимает клиент. */
export type Extra = Record<string, unknown>;

export type Handler = (typed: BotContext) => Promise<void>;

/** Общее для команд и кнопок: зависимости и то, что делают все обработчики. */
export interface BotKit {
  bot: Bot;
  deps: AppDeps;
  /** Кнопка «Открыть приложение», а без адреса приложения, кнопка меню. */
  openApp: (startParam?: string, context?: BotContext) => Extra | undefined;
  /** Адрес мини-приложения: из него собирается кнопка перехода в нужный раздел. */
  miniAppUrl?: string;
  /** Адрес сайта: по нему открываются документы продукта. */
  siteUrl?: string;
  /** Кто говорит. Новый человек заводится при первом обращении. */
  residentOf: (typed: BotContext, buildingId?: string) => Promise<Resident>;
  /** Дом, которому принадлежит этот чат. */
  houseOf: (typed: BotContext) => Promise<Building | undefined>;
  /** Меню под роль: те же действия, что у команд, но нажатием. */
  menuKeyboard: (resident: Resident) => Extra;
  /** Что бот умеет в общем чате дома. */
  chatHelp: (building?: Building) => string;
  /** Режим проверки: роль примеряется прямо в переписке. */
  demo?: boolean;
  /** Расшифровка голосовых. Без неё голосовое остаётся вложением без текста. */
  transcriber?: Transcriber;
  /** Показание с фотографии табло. Без него его вводят цифрами. */
  vision?: MeterVision;
  /** Вопрос о доме получает ответ вместо заявки. Возвращает true, если ответил. */
  answered: (typed: BotContext, resident: Resident, description: string, startParam?: string) => Promise<boolean>;
  /** Что жилец узнаёт в ответ на своё обращение. */
  announce: (
    typed: BotContext,
    result: SubmitResult,
    description: string,
    startParam?: string,
    unheard?: boolean,
  ) => Promise<void>;
  /** Выполнить команду по имени: кнопка меню и команда делают одно и то же.
   * Возвращает false, если команды с таким именем нет. */
  run: (name: string, typed: BotContext) => Promise<boolean>;
}
