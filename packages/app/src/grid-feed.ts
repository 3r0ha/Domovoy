import { normalizeAddress, sameHouse, type CityFeed, type CityOutage } from './city.js';

/**
 * Отключения электричества от сетевой организации. Источник первичный: это тот,
 * кто отключает, а не агрегатор его публикаций. Ответ приходит готовым JSON,
 * разбирать разметку не нужно.
 *
 * Спрашивают по каждому дому установки и только про ближайшие дни: по одной
 * Казани служба держит девять тысяч записей, и выкачивать их ради одного дома
 * незачем ни нам, ни ей.
 */
export interface GridFeedOptions {
  /** Адрес службы вида `https://pdo.gridcom-rt.ru/api/Ajax/GetInterruptions`. */
  url: string;
  /** Как источник называется человеку в объявлении. */
  title: string;
  /** Кто отключает: подпись «работы ведёт». */
  by?: string;
  /** Адреса домов установки: по каждому задаётся свой запрос. */
  addresses: () => Promise<string[]>;
  /** На сколько дней вперёд спрашивать. */
  days?: number;
  now?: () => Date;
  fetch?: typeof fetch;
  timeoutMs?: number;
  onError?: (error: unknown) => void;
}

const TIMEOUT_MS = 15_000;

/** Больше сотни служба на страницу не отдаёт, сколько ни проси. */
const PAGE_SIZE = 100;

/** Сколько страниц читаем на один дом: улица с сотнями записей не должна затянуть обход. */
const MAX_PAGES = 5;

const DAYS_AHEAD = 7;

/**
 * На сколько дней окно сдвигается назад. Служба сравнивает начало работ со
 * своей датой, и отключение, начавшееся сегодня в полночь по Казани, по её
 * счёту относится ко вчера и в окно с сегодняшнего дня не попадает. Идущие
 * сейчас работы важнее всего, поэтому спрашивают с запасом, а законченное
 * отбрасывают у себя.
 */
const DAYS_BACK = 2;

/** Строка ответа службы. */
interface GridRow {
  Address?: unknown;
  From_?: unknown;
  To_?: unknown;
  Description?: unknown;
  Condition?: unknown;
}

const modelOf = (body: unknown): { rows: GridRow[]; total: number } => {
  if (typeof body !== 'object' || body === null) return { rows: [], total: 0 };

  const model = (body as { Model?: unknown }).Model;

  if (typeof model !== 'object' || model === null) return { rows: [], total: 0 };

  const list = (model as { AllDataModel?: unknown }).AllDataModel;
  const total = (model as { TotalCount?: unknown }).TotalCount;

  return {
    rows: Array.isArray(list) ? (list as GridRow[]) : [],
    total: typeof total === 'number' ? total : 0,
  };
};

const dateOf = (value: unknown): Date | undefined => {
  if (typeof value !== 'string') return undefined;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/**
 * Адрес дома из строки источника. В ответе за домом идут квартира и прочерки
 * вместо пустых частей: «г Тетюши, Школьная, д. 10 -, кв. 8». Отключение
 * объявляется дому целиком, поэтому квартира отбрасывается, иначе адрес не
 * сойдётся ни с одним домом установки.
 */
export const houseOfGridAddress = (value: unknown): string | undefined => {
  // Граница слова `\b` считается по латинице и после кириллического «кв»
  // не срабатывает, поэтому конец сокращения проверяется явно.
  const house =
    typeof value === 'string'
      ? value
          .split(/,\s*кв(?![\p{L}])/iu)[0]
          ?.replace(/\s+-\s*$/u, '')
          .replace(/\s+/gu, ' ')
          .trim()
      : undefined;

  return house ? house : undefined;
};

/**
 * Чем спрашивать службу. Её поиск это подстрока по её же строке адреса, а
 * пишет она их по-разному: «Ямашева пр-кт, д. 12», «Проспект Ямашева 12»,
 * «Ямашева, д. 12 -». Общее у всех написаний одно: название улицы. Им и
 * спрашивают, а нужный дом отбирают уже у себя.
 *
 * Улица это последняя часть адреса, в которой остаётся не только число:
 * «г. Казань, пр. Ямашева, 12» даёт «ямашева», «ул. Баумана, 3, корп. 2»
 * тоже «баумана». Город в запрос не идёт: у источника он написан то
 * «Казань г», то «г. Казань», и подстрока на нём разваливается.
 */
export const searchTextOf = (address: string): string => {
  const parts = address
    .split(',')
    .map((part) => normalizeAddress(part))
    .filter((part) => part && !/^[\d\s/-]+$/u.test(part));

  // Номер дома в той же части, если он не отделён запятой: «Ямашева 12».
  return (parts.at(-1) ?? '')
    .split(' ')
    .filter((word) => !/^\d/u.test(word))
    .join(' ');
};

/**
 * Ключ события. Своего номера служба не даёт, поэтому он собирается из того,
 * что событие и определяет: адрес и границы. По нему одно отключение не
 * объявляется дому дважды.
 */
const keyOf = (address: string, from: Date, until: Date): string =>
  `grid:${from.toISOString()}:${until.toISOString()}:${normalizeAddress(address)}`;

/** Одна строка ответа. Кривая пропускается, а не роняет весь список. */
export const parseGridRow = (row: GridRow, by?: string): CityOutage | undefined => {
  const address = houseOfGridAddress(row.Address);
  const from = dateOf(row.From_);
  const until = dateOf(row.To_);

  if (!address || !from || !until) return undefined;

  const kind = typeof row.Description === 'string' ? row.Description.trim() : '';
  const state = typeof row.Condition === 'string' ? row.Condition.trim() : '';
  const reason = [kind, state].filter(Boolean).join(', ');

  return {
    id: keyOf(address, from, until),
    resource: 'electricity',
    from,
    until,
    addresses: [address],
    ...(reason ? { reason: reason.charAt(0).toUpperCase() + reason.slice(1) } : {}),
    ...(by ? { by } : {}),
  };
};

const DAY = 24 * 60 * 60 * 1000;

/** Дата для службы: она ждёт `2026-09-22`. */
const dayOf = (at: Date): string => at.toISOString().slice(0, 10);

/** Отключения по одному дому: улица уходит в поиск, дом отбирается здесь. */
const askAbout = async (options: GridFeedOptions, house: string): Promise<CityOutage[]> => {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = (options.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - DAYS_BACK * DAY);
  const until = new Date(now.getTime() + (options.days ?? DAYS_AHEAD) * DAY);
  const search = searchTextOf(house);

  if (!search) return [];

  const found: CityOutage[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
    const url = new URL(options.url);

    url.searchParams.set('Page', String(page));
    url.searchParams.set('PageSize', String(PAGE_SIZE));
    url.searchParams.set('SearchText', search);
    url.searchParams.set('From', dayOf(since));
    url.searchParams.set('To', dayOf(until));

    try {
      const response = await doFetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });

      if (!response.ok) throw new Error(`Сетевая организация ответила ${String(response.status)}`);

      const { rows, total } = modelOf(await response.json());

      for (const row of rows) {
        const outage = parseGridRow(row, options.by);

        // Улица одна, а домов на ней много: чужие дома отбрасываются здесь,
        // чтобы дальше не искать их среди домов установки. Законченное
        // отключение объявлять нечего: окно взято с запасом назад.
        if (!outage || outage.until.getTime() < now.getTime()) continue;

        if (sameHouse(house, outage.addresses[0] ?? '')) found.push(outage);
      }

      if (rows.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
    } catch (error) {
      options.onError?.(error);

      break;
    } finally {
      clearTimeout(timer);
    }
  }

  return found;
};

/** Источник отключений электричества у сетевой организации. */
export const createGridFeed = (options: GridFeedOptions): CityFeed => ({
  title: options.title,
  model: false,
  async outages() {
    const houses = await options.addresses();
    const found = new Map<string, CityOutage>();

    // Дома опрашиваются по очереди: служба отвечает людям, а не нам, и
    // веером запросов ей мешать незачем.
    for (const house of houses) {
      for (const outage of await askAbout(options, house)) {
        found.set(outage.id, outage);
      }
    }

    return [...found.values()];
  },
});
