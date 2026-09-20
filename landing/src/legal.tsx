import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DEFAULT_LANGUAGE, isLanguage } from '@domovoy/i18n';

import { LegalPage } from './LegalPage.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/motion.css';

const root = document.getElementById('root')!;

/** Язык страницы задан её сборкой: у русской редакции его нет. */
const code = root.dataset.language ?? '';
const language = isLanguage(code) ? code : DEFAULT_LANGUAGE;

createRoot(root).render(
  <StrictMode>
    <LegalPage slug={root.dataset.legal ?? ''} language={language} />
  </StrictMode>,
);
