/** Записи для проверок: минимальные файлы каждого контейнера, собранные руками. */

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

/** Пакет opus на 20 мс: конфигурация CELT, один кадр. */
export const OPUS_PACKET = [0xf8, 1, 2, 3];

const opusHead = (): number[] => [...ascii('OpusHead'), 1, 1, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0];

/** Страница ogg без верной контрольной суммы: читатель её не проверяет. */
const oggPage = (packet: number[], granule: number, flags = 0): number[] => {
  const header = new Uint8Array(27);
  const view = new DataView(header.buffer);

  header.set(ascii('OggS'), 0);
  header[5] = flags;
  view.setBigUint64(6, BigInt(granule), true);
  header[26] = 1;

  return [...header, packet.length, ...packet];
};

/** Файл ogg/opus заданной длительности: заголовок и одна страница данных. */
export const oggOf = (seconds: number): Uint8Array =>
  Uint8Array.from([...oggPage(opusHead(), 0, 2), ...oggPage(OPUS_PACKET, 312 + seconds * 48_000, 4)]);

/** Элемент EBML с размером в один байт. */
const ebml = (id: number[], payload: number[]): number[] => [...id, 0x80 | payload.length, ...payload];

/** Файл webm/opus, как его пишет MediaRecorder: сегмент и кластер без размера. */
export const webmOf = (packets: number[][], options: { head?: boolean; laced?: boolean } = {}): Uint8Array => {
  const unknown = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  const entry = ebml(
    [0xae],
    [
      ...ebml([0xd7], [1]),
      ...ebml([0x83], [2]),
      ...ebml([0x86], ascii('A_OPUS')),
      ...(options.head === false ? [] : ebml([0x63, 0xa2], opusHead())),
      ...ebml([0xe1], ebml([0x9f], [1])),
    ],
  );
  const blocks = packets.flatMap((packet, at) =>
    ebml([0xa3], [0x81, 0, at * 20, options.laced ? 0x82 : 0x80, ...packet]),
  );

  return Uint8Array.from([
    ...ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], ascii('webm'))),
    0x18, 0x53, 0x80, 0x67, ...unknown,
    ...ebml([0x16, 0x54, 0xae, 0x6b], entry),
    0x1f, 0x43, 0xb6, 0x75, ...unknown,
    ...ebml([0xe7], [0]),
    ...blocks,
  ]);
};

/** Файл mp4 с заголовком фильма: масштаб времени и длительность. */
export const mp4Of = (seconds: number): Uint8Array => {
  const mvhd = new Uint8Array(108);
  const view = new DataView(mvhd.buffer);

  view.setUint32(0, 108);
  mvhd.set(ascii('mvhd'), 4);
  view.setUint32(20, 1000);
  view.setUint32(24, seconds * 1000);

  const moov = new Uint8Array(8 + mvhd.length);

  new DataView(moov.buffer).setUint32(0, moov.length);
  moov.set(ascii('moov'), 4);
  moov.set(mvhd, 8);

  return Uint8Array.from([0, 0, 0, 16, ...ascii('ftypisom'), 0, 0, 0, 0, ...moov]);
};

/** Файл wav: заголовок формата и данные на заданное число секунд. */
export const wavOf = (seconds: number): Uint8Array => {
  const byteRate = 32_000;
  const data = new Uint8Array(seconds * byteRate);
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);

  header.set(ascii('RIFF'), 0);
  header.set(ascii('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint32(28, byteRate, true);
  header.set(ascii('data'), 36);
  view.setUint32(40, data.length, true);

  return Uint8Array.from([...header, ...data]);
};
