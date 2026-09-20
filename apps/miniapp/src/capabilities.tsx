import { createContext, useContext, type ReactNode } from 'react';

/** Что в этой установке подключено: без службы возможность не показывают. */
export interface Capabilities {
  /** Расшифровка речи: без неё кнопка записи бесполезна. */
  voice: boolean;
}

/** До ответа сервера возможности считаются доступными: так экран не мигает. */
const initial: Capabilities = { voice: true };

const CapabilitiesContext = createContext<Capabilities>(initial);

export const CapabilitiesProvider = ({
  voice,
  children,
}: {
  voice?: boolean;
  children: ReactNode;
}) => (
  <CapabilitiesContext.Provider value={{ voice: voice !== false }}>{children}</CapabilitiesContext.Provider>
);

export const useCapabilities = (): Capabilities => useContext(CapabilitiesContext);
