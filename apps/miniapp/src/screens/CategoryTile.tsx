import type { ReactNode } from 'react';

import {
  IconCleaning,
  IconDocument,
  IconElevator,
  IconHeating,
  IconPower,
  IconWarning,
  IconWater,
  IconWrench,
  IconYard,
  type IconProps,
} from './icons.js';

/**
 * Значок категории. Цвета у него нет: цветом в списке заявок говорит
 * состояние, а раскрашенная категория спорила с ним. Красная плитка лифта
 * рядом с красной полосой аварии читалась как «здесь авария» на любой
 * заявке о лифте. Что за поломка, говорит рисунок.
 */
const ICONS: Record<string, (props?: IconProps) => ReactNode> = {
  elevator: IconElevator,
  plumbing: IconWater,
  heating: IconHeating,
  electricity: IconPower,
  cleaning: IconCleaning,
  yard: IconYard,
  safety: IconWarning,
  document: IconDocument,
  other: IconWrench,
};

export const CategoryTile = ({ category, title }: { category: string; title?: string }) => {
  const icon = ICONS[category] ?? ICONS['other'];

  if (!icon) return null;

  return (
    <span className="tile tile-plain" role={title ? 'img' : undefined} aria-label={title} aria-hidden={!title}>
      {icon()}
    </span>
  );
};
