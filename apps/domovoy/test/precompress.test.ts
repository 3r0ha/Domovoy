import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

interface CompressPlugin {
  name: string;
  enforce: string;
  writeBundle: (options: { dir: string }, bundle: Record<string, unknown>) => Promise<void>;
}

const { precompress } = (await import('../../../scripts/precompress.mjs')) as {
  precompress: (options?: { minBytes?: number }) => CompressPlugin;
};

describe('сжатые копии статики', () => {
  it('снимаются с того, что записано на диск, а не с промежуточного кода', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'domovoy-precompress-'));

    try {
      // Сборщик правит чанк последним шагом: копия, снятая раньше, увезла бы
      // к человеку код с незаменённой меткой предзагрузки.
      const done = `console.log(${'"x"'.repeat(600)});`;

      await writeFile(join(directory, 'index.js'), done);
      await writeFile(join(directory, 'small.js'), 'const a = 1;');

      await precompress().writeBundle(
        { dir: directory },
        { 'index.js': { type: 'chunk', code: 'ЭТО СТАРЫЙ КОД' }, 'small.js': { type: 'chunk', code: '' } },
      );

      assert.equal(brotliDecompressSync(await readFile(join(directory, 'index.js.br'))).toString(), done);
      assert.equal(gunzipSync(await readFile(join(directory, 'index.js.gz'))).toString(), done);

      await assert.rejects(readFile(join(directory, 'small.js.br')), 'короткие файлы не сжимаются');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
