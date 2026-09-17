import { Ink } from './Ink.js';

/**
 * Вязь вырезана из логотипа.
 */

/**
 * Подвес логотипа: лента с розеткой по центру. Сверху он ставится отражённым и
 * открывает разворот, снизу закрывает его.
 */
export const Hem = ({ open, className }: { open?: boolean; className?: string }) => (
  <Ink
    src="/bezslavie-weave.svg"
    pace={0.55}
    className={`weave weave-hem${open ? ' weave-open' : ''}${className ? ` ${className}` : ''}`}
  />
);

/** Ромб вместо точки в списке. */
export const Mark = ({ size = 10 }: { size?: number }) => (
  <svg className="mark" viewBox="0 0 18 18" width={size} height={size} aria-hidden="true">
    <path d="M9 0.5 17.5 9 9 17.5 0.5 9Z" />
    <path d="M9 5.5 12.5 9 9 12.5 5.5 9Z" className="mark-hole" />
  </svg>
);
