/** Маскот: одна картинка на состояние, размер задаётся местом на странице. */
export type Mood =
  | 'greeting'
  | 'walking'
  | 'knocking'
  | 'scroll'
  | 'listening'
  | 'sleeping'
  | 'sleeping-sitting'
  | 'alarmed'
  | 'clock'
  | 'abacus'
  | 'ledger'
  | 'wrench'
  | 'letter';

const TITLES: Record<Mood, string> = {
  greeting: 'встречает',
  walking: 'обходит дом',
  knocking: 'стучится к соседу сверху',
  scroll: 'со свитком',
  listening: 'слушает',
  sleeping: 'спит',
  'sleeping-sitting': 'дремлет на лавке',
  alarmed: 'поднял тревогу',
  clock: 'заводит часы',
  abacus: 'считает на счётах',
  ledger: 'сверяет журнал',
  wrench: 'вышел на работу',
  letter: 'передаёт письмо',
};

/** Свои пропорции у каждой картинки: без них браузер не знает, сколько места занять. */
const SIZES: Record<Mood, [number, number]> = {
  abacus: [431, 900],
  alarmed: [814, 900],
  clock: [458, 900],
  greeting: [541, 900],
  knocking: [341, 900],
  ledger: [447, 900],
  letter: [400, 900],
  listening: [549, 900],
  scroll: [458, 900],
  sleeping: [1105, 900],
  'sleeping-sitting': [628, 900],
  walking: [729, 900],
  wrench: [637, 900],
};

export interface DomovoyProps {
  mood: Mood;
  size?: 'hero' | 'large' | 'small';
  className?: string;
}

export const Domovoy = ({ mood, size = 'large', className }: DomovoyProps) => (
  <img
    className={`domovoy domovoy-${size}${className ? ` ${className}` : ''}`}
    src={`/domovoy/${mood}.webp`}
    alt={`Домовой ${TITLES[mood]}`}
    width={SIZES[mood][0]}
    height={SIZES[mood][1]}
    data-domovoy={mood}
    loading={size === 'hero' ? 'eager' : 'lazy'}
    {...(size === 'hero' ? { fetchPriority: 'high' as const } : {})}
    decoding="async"
  />
);
