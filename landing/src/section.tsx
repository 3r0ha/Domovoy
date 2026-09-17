import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SectionPage } from './SectionPage.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/motion.css';

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    <SectionPage id={root.dataset.section ?? ''} />
  </StrictMode>,
);
