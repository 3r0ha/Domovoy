import type { ReactNode } from 'react';

import { money } from '../api.js';

/**
 * Число со своей единицей. Единица стоит рядом, а не внутри числа: внутри она
 * шла тем же весом и размером, и столбец значений выстраивался по знаку,
 * а не по цифрам.
 */
export const Amount = ({
  value,
  unit,
  className,
  plain,
}: {
  value: ReactNode;
  unit?: string;
  /** На месте числа слово: «нет данных», «не оценивали». Весом оно не кричит. */
  plain?: boolean;
  className?: string;
}) => (
  <span className={['report-value', plain ? 'report-plain' : '', className ?? ''].filter(Boolean).join(' ')}>
    {value}
    <span className="report-unit">{unit ?? ''}</span>
  </span>
);

/** Сумма в рублях: знак валюты и есть единица. */
export const Money = ({ amount, className }: { amount: number; className?: string }) => (
  <Amount value={money(amount)} unit="₽" {...(className ? { className } : {})} />
);
