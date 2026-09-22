import type { RegistryBatch, RegistryGateway, RegistryReceipt } from '@domovoy/app';

/**
 * Модельный обмен с внешним реестром. Заявки управляющая организация обязана
 * вести в государственной системе, и двойной ввод её же руками сводит на нет
 * выгоду от продукта. Настоящего обмена за этой заглушкой нет: она принимает
 * записи и ведёт журнал, а адаптер ГИС ЖКХ встаёт на её место без правок
 * прикладного слоя.
 */
export interface MockRegistry extends RegistryGateway {
  /** Что уходило наружу: по журналу видно, что продукт действительно отдаёт. */
  readonly sent: RegistryBatch[];
}

export const createMockRegistry = (channel = 'gis_zhkh'): MockRegistry => {
  const sent: RegistryBatch[] = [];

  return {
    channel,
    model: true,
    sent,

    async push(batch: RegistryBatch): Promise<RegistryReceipt> {
      sent.push(batch);

      return { accepted: batch.records.length };
    },
  };
};
