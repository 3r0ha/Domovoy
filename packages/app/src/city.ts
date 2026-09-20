import { type RequestCategory } from '@domovoy/domain';

import type { Announcement, Building } from './repository.js';
import { announceToHouse } from './use-cases/announcements.js';
import type { AppDeps } from './use-cases.js';
import { formatMomentAt, houseZone } from './zone.js';

/**
 * Отключения по данным города: воду, свет, тепло и газ отключают ресурсники,
 * и город публикует это раньше, чем узнаёт управляющая организация. У каждого
 * города свой портал и свой формат, поэтому продукт знает один общий вид
 * события, а перевод из городского формата делает адаптер за портом.
 */
export type OutageResource = 'cold_water' | 'hot_water' | 'electricity' | 'heating' | 'gas';

export interface CityOutage {
  /** Идентификатор события у источника: по нему одно отключение не объявляется дважды. */
  id: string;
  resource: OutageResource;
  /** Причина словами источника. */
  reason?: string;
  from: Date;
  until: Date;
  /** Затронутые дома адресной строкой: город, улица, дом. */
  addresses: string[];
  /** Кто отключает: ресурсник или подрядчик. */
  by?: string;
}

export interface CityFeed {
  /** Как источник называется человеку. */
  readonly title: string;
  /** Подключение модельное: данные типовые, обмена с городом за ними нет. */
  readonly model: boolean;
  /** Действующие и предстоящие отключения. */
  outages(): Promise<CityOutage[]>;
}

export const OUTAGE_TITLES: Record<OutageResource, string> = {
  cold_water: 'Отключение холодной воды',
  hot_water: 'Отключение горячей воды',
  electricity: 'Отключение электричества',
  heating: 'Отключение отопления',
  gas: 'Отключение газа',
};

const OUTAGE_RESOURCES: readonly OutageResource[] = ['cold_water', 'hot_water', 'electricity', 'heating', 'gas'];

/** Категория заявки, которую такое отключение объясняет. */
export const outageCategory = (resource: OutageResource): RequestCategory => {
  if (resource === 'cold_water' || resource === 'hot_water') return 'plumbing';
  if (resource === 'electricity') return 'electricity';
  if (resource === 'heating') return 'heating';

  return 'other';
};

/** Слова, которые в адресе ничего не различают: тип улицы и тип строения. */
const NOISE =
  /(?<![\p{L}\d])(г|гор|город|ул|улица|пр|просп|проспект|пер|переулок|б-р|бульвар|ш|шоссе|пл|площадь|тер|д|дом|к|корп|корпус|стр|строение)(?![\p{L}\d])/gu;

/**
 * Адрес к виду для сравнения: без типов улиц и строений, без знаков, в одном
 * регистре. «г Казань, ул Ленина, д 15 к 2» и «ул. Ленина, 15, корп. 2»
 * становятся одной строкой.
 */
export const normalizeAddress = (text: string): string =>
  text
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[.,;:()«»"']/gu, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

/** Совпадает ли адрес из города с адресом дома: город в карточке дома может быть не записан. */
export const sameHouse = (buildingAddress: string, cityAddress: string): boolean => {
  const own = normalizeAddress(buildingAddress);
  const city = normalizeAddress(cityAddress);

  if (!own || !city) return false;

  return city === own || city.endsWith(` ${own}`);
};

/** Дома установки, которых касается отключение. */
export const affectedBuildings = (outage: CityOutage, buildings: readonly Building[]): Building[] =>
  buildings.filter((building) => outage.addresses.some((address) => sameHouse(building.address, address)));

const describeOutage = (feed: CityFeed, outage: CityOutage, zone: string | undefined): string => {
  const when = `с ${formatMomentAt(outage.from, zone)} до ${formatMomentAt(outage.until, zone)}`;
  const who = outage.by ? ` Работы ведёт ${outage.by}.` : '';
  const why = outage.reason ? `${outage.reason}. ` : '';

  return `${why}Отключение ${when}.${who} По данным: ${feed.title}.`;
};

/** Ключ объявленного отключения: одно событие на один дом. */
const keyOf = (outage: CityOutage, buildingId: string): string => `${outage.id}:${buildingId}`;

/** Сколько дней помнить объявленное после его окончания. */
const REMEMBER_DAYS = 7;

export interface OutageImport {
  created: Announcement[];
  /** Что уже объявлено: ключ события и дома, момент окончания. */
  seen: Record<string, string>;
}

/**
 * Отключения города становятся объявлениями о плановых работах: жильцы
 * получают сообщение, а обращение «нет воды» в эти часы получает срок вместо
 * заявки. Каждое событие объявляется дому один раз.
 */
export const importOutages = async (deps: AppDeps, seen: Record<string, string> = {}): Promise<OutageImport> => {
  const feed = deps.city;
  const created: Announcement[] = [];
  const now = deps.now();
  const forget = now.getTime() - REMEMBER_DAYS * 24 * 60 * 60 * 1000;
  const kept: Record<string, string> = Object.fromEntries(
    Object.entries(seen).filter(([, until]) => new Date(until).getTime() > forget),
  );

  if (!feed) return { created, seen: kept };

  const buildings = await deps.repository.listBuildings();

  for (const outage of await feed.outages()) {
    if (outage.until.getTime() < now.getTime()) continue;

    for (const building of affectedBuildings(outage, buildings)) {
      const key = keyOf(outage, building.id);

      if (kept[key]) continue;

      const { announcement } = await announceToHouse(deps, {
        buildingId: building.id,
        title: OUTAGE_TITLES[outage.resource],
        body: describeOutage(feed, outage, await houseZone(deps, building.id)),
        works: {
          category: outageCategory(outage.resource),
          from: outage.from,
          until: outage.until,
          resource: outage.resource,
        },
      });

      created.push(announcement);
      kept[key] = outage.until.toISOString();
    }
  }

  return { created, seen: kept };
};

export interface MockCityFeedOptions {
  title?: string;
  /** Адреса домов, которым отключение показывают. */
  addresses: () => Promise<string[]>;
  now: () => Date;
}

/** Модельный источник: завтра с утра по первому дому нет горячей воды. */
export const createMockCityFeed = (options: MockCityFeedOptions): CityFeed => ({
  title: options.title ?? 'Портал города',
  model: true,
  async outages() {
    const [first] = await options.addresses();

    if (!first) return [];

    const tomorrow = new Date(options.now());

    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(6, 0, 0, 0);

    return [
      {
        id: `mock-${tomorrow.toISOString().slice(0, 10)}`,
        resource: 'hot_water',
        reason: 'Ремонтные работы на тепловой сети',
        from: tomorrow,
        until: new Date(tomorrow.getTime() + 9 * 60 * 60 * 1000),
        addresses: [first],
        by: 'Теплосеть',
      },
    ];
  },
});

export interface HttpCityFeedOptions {
  /** Адрес, который отдаёт список отключений в формате продукта. */
  url: string;
  /** Ключ доступа, если источник его требует: уходит заголовком Authorization. */
  key?: string;
  title?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  onError?: (error: unknown) => void;
}

const FEED_TIMEOUT_MS = 15_000;

const dateOf = (value: unknown): Date | undefined => {
  if (typeof value !== 'string') return undefined;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const isResource = (value: unknown): value is OutageResource =>
  typeof value === 'string' && (OUTAGE_RESOURCES as readonly string[]).includes(value);

/** Одно событие из ответа источника: кривое пропускается, а не роняет весь список. */
export const parseOutage = (item: unknown): CityOutage | undefined => {
  if (typeof item !== 'object' || item === null) return undefined;

  const raw = item as Record<string, unknown>;
  const from = dateOf(raw['from']);
  const until = dateOf(raw['until']);
  const id = typeof raw['id'] === 'string' || typeof raw['id'] === 'number' ? String(raw['id']) : undefined;
  const addresses = Array.isArray(raw['addresses'])
    ? raw['addresses'].filter((address): address is string => typeof address === 'string' && address.trim() !== '')
    : [];

  if (!id || !from || !until || !isResource(raw['resource']) || addresses.length === 0) return undefined;

  return {
    id,
    resource: raw['resource'],
    from,
    until,
    addresses,
    ...(typeof raw['reason'] === 'string' && raw['reason'].trim() ? { reason: raw['reason'].trim() } : {}),
    ...(typeof raw['by'] === 'string' && raw['by'].trim() ? { by: raw['by'].trim() } : {}),
  };
};

/**
 * Источник по адресу: любой город или интегратор отдаёт список в формате
 * продукта, а перевод из своего формата держит у себя. Ответ: массив событий
 * либо объект с полем `items`.
 */
export const createHttpCityFeed = (options: HttpCityFeedOptions): CityFeed => {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? FEED_TIMEOUT_MS;

  return {
    title: options.title ?? 'Портал города',
    model: false,
    async outages() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await doFetch(options.url, {
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            ...(options.key ? { authorization: `Bearer ${options.key}` } : {}),
          },
        });

        if (!response.ok) throw new Error(`Источник отключений ответил ${response.status}`);

        const body = (await response.json()) as unknown;
        const items = Array.isArray(body)
          ? body
          : typeof body === 'object' && body !== null && Array.isArray((body as { items?: unknown }).items)
            ? ((body as { items: unknown[] }).items)
            : [];

        return items.map(parseOutage).filter((outage): outage is CityOutage => outage !== undefined);
      } catch (error) {
        options.onError?.(error);

        return [];
      } finally {
        clearTimeout(timer);
      }
    },
  };
};
