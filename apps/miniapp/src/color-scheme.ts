import { useEffect, useState } from 'react';

export type ColorScheme = 'light' | 'dark';

const QUERY = '(prefers-color-scheme: dark)';

const current = (): ColorScheme => {
  if (typeof globalThis.matchMedia !== 'function') return 'light';

  return globalThis.matchMedia(QUERY).matches ? 'dark' : 'light';
};

/** Светлая тема или тёмная. */
export const useColorScheme = (): ColorScheme => {
  const [scheme, setScheme] = useState<ColorScheme>(current);

  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return undefined;

    const media = globalThis.matchMedia(QUERY);
    const update = (): void => setScheme(media.matches ? 'dark' : 'light');

    media.addEventListener('change', update);

    return () => media.removeEventListener('change', update);
  }, []);

  return scheme;
};
