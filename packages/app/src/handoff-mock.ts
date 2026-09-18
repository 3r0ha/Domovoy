import type { HandoffGateway, HandoffReceipt, OutboundHandoff } from './handoff.js';

export interface MockHandoffOptions {
  /** Как назвать канал в журнале: обычно это имя внешней системы. */
  channel?: string;
  /** Откуда берутся номера обращений. */
  createId?: () => string;
}

/** Приставка номера: по ней видно, куда ушло обращение. */
const PREFIXES: Record<string, string> = {
  resource: 'РСО',
  contractor: 'ПОДР',
  municipal: 'МУН',
  inspection: 'ГЖИ',
};

/**
 * Модельный канал передачи обращений: он подтверждает приём и выдаёт номер,
 * но наружу ничего не уходит. Нужен, чтобы сценарий передачи проходился
 * целиком до подключения настоящей системы.
 */
export const createMockHandoffs = (options: MockHandoffOptions = {}): HandoffGateway & { sent: OutboundHandoff[] } => {
  const sent: OutboundHandoff[] = [];
  let counter = 0;

  return {
    channel: options.channel ?? 'mock',
    model: true,
    sent,
    async send(outbound: OutboundHandoff): Promise<HandoffReceipt> {
      sent.push(outbound);

      const number = options.createId ? options.createId() : `${++counter}`.padStart(4, '0');

      return { externalId: `${PREFIXES[outbound.to] ?? 'ОБР'}-${number}`, accepted: true };
    },
  };
};
