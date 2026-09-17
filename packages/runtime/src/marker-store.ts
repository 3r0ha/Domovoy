import { readFile, rename, writeFile } from 'node:fs/promises';

/** Хранилище позиции в потоке апдейтов. */
export interface MarkerStore {
  load(): Promise<number | undefined> | number | undefined;
  save(marker: number): Promise<void> | void;
}

/** Маркер живёт в памяти процесса и теряется при рестарте. */
export class MemoryMarkerStore implements MarkerStore {
  private marker: number | undefined;

  load(): number | undefined {
    return this.marker;
  }

  save(marker: number): void {
    this.marker = marker;
  }
}

/** Маркер в файле. */
export class FileMarkerStore implements MarkerStore {
  constructor(private readonly path: string) {}

  async load(): Promise<number | undefined> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const marker = Number.parseInt(raw.trim(), 10);
      return Number.isFinite(marker) ? marker : undefined;
    } catch {
      return undefined;
    }
  }

  async save(marker: number): Promise<void> {
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, String(marker), 'utf8');
    await rename(temporary, this.path);
  }
}
