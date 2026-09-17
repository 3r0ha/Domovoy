import type { ReactNode } from 'react';

/** Отказ после действия: цвет и роль `alert` для озвучки экрана. */
export const ErrorText = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={className ? `error ${className}` : 'error'} role="alert">
    {children}
  </p>
);
