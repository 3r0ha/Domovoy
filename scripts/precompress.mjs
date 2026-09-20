import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/** Что сжимать: остальное (webp, woff2, png) уже сжато своим форматом. */
const TEXT = /\.(?:js|mjs|css|html|svg|json|xml|txt|webmanifest)$/;

/**
 * Сжатые копии статики рядом с исходными файлами. Сервер отдаёт готовый `.br`
 * или `.gz` по заголовку клиента и не тратит время на сжатие в запросе.
 *
 * Файлы читаются с диска после записи сборки, а не из объектов в памяти:
 * сборщик правит код чанков в самом конце (так подставляется список файлов
 * для предзагрузки динамического импорта), и сжатая копия, снятая раньше,
 * увозила бы к человеку незавершённый код.
 */
export const precompress = ({ minBytes = 1024 } = {}) => ({
  name: 'domovoy-precompress',
  apply: 'build',
  /** Последним: к этому времени остальные плагины уже положили свои файлы. */
  enforce: 'post',
  async writeBundle(options, bundle) {
    const directory = options.dir ?? '';

    for (const name of Object.keys(bundle)) {
      if (!TEXT.test(name)) continue;

      const path = join(directory, name);
      const data = await readFile(path);

      if (data.length < minBytes) continue;

      await writeFile(
        `${path}.br`,
        brotliCompressSync(data, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: 11,
            [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
          },
        }),
      );

      await writeFile(`${path}.gz`, gzipSync(data, { level: 9 }));
    }
  },
});
