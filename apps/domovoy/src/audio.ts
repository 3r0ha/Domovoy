/**
 * Записи голоса приходят в разных контейнерах: ogg/opus от клиента MAX,
 * webm/opus из Chrome, mp4/aac из Safari, wav от системной записи. Здесь
 * контейнер узнаётся по содержимому, из него читается длительность, а webm
 * перекладывается в ogg: модель webm не принимает, хотя звук в нём тот же opus.
 */

export type AudioContainer = 'ogg' | 'webm' | 'mp4' | 'wav' | 'mp3';

const OPUS_RATE = 48_000;

/** Контейнер по первым байтам: объявленному типу доверять нельзя. */
export const sniffAudio = (bytes: Uint8Array): AudioContainer | undefined => {
  const ascii = (at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));

  if (bytes.length < 12) return undefined;
  if (ascii(0, 4) === 'OggS') return 'ogg';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (ascii(4, 4) === 'ftyp') return 'mp4';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav';
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return 'mp3';

  return undefined;
};

const u32 = (bytes: Uint8Array, at: number): number => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, false);

const u32le = (bytes: Uint8Array, at: number): number => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);

const u16le = (bytes: Uint8Array, at: number): number => new DataView(bytes.buffer, bytes.byteOffset).getUint16(at, true);

const u64 = (bytes: Uint8Array, at: number, little: boolean): number =>
  Number(new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(at, little));

/** Длительность ogg/opus: позиция последней страницы в отсчётах 48 кГц. */
const oggSeconds = (bytes: Uint8Array): number | undefined => {
  let at = 0;
  let granule = 0;
  let preSkip = 0;
  let pages = 0;

  while (at + 27 <= bytes.length && String.fromCharCode(...bytes.subarray(at, at + 4)) === 'OggS') {
    const segments = bytes[at + 26]!;
    const table = bytes.subarray(at + 27, at + 27 + segments);
    const size = table.reduce((sum, item) => sum + item, 0);
    const body = at + 27 + segments;

    if (pages === 0 && String.fromCharCode(...bytes.subarray(body, body + 8)) === 'OpusHead') {
      preSkip = u16le(bytes, body + 10);
    }

    granule = u64(bytes, at + 6, true);
    pages += 1;
    at = body + size;
  }

  return pages === 0 ? undefined : Math.max(0, granule - preSkip) / OPUS_RATE;
};

/** Длительность mp4: заголовок фильма. У потоковой записи Safari он пуст. */
const mp4Seconds = (bytes: Uint8Array): number | undefined => {
  const find = (from: number, to: number, type: string): { at: number; end: number } | undefined => {
    let at = from;

    while (at + 8 <= to) {
      const declared = u32(bytes, at);
      const size = declared === 1 ? u64(bytes, at + 8, false) : declared === 0 ? to - at : declared;
      const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));

      if (size < 8) return undefined;
      if (name === type) return { at, end: at + size };

      at += size;
    }

    return undefined;
  };

  const moov = find(0, bytes.length, 'moov');

  if (!moov) return undefined;

  const mvhd = find(moov.at + 8, moov.end, 'mvhd');

  if (!mvhd) return undefined;

  const version = bytes[mvhd.at + 8];
  const timescale = version === 1 ? u32(bytes, mvhd.at + 28) : u32(bytes, mvhd.at + 20);
  const duration = version === 1 ? u64(bytes, mvhd.at + 32, false) : u32(bytes, mvhd.at + 24);

  return timescale > 0 && duration > 0 ? duration / timescale : undefined;
};

/** Длительность wav: размер данных на скорость потока. */
const wavSeconds = (bytes: Uint8Array): number | undefined => {
  let at = 12;
  let byteRate = 0;

  while (at + 8 <= bytes.length) {
    const name = String.fromCharCode(...bytes.subarray(at, at + 4));
    const size = u32le(bytes, at + 4);

    if (name === 'fmt ' && at + 20 <= bytes.length) byteRate = u32le(bytes, at + 16);
    if (name === 'data') return byteRate > 0 ? size / byteRate : undefined;

    at += 8 + size + (size % 2);
  }

  return undefined;
};

/** Длительность записи в секундах. Пусто, если из контейнера её не прочитать. */
export const audioSeconds = (bytes: Uint8Array): number | undefined => {
  try {
    switch (sniffAudio(bytes)) {
      case 'ogg':
        return oggSeconds(bytes);
      case 'mp4':
        return mp4Seconds(bytes);
      case 'wav':
        return wavSeconds(bytes);
      case 'webm':
        return webmSeconds(bytes);
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
};

/** Число переменной длины EBML: длина по первому байту, значение без маркера. */
const vint = (bytes: Uint8Array, at: number): { value: number; length: number; unknown: boolean } | undefined => {
  const first = bytes[at];

  if (first === undefined || first === 0) return undefined;

  let length = 1;
  let mask = 0x80;

  while ((first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }

  if (at + length > bytes.length) return undefined;

  let value = first & (mask - 1);
  let all = value === mask - 1;

  for (let index = 1; index < length; index += 1) {
    const byte = bytes[at + index]!;

    value = value * 256 + byte;
    all &&= byte === 0xff;
  }

  return { value, length, unknown: all };
};

/** Идентификатор элемента: та же запись, но маркер остаётся в значении. */
const elementId = (bytes: Uint8Array, at: number): { id: number; length: number } | undefined => {
  const read = vint(bytes, at);

  if (!read) return undefined;

  let id = 0;

  for (let index = 0; index < read.length; index += 1) id = id * 256 + bytes[at + index]!;

  return { id, length: read.length };
};

const SEGMENT = 0x18538067;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_NUMBER = 0xd7;
const CODEC_ID = 0x86;
const CODEC_PRIVATE = 0x63a2;
const AUDIO = 0xe1;
const CHANNELS = 0x9f;
const CLUSTER = 0x1f43b675;
const BLOCK_GROUP = 0xa0;
const SIMPLE_BLOCK = 0xa3;
const BLOCK = 0xa1;

/** Элементы, внутрь которых нужно заходить. */
const MASTERS = new Set([SEGMENT, TRACKS, TRACK_ENTRY, AUDIO, CLUSTER, BLOCK_GROUP]);

interface WebmOpus {
  head?: Uint8Array;
  channels: number;
  packets: Uint8Array[];
}

/** Дорожка opus из webm: заголовок кодека и пакеты по порядку. */
interface TrackEntry {
  number?: number;
  opus: boolean;
  head?: Uint8Array;
  channels: number;
}

const uint = (data: Uint8Array): number => data.reduce((sum, item) => sum * 256 + item, 0);

/** Поле описания дорожки. */
const trackField = (entry: TrackEntry, id: number, data: Uint8Array): void => {
  if (id === TRACK_NUMBER) entry.number = uint(data);
  else if (id === CODEC_ID) entry.opus = String.fromCharCode(...data) === 'A_OPUS';
  else if (id === CODEC_PRIVATE) entry.head = data;
  else if (id === CHANNELS) entry.channels = uint(data);
};

/** Дорожка opus из webm: заголовок кодека и пакеты по порядку. */
const readWebm = (bytes: Uint8Array): WebmOpus | undefined => {
  const found: WebmOpus = { channels: 1, packets: [] };
  const state = { track: undefined as number | undefined, laced: false };
  let entry: TrackEntry | undefined;

  const block = (payload: Uint8Array): void => {
    const number = vint(payload, 0);

    if (!number || number.value !== state.track) return;

    const flags = payload[number.length + 2]!;

    if (((flags >> 1) & 3) !== 0) {
      state.laced = true;
      return;
    }

    found.packets.push(payload.subarray(number.length + 3));
  };

  const walk = (from: number, to: number): void => {
    let at = from;

    while (at < to) {
      const id = elementId(bytes, at);
      const size = id ? vint(bytes, at + id.length) : undefined;

      if (!id || !size) return;

      const body = at + id.length + size.length;
      const end = size.unknown ? to : Math.min(to, body + size.value);
      const data = bytes.subarray(body, end);

      if (id.id === TRACK_ENTRY) entry = { opus: false, channels: 1 };

      if (MASTERS.has(id.id)) walk(body, end);
      else if (id.id === SIMPLE_BLOCK || id.id === BLOCK) block(data);
      else if (entry) trackField(entry, id.id, data);

      if (id.id === TRACK_ENTRY && entry?.opus && state.track === undefined) {
        state.track = entry.number;
        found.head = entry.head;
        found.channels = entry.channels;
      }

      at = end;
    }
  };

  walk(0, bytes.length);

  return state.track === undefined || state.laced || found.packets.length === 0 ? undefined : found;
};

/** Сколько отсчётов 48 кГц в пакете opus: по его первому байту. */
const packetSamples = (packet: Uint8Array): number => {
  const toc = packet[0] ?? 0;
  const config = toc >> 3;
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  const ms = config < 12 ? [10, 20, 40, 60][config & 3]! : config < 16 ? [10, 20][config & 1]! : [2.5, 5, 10, 20][config & 3]!;

  return frames * ms * (OPUS_RATE / 1000);
};

const webmSeconds = (bytes: Uint8Array): number | undefined => {
  const opus = readWebm(bytes);

  return opus ? opus.packets.reduce((sum, packet) => sum + packetSamples(packet), 0) / OPUS_RATE : undefined;
};

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index << 24;

  for (let bit = 0; bit < 8; bit += 1) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;

  return value >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let value = 0;

  for (const byte of bytes) value = ((value << 8) ^ CRC_TABLE[((value >>> 24) ^ byte) & 0xff]!) >>> 0;

  return value;
};

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

/** Заголовок opus, если его не было в webm: моно, обычный отступ кодека. */
const opusHead = (channels: number): Uint8Array => {
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);

  head.set(ascii('OpusHead'), 0);
  head[8] = 1;
  head[9] = channels;
  view.setUint16(10, 3840, true);
  view.setUint32(12, OPUS_RATE, true);

  return head;
};

const opusTags = (): Uint8Array => {
  const vendor = ascii('domovoy');
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  const view = new DataView(tags.buffer);

  tags.set(ascii('OpusTags'), 0);
  view.setUint32(8, vendor.length, true);
  tags.set(vendor, 12);

  return tags;
};

/** Одна страница ogg: заголовок, таблица сегментов, пакеты целиком. */
const oggPage = (
  packets: readonly Uint8Array[],
  granule: number,
  serial: number,
  sequence: number,
  flags: number,
): Uint8Array => {
  const table: number[] = [];

  for (const packet of packets) {
    let left = packet.length;

    while (left >= 255) {
      table.push(255);
      left -= 255;
    }

    table.push(left);
  }

  const size = packets.reduce((sum, packet) => sum + packet.length, 0);
  const page = new Uint8Array(27 + table.length + size);
  const view = new DataView(page.buffer);

  page.set(ascii('OggS'), 0);
  page[5] = flags;
  view.setBigUint64(6, BigInt(granule), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  page[26] = table.length;
  page.set(table, 27);

  let at = 27 + table.length;

  for (const packet of packets) {
    page.set(packet, at);
    at += packet.length;
  }

  view.setUint32(22, crc32(page), true);

  return page;
};

/** Сколько пакетов класть на страницу: по секунде звука на обычных кадрах. */
const PACKETS_PER_PAGE = 50;

/**
 * Перекладывает webm/opus в ogg/opus без перекодирования: пакеты те же,
 * меняется только обёртка. Пусто, если в файле нет дорожки opus.
 */
export const webmToOgg = (bytes: Uint8Array): Uint8Array | undefined => {
  const opus = readWebm(bytes);

  if (!opus) return undefined;

  const serial = 0x646f6d;
  const head = opus.head ?? opusHead(opus.channels);
  const pages: Uint8Array[] = [oggPage([head], 0, serial, 0, 0x02), oggPage([opusTags()], 0, serial, 1, 0)];
  // Позиция страницы считается вместе с отступом кодека из заголовка.
  let granule = head.length >= 12 ? u16le(head, 10) : 0;

  for (let from = 0; from < opus.packets.length; from += PACKETS_PER_PAGE) {
    const batch = opus.packets.slice(from, from + PACKETS_PER_PAGE);
    const last = from + PACKETS_PER_PAGE >= opus.packets.length;

    granule += batch.reduce((sum, packet) => sum + packetSamples(packet), 0);
    pages.push(oggPage(batch, granule, serial, pages.length, last ? 0x04 : 0));
  }

  const total = pages.reduce((sum, page) => sum + page.length, 0);
  const ogg = new Uint8Array(total);
  let at = 0;

  for (const page of pages) {
    ogg.set(page, at);
    at += page.length;
  }

  return ogg;
};
