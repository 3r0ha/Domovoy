export interface MoreProps {
  loading: boolean;
  /** Причина неудачи: её показывает та же кнопка, повторный клик пробует снова. */
  error: string | null;
  onMore: () => void;
}

/** Кнопка «Показать ещё» под списком, который читается страницами. */
export const More = ({ loading, error, onMore }: MoreProps) => (
  <button type="button" className="link group-toggle" disabled={loading} onClick={onMore}>
    {error ? `${error}. Повторить` : loading ? 'Загружаем…' : 'Показать ещё'}
  </button>
);
