import {
  DEFAULT_STICKER_STYLE,
  STICKER_STYLES,
  cleanStickerNote,
  type StickerLook,
  type StickerPlan,
  type StickerStyle,
} from '@domovoy/domain';
import QRCode from 'qrcode';

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

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

/** Модули кода: единица, закрашенная точка. */
const matrixOf = (link: string): Matrix => {
  const { modules } = QRCode.create(link, { errorCorrectionLevel: 'M' });

  return { size: modules.size, at: (x, y) => modules.get(y, x) === 1 };
};

/** Углы-искатели: три квадрата 7x7, по которым камера находит код. */
const inFinder = (x: number, y: number, size: number): boolean =>
  (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);

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
const drawFinder = (style: StickerStyle, left: number, top: number, cell: number): string => {
  const outer = style.shape === 'square' ? 0 : cell * 0.9;
  const inner = style.shape === 'square' ? 0 : cell * 0.6;

  return (
    `<rect x="${round(left + cell / 2)}" y="${round(top + cell / 2)}" width="${round(cell * 6)}" ` +
    `height="${round(cell * 6)}" rx="${round(outer)}" fill="none" stroke="${style.accent}" ` +
    `stroke-width="${round(cell)}"/>` +
    `<rect x="${round(left + cell * 2)}" y="${round(top + cell * 2)}" width="${round(cell * 3)}" ` +
    `height="${round(cell * 3)}" rx="${round(inner)}" fill="${style.accent}"/>`
  );
};

const drawCode = (matrix: Matrix, style: StickerStyle, left: number, top: number, cell: number): string => {
  const parts: string[] = [];

  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (!matrix.at(x, y) || inFinder(x, y, matrix.size)) continue;

      const dx = left + x * cell;
      const dy = top + y * cell;

      if (style.shape === 'dot') {
        parts.push(
          `<circle cx="${round(dx + cell / 2)}" cy="${round(dy + cell / 2)}" r="${round(cell * 0.44)}" ` +
            `fill="${style.ink}"/>`,
        );
        continue;
      }

      const radius = style.shape === 'rounded' ? ` rx="${round(cell * 0.3)}"` : '';

      parts.push(
        `<rect x="${round(dx)}" y="${round(dy)}" width="${round(cell)}" height="${round(cell)}"${radius} ` +
          `fill="${style.ink}"/>`,
      );
    }
  }

  for (const [x, y] of [
    [0, 0],
    [matrix.size - 7, 0],
    [0, matrix.size - 7],
  ] as const) {
    parts.push(drawFinder(style, left + x * cell, top + y * cell, cell));
  }

  return parts.join('');
};

/** Наклейка картинкой: код, подпись объекта и своя надпись. @throws {DomainError} */
export const renderSticker = (plan: StickerPlan, look: StickerLook = {}): string => {
  const style = STICKER_STYLES[look.style ?? DEFAULT_STICKER_STYLE];
  const note = cleanStickerNote(look.note);
  const width = look.size ?? 420;
  const padding = Math.round(width * 0.09);
  const matrix = matrixOf(plan.link);
  const cell = (width - padding * 2) / matrix.size;
  const codeSize = cell * matrix.size;

  const caption = wrapText(plan.caption, 26, 2);
  const noteLines = note ? wrapText(note, 30, 2) : [];
  const captionSize = Math.round(width * 0.062);
  const noteSize = Math.round(width * 0.05);

  const textTop = Math.round(padding + codeSize + width * 0.08);
  const captionHeight = caption.length * Math.round(captionSize * 1.25);
  const noteHeight = noteLines.length * Math.round(noteSize * 1.3);
  const height = textTop + captionHeight + (noteLines.length ? Math.round(width * 0.02) + noteHeight : 0) + padding;

  const line = (text: string, y: number, size: number, weight: number, opacity = 1): string =>
    `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" ` +
    `font-weight="${weight}" fill="${style.ink}" fill-opacity="${opacity}">${escapeXml(text)}</text>`;

  const texts: string[] = [];
  let y = textTop;

  for (const part of caption) {
    texts.push(line(part, y, captionSize, 600));
    y += Math.round(captionSize * 1.25);
  }

  if (noteLines.length) {
    y += Math.round(width * 0.02);

    for (const part of noteLines) {
      texts.push(line(part, y, noteSize, 400, 0.75));
      y += Math.round(noteSize * 1.3);
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(plan.caption)}">` +
    `<rect width="${width}" height="${height}" rx="${Math.round(width * 0.07)}" fill="${style.paper}"/>` +
    drawCode(matrix, style, padding, padding, cell) +
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
      body { font: 14px/1.4 ${FONT}; margin: 24px; color: #111; }
      h1 { font-size: 18px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
      .sticker { break-inside: avoid; text-align: center; }
      .sticker svg { width: 100%; max-width: 220px; height: auto; }
      .hint { color: #555; font-size: 12px; margin-top: 4px; }
      @media print { body { margin: 0; } .no-print { display: none; } }
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
