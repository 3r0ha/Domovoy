import type { Building } from './repository.js';

/**
 * Сведения о капитальном ремонте дома: они ведутся не управляющей организацией,
 * а региональной программой, и лежат в ГИС ЖКХ и у регионального оператора.
 * Продукт их только показывает, поэтому источник вынесен за порт. В MVP
 * подключение модельное: данные типовые, настоящего обмена за ним нет.
 */
export interface CapitalRepairDirectory {
  /** Как источник называется человеку. */
  readonly title: string;
  /** Обмен модельный: это видно рядом с данными. */
  readonly model: boolean;
  /** План по дому. Пусто, если дома в программе нет. */
  planFor(buildingId: string, building?: Building): Promise<CapitalRepairPlan | undefined>;
}

export interface CapitalRepairWork {
  /** Что делают: крыша, лифты, фасад, инженерные сети. */
  title: string;
  /** Год по региональной программе. */
  year: number;
  state: 'planned' | 'running' | 'done';
  /** Что известно о ходе работ: подрядчик, сроки, приёмка. */
  note?: string;
}

export interface CapitalRepairPlan {
  /** Где дом собирает деньги: счёт регионального оператора или свой счёт. */
  fund: 'regional' | 'own';
  /** Взнос за квадратный метр в месяц. */
  contribution: number;
  /** Сколько дом накопил. */
  balance?: number;
  works: CapitalRepairWork[];
  /** Кто ведёт программу: региональный оператор или владелец счёта. */
  operator?: string;
}

export interface MockCapitalRepairOptions {
  title?: string;
  /** Текущий год: от него считается ближайший вид работ. */
  year?: number;
}

/**
 * Модельные сведения о капитальном ремонте: типовой план и взнос. Настоящие
 * приходят из региональной программы, и там же меняются сроки.
 */
export const createMockCapitalRepair = (options: MockCapitalRepairOptions = {}): CapitalRepairDirectory => {
  const year = options.year ?? 2026;

  return {
    title: options.title ?? 'Региональная программа капитального ремонта',
    model: true,
    async planFor(_buildingId, building) {
      return {
        fund: 'regional',
        contribution: 11.9,
        balance: 1_284_000,
        operator: 'Региональный оператор капитального ремонта',
        works: [
          { title: 'Ремонт крыши', year: year + 1, state: 'planned' },
          { title: 'Замена лифтов', year: year + 4, state: 'planned' },
          { title: 'Ремонт фасада', year: year + 9, state: 'planned' },
          {
            title: 'Ремонт системы электроснабжения',
            year: year - 3,
            state: 'done',
            ...(building?.address ? { note: `Работы приняты по адресу ${building.address}` } : {}),
          },
        ],
      };
    },
  };
};
