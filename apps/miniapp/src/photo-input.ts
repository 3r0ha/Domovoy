/** Наибольшая сторона снимка после уменьшения. */
const MAX_SIDE = 1600;

/** Качество JPEG при сжатии снимка. */
const QUALITY = 0.8;

export interface PreparedPhoto {
  contentType: string;
  /** Содержимое в base64, без префикса `data:`. */
  data: string;
}

/** Готовит снимок к отправке. */
export const preparePhoto = async (file: File): Promise<PreparedPhoto> => {
  const original = { contentType: file.type, data: await asBase64(file) };

  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return original;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));

    if (scale === 1 && file.size <= 700_000) return original;

    const canvas = document.createElement('canvas');

    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext('2d');

    if (!context) return original;

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const encoded = canvas.toDataURL('image/jpeg', QUALITY);

    return { contentType: 'image/jpeg', data: encoded.slice(encoded.indexOf(',') + 1) };
  } catch {
    return original;
  }
};

/** Содержимое файла строкой base64. */
const asBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }

  return btoa(chunks.join(''));
};
