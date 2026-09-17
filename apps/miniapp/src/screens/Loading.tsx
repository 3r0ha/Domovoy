import { Lantern } from './Domovoy.js';

/** Ожидание: фонарь домового и подпись, чего именно ждём. */
export const Loading = ({ children }: { children: string }) => (
  <div className="loading">
    <Lantern />
    <span className="hint">{children}</span>
  </div>
);
