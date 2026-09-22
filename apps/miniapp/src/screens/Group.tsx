import { CellList } from '@maxhub/max-ui';
import type { ReactNode } from 'react';

export interface GroupProps {
  /** Подпись над островом. */
  title?: string;
  /** Счётчик справа от подписи: сколько в группе требует внимания. */
  aside?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Группа строк с подписью. Счётчик показывается и без подписи: он говорит,
 * сколько в группе ждёт, а подпись над списком часто повторяет заголовок экрана.
 */
export const Group = ({ title, aside, className, children }: GroupProps) => (
  <div className={className}>
    {title || aside ? (
      <h2 className={title ? 'group-title' : 'group-title group-title-bare'}>
        {title}
        {aside ? <span className="group-aside">{aside}</span> : null}
      </h2>
    ) : null}
    <CellList mode="island">{children}</CellList>
  </div>
);
