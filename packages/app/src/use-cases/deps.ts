import type { PaymentGateway } from '../billing.js';
import type { DeviceHub } from '../devices.js';
import type { HandoffGateway } from '../handoff.js';
import type { CapitalRepairDirectory } from '../capital.js';
import type { MeetingRegistry } from '../meetings.js';
import type { Notifier } from '../notifier.js';
import type { Reasoner } from '../reasoner.js';
import type { Repository } from '../repository.js';
import type { StickerRenderer } from '../stickers.js';

/** Зависимости прикладного слоя. */
export interface AppDeps {
  repository: Repository;
  now: () => Date;
  createId: () => string;
  /** Источник кодов квартир. Без него код выводится из `createId`. */
  createCode?: () => string;
  /** Дом по умолчанию, пока жилец не привязан к квартире. */
  defaultBuildingId: string;
  /** Куда уходят уведомления. По умолчанию никуда: API может работать без бота. */
  notifier?: Notifier;
  /** Взаимное исключение между репликами. */
  lock?: Lock;
  /** Домофоны и камеры. Продукт работает и без них. */
  hub?: DeviceHub;
  /** Платёжный шлюз. Без него квитанция показывается, но оплатить нельзя. */
  payments?: PaymentGateway;
  /** Разбор обращения моделью. Без него категорию подсказывают ключевые слова. */
  reasoner?: Reasoner;
  /** Имя бота: из него собираются ссылки наклеек. */
  botName?: string;
  /** Рисование наклеек. Без него коды объектов только перечисляются. */
  stickers?: StickerRenderer;
  /** Канал передачи обращений смежным организациям. Без него передача идёт вручную. */
  handoffs?: HandoffGateway;
  /** Система собраний собственников. Без неё собрание остаётся опросом жильцов. */
  meetings?: MeetingRegistry;
  /** Сведения о капитальном ремонте. Без них раздел не показывается. */
  capitalRepair?: CapitalRepairDirectory;
}

/** Блокировка по ключу на время работы. */
export type Lock = <T>(key: string, run: () => Promise<T>) => Promise<T>;

/** Сколько отдавать за раз в списках, которые растут годами. */
export interface RequestPage {
  /** Сколько отдать за раз. */
  limit?: number;
  /** Дочитать то, что старше этого момента. */
  before?: Date;
}
