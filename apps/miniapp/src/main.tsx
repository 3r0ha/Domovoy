import { LOCAL_DEV_ORIGINS } from '@maxkit/bridge';
import { MaxProvider } from '@maxkit/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';

import '@maxhub/max-ui/styles.css';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден корневой элемент');

const env = import.meta.env as { DEV?: boolean; VITE_API_URL?: string };

const trustedOrigins: (string | RegExp)[] = env.DEV ? [...LOCAL_DEV_ORIGINS] : [];
/**
 * Пусто означает «тот же адрес»: запросы идут относительными путями.
 * Отдельный адрес задаётся на сборке, если статику раздаёт кто-то другой.
 */
const baseUrl = env.VITE_API_URL ?? '';

createRoot(container).render(
  <StrictMode>
    <MaxProvider trustedOrigins={trustedOrigins}>
      <App baseUrl={baseUrl} />
    </MaxProvider>
  </StrictMode>,
);
