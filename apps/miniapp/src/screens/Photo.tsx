import { useEffect, useState } from 'react';

import { type DomovoyApi } from '../api.js';
import { useT } from '../i18n.js';
import { useViewer } from '../viewer.js';

export interface PhotoProps {
  api: DomovoyApi;
  /** Токен вложения: `file:<id>` это свой файл, остальное ссылка платформы. */
  token: string;
  alt: string;
}

/** Снимок из заявки. */
export const Photo = ({ api, token, alt }: PhotoProps) => {
  const show = useViewer();
  const t = useT();
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token.startsWith('file:')) {
      setSource(token);
      return undefined;
    }

    let url: string | null = null;
    let active = true;

    api
      .photo(token)
      .then((blob) => {
        if (!active) return;

        url = URL.createObjectURL(blob);
        setSource(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, token]);

  if (failed) return <span className="badge">{t('photo.failed')}</span>;
  if (!source) return <span className="badge">{t('photo.loading')}</span>;

  return (
    <button
      type="button"
      className="photo-open"
      aria-label={t('photo.open', { подпись: alt })}
      onClick={() => show(source, alt)}
    >
      <img src={source} alt={alt} />
    </button>
  );
};
