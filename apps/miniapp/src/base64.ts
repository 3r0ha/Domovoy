/** Сколько байт кодируется за раз: длинный список аргументов ломает стек. */
const CHUNK = 0x8000;

/** Содержимое файла строкой base64, без префикса `data:`. */
export const asBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];

  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + CHUNK)));
  }

  return btoa(chunks.join(''));
};
