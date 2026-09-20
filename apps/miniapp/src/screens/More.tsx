import { useT } from '../i18n.js';

export interface MoreProps {
  loading: boolean;
  /** Причина неудачи: её показывает та же кнопка, повторный клик пробует снова. */
  error: string | null;
  onMore: () => void;
}

/** Кнопка «Показать ещё» под списком, который читается страницами. */
export const More = ({ loading, error, onMore }: MoreProps) => {
  const t = useT();

  return (
    <button type="button" className="link group-toggle" disabled={loading} onClick={onMore}>
      {error ? t('chrome.more.failed', { причина: error }) : loading ? t('chrome.loading') : t('chrome.more')}
    </button>
  );
};
