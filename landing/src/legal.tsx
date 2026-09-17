import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { LegalPage } from './LegalPage.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/motion.css';

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    <LegalPage slug={root.dataset.legal ?? ''} />
  </StrictMode>,
);
