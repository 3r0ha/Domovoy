import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/** Что сжимать: остальное (webp, woff2, png) уже сжато своим форматом. */
const TEXT = /\.(?:js|mjs|css|html|svg|json|xml|txt|webmanifest)$/;

/**
 * Сжатые копии статики рядом с исходными файлами. Сервер отдаёт готовый `.br`
 * или `.gz` по заголовку клиента и не тратит время на сжатие в запросе.
 */
export const precompress = ({ minBytes = 1024 } = {}) => ({
  name: 'domovoy-precompress',
  apply: 'build',
  /** Последним: к этому времени остальные плагины уже положили свои файлы. */
  enforce: 'post',
  generateBundle(_options, bundle) {
    for (const [name, file] of Object.entries(bundle)) {
      if (!TEXT.test(name)) continue;

      const source = file.type === 'asset' ? file.source : file.code;
      const data = Buffer.from(typeof source === 'string' ? source : source);

      if (data.length < minBytes) continue;

      this.emitFile({
        type: 'asset',
        fileName: `${name}.br`,
        source: brotliCompressSync(data, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: 11,
            [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
          },
        }),
      });

      this.emitFile({ type: 'asset', fileName: `${name}.gz`, source: gzipSync(data, { level: 9 }) });
    }
  },
});
