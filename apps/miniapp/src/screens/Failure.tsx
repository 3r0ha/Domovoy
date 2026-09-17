import { Button } from '@maxhub/max-ui';
import type { ReactNode } from 'react';

import { describeFailure, worthRetrying } from '../api.js';
import { Empty } from './Empty.js';
import { IconWarning } from './icons.js';

export interface FailureProps {
  title: string;
  error: unknown;
  /** Повторить запрос. Кнопка появляется, только если повтор что-то изменит. */
  onRetry?: () => void;
  /** Куда идти, если повторять бессмысленно. */
  children?: ReactNode;
}

/** Отказ вместо данных: одинаково выглядит на любом экране. */
export const Failure = ({ title, error, onRetry, children }: FailureProps) => {
  const hint = describeFailure(error);

  return (
    <Empty icon={<IconWarning />} title={title} {...(hint && hint !== title ? { hint } : {})}>
      {onRetry && worthRetrying(error) ? (
        <Button type="button" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}

      {children}
    </Empty>
  );
};
