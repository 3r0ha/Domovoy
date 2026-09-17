export interface SkeletonProps {
  /** Сколько карточек нарисовать. */
  count?: number;
}

/** Заготовка списка на время загрузки. */
export const Skeleton = ({ count = 3 }: SkeletonProps) => (
  <section className="list" aria-busy="true" aria-label="Загружаем">
    {Array.from({ length: count }, (_, index) => (
      <article key={index} className="card skeleton">
        <span className="bone bone-title" />
        <span className="bone bone-text" />
        <span className="bone bone-meta" />
      </article>
    ))}
  </section>
);
