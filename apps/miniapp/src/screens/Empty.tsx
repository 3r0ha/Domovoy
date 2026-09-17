import type { ReactNode } from 'react';

import { Domovoy, type Mood } from './Domovoy.js';

export interface EmptyProps {
  /** Значок раздела: тот же, что в нижней панели. */
  icon?: ReactNode;
  /** Домовой вместо значка раздела. */
  mood?: Mood;
  title: string;
  /** Подсказка нужна не всегда. */
  hint?: string;
  /** Действие, если из пустого экрана есть куда идти. */
  children?: ReactNode;
}

/** Пустой раздел: значок и подпись. */
export const Empty = ({ icon, mood, title, hint, children }: EmptyProps) => (
  <section className="empty">
    {mood ? (
      <Domovoy mood={mood} />
    ) : (
      <span className="empty-icon" aria-hidden="true">
        {icon}
      </span>
    )}

    <h2>{title}</h2>
    {hint ? <p className="hint">{hint}</p> : null}

    {children}
  </section>
);
