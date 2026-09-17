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
} from './icons.js';

/** Значок категории на цветной плитке. */
const TILES: Record<string, { icon: () => ReactNode; tone: string }> = {
  elevator: { icon: IconElevator, tone: 'tile-red' },
  plumbing: { icon: IconWater, tone: 'tile-blue' },
  heating: { icon: IconHeating, tone: 'tile-orange' },
  electricity: { icon: IconPower, tone: 'tile-yellow' },
  cleaning: { icon: IconCleaning, tone: 'tile-teal' },
  yard: { icon: IconYard, tone: 'tile-green' },
  safety: { icon: IconWarning, tone: 'tile-red' },
  document: { icon: IconDocument, tone: 'tile-blue' },
  other: { icon: IconWrench, tone: 'tile-grey' },
};

export const CategoryTile = ({ category, title }: { category: string; title?: string }) => {
  const tile = TILES[category] ?? TILES['other'];

  if (!tile) return null;

  return (
    <span className={`tile ${tile.tone}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={!title}>
      {tile.icon()}
    </span>
  );
};
