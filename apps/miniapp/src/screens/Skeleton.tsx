import { useT } from '../i18n.js';

export interface SkeletonProps {
  /** Сколько карточек нарисовать. */
  count?: number;
}

/** Заготовка списка на время загрузки. */
export const Skeleton = ({ count = 3 }: SkeletonProps) => {
  const t = useT();

  return (
    <section className="list" aria-busy="true" aria-label={t('chrome.busy')}>
      {Array.from({ length: count }, (_, index) => (
        <article key={index} className="card skeleton">
          <span className="bone bone-title" />
          <span className="bone bone-text" />
          <span className="bone bone-meta" />
        </article>
      ))}
    </section>
  );
};
