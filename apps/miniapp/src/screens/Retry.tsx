import { Button } from '@maxhub/max-ui';

import { describeFailure } from '../api.js';

export interface RetryProps {
  /** Что именно не загрузилось: «Счёт не загрузился». */
  title: string;
  error: unknown;
  onRetry: () => void;
}

/**
 * Часть экрана не загрузилась. Без этой строки отказ сети неотличим от пустоты:
 * блок молча исчезает, и человек считает, что счёта или платежей просто нет.
 */
export const Retry = ({ title, error, onRetry }: RetryProps) => (
  <section className="block retry" role="alert">
    <p className="retry-title">{title}</p>
    <p className="hint">{describeFailure(error)}</p>

    <Button type="button" size="large" stretched variant="secondary" onClick={onRetry}>
      Повторить
    </Button>
  </section>
);

/** То же самое строкой: в шапке и в ряду выбора целому блоку места нет. */
export const RetryLink = ({ title, onRetry }: { title: string; onRetry: () => void }) => (
  <button type="button" className="link retry-link" role="alert" onClick={onRetry}>
    {title}. Повторить
  </button>
);
