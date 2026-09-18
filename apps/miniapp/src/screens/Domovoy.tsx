/** Маскот по состоянию дома: спокойно, просрочка, авария. */
export type Mood = 'sleeping' | 'walking' | 'alarmed';

const LABEL: Record<Mood, string> = {
  sleeping: 'Домовой спит',
  walking: 'Домовой обходит дом',
  alarmed: 'Домовой встревожен',
};

export interface DomovoyProps {
  mood: Mood;
  /** Сторона картинки в пикселях. */
  size?: number;
}

/**
 * Приложение раздаётся не из корня сайта, а из своего каталога. Абсолютный
 * путь вёл на страницу лендинга, и картинка приходила чужая или никакая.
 */
const asset = (name: string): string => {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';

  return `${base}domovoy/${name}`;
};

export const Domovoy = ({ mood, size = 96 }: DomovoyProps) => (
  <img
    className="domovoy"
    src={asset(`${mood}.webp`)}
    alt={LABEL[mood]}
    data-mood={mood}
    width={size}
    height={size}
  />
);

/** Фонарь домового: им отмечено ожидание. */
export const Lantern = ({ size = 20 }: { size?: number }) => (
  <img className="lantern" src={asset('lantern.webp')} alt="" aria-hidden="true" width={size} height={size} />
);
