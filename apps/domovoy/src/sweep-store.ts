import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { SweepState, SweepStore } from '@domovoy/app';
import type { KeyValueClient } from '@maxkit/sessions';

const parse = (raw: string | null | undefined): SweepState => {
  if (!raw) return {};

  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null ? value : {};
  } catch {
    return {};
  }
};

/** Отметки обхода в файле: переживают перезапуск одиночного процесса. */
export const fileSweepStore = (path: string): SweepStore => ({
  load: async () => {
    try {
      return parse(await readFile(path, 'utf8'));
    } catch {
      return {};
    }
  },
  save: async (state) => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(state), 'utf8');
    await rename(temporary, path);
  },
});

/** Отметки обхода в общем хранилище: реплики не шлют одно и то же дважды. */
export const sharedSweepStore = (kv: KeyValueClient, key = 'domovoy:sweep'): SweepStore => ({
  load: async () => parse(await kv.get(key)),
  save: (state) => kv.set(key, JSON.stringify(state)),
});
