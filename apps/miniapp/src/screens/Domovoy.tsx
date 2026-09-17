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

export const Domovoy = ({ mood, size = 96 }: DomovoyProps) => (
  <img
    className="domovoy"
    src={`/domovoy/${mood}.webp`}
    alt={LABEL[mood]}
    data-mood={mood}
    width={size}
    height={size}
  />
);

/** Фонарь домового: им отмечено ожидание. */
export const Lantern = ({ size = 20 }: { size?: number }) => (
  <img className="lantern" src="/domovoy/lantern.webp" alt="" aria-hidden="true" width={size} height={size} />
);
