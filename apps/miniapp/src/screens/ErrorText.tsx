import type { ReactNode } from 'react';

/** Отказ после действия: цвет и роль `alert` для озвучки экрана. */
export const ErrorText = ({ children, className, id }: { children: ReactNode; className?: string; id?: string }) => (
  <p className={className ? `error ${className}` : 'error'} role="alert" id={id}>
    {children}
  </p>
);
