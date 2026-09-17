import { useRef, useState } from 'react';

import { describeFailure } from './api.js';

export interface Pages<T> {
  /** Догруженные страницы. Первую экран может читать и сам. */
  items: T[];
  loading: boolean;
  /** Первую страницу уже просили: пустой список означает «ничего нет». */
  started: boolean;
  /** Последняя страница пришла короткой: дальше ничего нет. */
  done: boolean;
  error: string | null;
  /** Курсор берёт экран: он знает, какая запись показана последней. */
  more: (cursor?: string) => void;
}

/** Подгрузка по курсору. */
export const usePages = <T>(load: (cursor?: string) => Promise<T[]>, size: number): Pages<T> => {
  const [items, setItems] = useState<T[]>([]);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const next = async (cursor?: string): Promise<void> => {
    if (running.current || done) return;

    running.current = true;
    setStarted(true);
    setLoading(true);
    setError(null);

    try {
      const page = await load(cursor);

      setItems((current) => [...current, ...page]);
      if (page.length < size) setDone(true);
    } catch (reason: unknown) {
      setError(describeFailure(reason));
    } finally {
      running.current = false;
      setLoading(false);
    }
  };

  return { items, started, loading, done, error, more: (cursor?: string) => void next(cursor) };
};
