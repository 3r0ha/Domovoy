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

/** Группа строк с подписью. */
export const Group = ({ title, aside, className, children }: GroupProps) => (
  <div className={className}>
    {title ? (
      <h2 className="group-title">
        {title}
        {aside ? <span className="group-aside">{aside}</span> : null}
      </h2>
    ) : null}
    <CellList mode="island">{children}</CellList>
  </div>
);
