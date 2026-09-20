import {
  DEFAULT_STICKER_STYLE,
  STICKER_STYLES,
  cleanStickerNote,
  type StickerLook,
  type StickerPlan,
  type StickerStyle,
} from '@domovoy/domain';
import QRCode from 'qrcode';

const FONT = "Roboto, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

export const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

interface Matrix {
  size: number;
  at: (x: number, y: number) => boolean;
}

/**
 * Модули кода: единица, закрашенная точка. Избыточность Q позволяет накрыть
 * середину значком и оставить код читаемым даже с потёртостями.
 */
const matrixOf = (link: string): Matrix => {
  const { modules } = QRCode.create(link, { errorCorrectionLevel: 'Q' });

  return { size: modules.size, at: (x, y) => modules.get(y, x) === 1 };
};

/** Углы-искатели: три квадрата 7x7, по которым камера находит код. */
const inFinder = (x: number, y: number, size: number): boolean =>
  (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);

/** Сколько модулей от центра занимает значок. */
const BADGE_MODULES = 3.6;

/** Белое поле вокруг кода в модулях. */
const QUIET_MODULES = 4.5;

const underBadge = (x: number, y: number, size: number): boolean => {
  const middle = (size - 1) / 2;

  return Math.hypot(x - middle, y - middle) <= BADGE_MODULES;
};

/** Разбивка надписи на строки по ширине картинки: лишнее обрывается многоточием. */
export const wrapText = (text: string, perLine: number, maxLines = 2): string[] => {
  const lines: string[] = [];
  let line = '';

  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;

    if (candidate.length <= perLine) {
      line = candidate;
      continue;
    }

    if (line) lines.push(line);
    line = word.length <= perLine ? word : `${word.slice(0, perLine - 1)}…`;
  }

  if (line) lines.push(line);

  if (lines.length <= maxLines) return lines;

  const last = lines[maxLines - 1] ?? '';

  return [...lines.slice(0, maxLines - 1), `${last.slice(0, Math.max(1, perLine - 1))}…`];
};

const round = (value: number): string => Number(value.toFixed(2)).toString();

/**
 * Уголок-искатель рисуется целиком, а не по модулям: разорванная на точки рамка
 * читается камерой хуже, чем сплошная.
 */
const drawFinder = (style: StickerStyle, left: number, top: number, cell: number): string =>
  `<rect x="${round(left + cell / 2)}" y="${round(top + cell / 2)}" width="${round(cell * 6)}" ` +
  `height="${round(cell * 6)}" fill="none" stroke="${style.accent}" stroke-width="${round(cell)}"/>` +
  `<rect x="${round(left + cell * 2)}" y="${round(top + cell * 2)}" width="${round(cell * 3)}" ` +
  `height="${round(cell * 3)}" fill="${style.ink}"/>`;

/** Модуль кода: ровный квадрат, без зазоров с соседями. */
const drawModule = (style: StickerStyle, x: number, y: number, left: number, top: number, cell: number): string =>
  `<rect x="${round(left + x * cell)}" y="${round(top + y * cell)}" width="${round(cell)}" height="${round(cell)}" ` +
  `fill="${style.ink}"/>`;

/** Домик в середине кода: по нему наклейку узнают среди чужих. */
const drawBadge = (style: StickerStyle, centerX: number, centerY: number, cell: number): string => {
  const half = cell * (BADGE_MODULES - 0.35);
  const glyph = half * 1.1;

  return (
    `<rect x="${round(centerX - half)}" y="${round(centerY - half)}" width="${round(half * 2)}" ` +
    `height="${round(half * 2)}" rx="${round(cell * 0.5)}" fill="#ffffff" ` +
    `stroke="${style.accent}" stroke-width="${round(cell * 0.45)}"/>` +
    `<path transform="translate(${round(centerX - glyph / 2)} ${round(centerY - glyph / 2)}) scale(${round(glyph / 24)})" ` +
    'd="M12 3.5 3.5 10.5v10h6v-6h5v6h6v-10z" ' +
    `fill="${style.accent}"/>`
  );
};

const drawCode = (matrix: Matrix, style: StickerStyle, left: number, top: number, cell: number): string => {
  const parts: string[] = [];

  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (!matrix.at(x, y) || inFinder(x, y, matrix.size) || underBadge(x, y, matrix.size)) continue;

      parts.push(drawModule(style, x, y, left, top, cell));
    }
  }

  parts.push('<g data-finder="1">');

  for (const [x, y] of [
    [0, 0],
    [matrix.size - 7, 0],
    [0, matrix.size - 7],
  ] as const) {
    parts.push(drawFinder(style, left + x * cell, top + y * cell, cell));
  }

  parts.push('</g>');

  const half = (matrix.size * cell) / 2;

  parts.push(drawBadge(style, left + half, top + half, cell));

  return parts.join('');
};

/** Строка адреса без протокола: её набирают руками, если камера не читает код. */
const hostOf = (link: string): string => link.replace(/^https?:\/\//u, '').replace(/\?.*$/u, '');

/** Значок камеры у подсказки. */
const cameraGlyph = (x: number, y: number, size: number, color: string): string =>
  `<path transform="translate(${round(x)} ${round(y)}) scale(${round(size / 24)})" ` +
  'd="M9 4 7.5 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5L15 4zm3 5.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" ' +
  `fill="${color}"/>`;

/** Домик у названия продукта в шапке наклейки. */
const houseGlyph = (x: number, y: number, size: number, color: string): string =>
  `<path transform="translate(${round(x)} ${round(y)}) scale(${round(size / 24)})" ` +
  `d="M12 3.5 3.5 10.5v10h6v-6h5v6h6v-10z" fill="${color}"/>`;

/** Наклейка картинкой: код, подпись объекта и своя надпись. @throws {DomainError} */
export const renderSticker = (plan: StickerPlan, look: StickerLook = {}): string => {
  const style: StickerStyle = STICKER_STYLES[look.style ?? DEFAULT_STICKER_STYLE];
  const note = cleanStickerNote(look.note);
  const width = look.size ?? 420;
  const padding = Math.round(width * 0.07);
  const text = style.text ?? style.ink;

  const headTop = padding;
  const headSize = Math.round(width * 0.036);
  const tileTop = headTop + Math.round(width * 0.075);
  const tile = width - padding * 2;
  const tileRadius = Math.round(width * 0.05);
  const matrix = matrixOf(plan.link);
  // Тихая зона по стандарту, четыре модуля: на тёмном фоне карточки без неё код не находится.
  const cell = tile / (matrix.size + QUIET_MODULES * 2);
  const quiet = cell * QUIET_MODULES;

  const caption = wrapText(plan.caption, 28, 2);
  const noteLines = note ? wrapText(note, 34, 2) : [];
  const captionSize = Math.round(width * 0.058);
  const noteSize = Math.round(width * 0.044);
  const hintSize = Math.round(width * 0.036);

  const textTop = tileTop + tile + Math.round(width * 0.1);
  const captionStep = Math.round(captionSize * 1.2);
  const noteStep = Math.round(noteSize * 1.3);

  const line = (part: string, y: number, size: number, weight: number, color: string, opacity = 1): string =>
    `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" ` +
    `font-weight="${weight}" fill="${color}" fill-opacity="${opacity}">${escapeXml(part)}</text>`;

  const texts: string[] = [];
  let y = textTop;

  for (const part of caption) {
    texts.push(line(part, y, captionSize, 600, text));
    y += captionStep;
  }

  if (noteLines.length) {
    y += Math.round(width * 0.015);

    for (const part of noteLines) {
      texts.push(line(part, y, noteSize, 400, text, 0.8));
      y += noteStep;
    }
  }

  y += Math.round(width * 0.04);

  const hint = 'Наведите камеру: откроется чат';
  const hintWidth = hint.length * hintSize * 0.52 + hintSize * 1.4;
  const hintLeft = width / 2 - hintWidth / 2;

  texts.push(
    cameraGlyph(hintLeft, y - hintSize * 0.85, hintSize * 1.1, style.accent),
    `<text x="${round(hintLeft + hintSize * 1.4)}" y="${y}" font-family="${FONT}" font-size="${hintSize}" ` +
      `font-weight="500" fill="${text}" fill-opacity="0.85">${escapeXml(hint)}</text>`,
  );
  y += Math.round(hintSize * 1.5);
  texts.push(line(hostOf(plan.link), y, hintSize, 400, text, 0.55));

  const height = y + padding;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(plan.caption)}">` +
    '<defs>' +
    `<linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${style.paper}"/><stop offset="1" stop-color="${style.paperEnd ?? style.paper}"/>` +
    '</linearGradient>' +
    '</defs>' +
    `<rect width="${width}" height="${height}" rx="${Math.round(width * 0.075)}" fill="url(#paper)"/>` +
    houseGlyph(padding, headTop - headSize * 0.05, headSize * 1.35, style.accent) +
    `<text x="${round(padding + headSize * 1.7)}" y="${round(headTop + headSize * 1.05)}" font-family="${FONT}" ` +
    `font-size="${headSize}" font-weight="600" letter-spacing="${round(headSize * 0.16)}" fill="${style.accent}">ДОМОВОЙ</text>` +
    `<rect x="${padding}" y="${tileTop}" width="${tile}" height="${tile}" rx="${tileRadius}" fill="#ffffff"/>` +
    drawCode(matrix, style, padding + quiet, tileTop + quiet, cell) +
    texts.join('') +
    '</svg>'
  );
};

/** Лист для печати по списку объектов: рисунки делает сам. */
export const sheetFor = (address: string, plans: readonly StickerPlan[], look: StickerLook = {}): string =>
  renderSheet(
    address,
    plans.map((plan) => ({ ...plan, svg: renderSticker(plan, look) })),
  );

/** Лист для печати: все наклейки дома на одной странице. */
export const renderSheet = (
  address: string,
  stickers: (StickerPlan & { svg: string })[],
): string => `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>Наклейки: ${escapeXml(address)}</title>
    <style>
      body { font: 14px/1.4 ${FONT}; margin: 24px; color: #111; background: #fff; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 20px; margin-top: 16px; }
      .sticker { break-inside: avoid; text-align: center; }
      .sticker svg { width: 100%; max-width: 230px; height: auto; }
      .hint { color: #555; font-size: 12px; margin-top: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      @media print { body { margin: 0; } .no-print { display: none; } .grid { gap: 12px; } }
    </style>
  </head>
  <body>
    <h1>${escapeXml(address)}</h1>
    <p class="no-print">Наведите камеру на код, откроется чат с управляющей компанией, объект уже будет известен.</p>
    <div class="grid">
      ${stickers
        .map(
          (sticker) => `<div class="sticker">
        ${sticker.svg}
        <div class="hint">${escapeXml(sticker.payload)}</div>
      </div>`,
        )
        .join('\n      ')}
    </div>
  </body>
</html>
`;
