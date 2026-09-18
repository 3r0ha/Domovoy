import { dayIn, hourIn } from '@domovoy/domain';

import { remindAboutDebt } from './debt.js';
import { sendMorningDigest } from './digest.js';
import { remindAboutHouseMeters } from './house-meters.js';
import {
  closeAcceptedBySilence,
  remindAboutAcceptance,
  remindAboutOverdue,
  remindAboutWorks,
  warnAboutDeadlines,
} from './incidents.js';
import { planInspections } from './inspections.js';
import { remindAboutReadings } from './meters.js';
import { closeDuePolls, remindAboutPolls } from './voting.js';

import { zoneOf } from './zone.js';
import type { AppDeps } from './use-cases.js';

/** Суточные напоминания одного дома: день, в который каждое уже ушло. */
export interface SweepDays {
  readings?: string;
  polls?: string;
  debt?: string;
  digest?: string;
}

/** Чем закончился предыдущий обход. */
export interface SweepState {
  /** До какого момента заявки уже просмотрены. */
  checkedUntil?: string;
  /** До какого момента просмотрены работы каждого дома. */
  worksUntil?: Record<string, string>;
  /** Отметки по домам: у каждого свой календарь и своё утро. */
  houses?: Record<string, SweepDays>;
}

export interface SweepStore {
  load(): Promise<SweepState>;
  save(state: SweepState): Promise<void>;
}

export interface SweepReport {
  works: number;
  acceptance: number;
  closed: number;
  warned: number;
  overdue: number;
  polls: number;
  readings: number;
  houseMeters: number;
  pollReminders: number;
  debtors: number;
  digests: number;
  inspections: number;
  /** Что не получилось за обход. */
  failures: { job: string; error: unknown }[];
}

export interface SweepOptions {
  store?: SweepStore;
  /** Час, с которого смене уходит сводка за ночь. */
  digestHour?: number;
  /** Час, раньше которого жильцу не пишут: напоминания не будят людей ночью. */
  remindHour?: number;
  /** Не даёт двум репликам сделать одну и ту же рассылку. */
  lockKey?: string;
}

const DIGEST_HOUR = 8;

/** Раньше этого часа суточные напоминания жильцу не уходят. */
const REMIND_HOUR = 9;

const memoryStore = (): SweepStore => {
  let state: SweepState = {};
  return { load: async () => state, save: async (next) => void (state = next) };
};

const empty = (): SweepReport => ({
  works: 0,
  acceptance: 0,
  closed: 0,
  warned: 0,
  overdue: 0,
  polls: 0,
  readings: 0,
  houseMeters: 0,
  pollReminders: 0,
  debtors: 0,
  digests: 0,
  inspections: 0,
  failures: [],
});

/** Один обход: падение одной рассылки не отменяет остальные. */
export const createSweeper = (deps: AppDeps, options: SweepOptions = {}) => {
  const store = options.store ?? memoryStore();
  const digestHour = options.digestHour ?? DIGEST_HOUR;
  const remindHour = options.remindHour ?? REMIND_HOUR;
  let running: Promise<SweepReport> | undefined;

  const pass = async (): Promise<SweepReport> => {
    const report = empty();
    const state = await store.load();
    const next: SweepState = { ...state };
    const now = deps.now();
    const since = state.checkedUntil ? new Date(state.checkedUntil) : now;

    const buildings = await deps.repository.listBuildings();
    const houses = buildings.length > 0 ? buildings.map((building) => building.id) : [deps.defaultBuildingId];

    next.houses = { ...state.houses };

    /** Отметка дня ставится только после удачной рассылки. */
    const attempt = async (job: string, run: () => Promise<void>): Promise<boolean> => {
      try {
        await run();
        return true;
      } catch (error: unknown) {
        report.failures.push({ job, error });
        return false;
      }
    };

    next.worksUntil = { ...state.worksUntil };

    /**
     * Предупреждения о работах одного дома. Отметка у каждого дома своя:
     * падение на одном не заставляет остальные рассылать уже отправленное
     * заново. Дом, который обойти не удалось, запоминает своё окно: общая
     * отметка к этому времени уже ушла вперёд.
     */
    const works = async (house: string): Promise<void> => {
      const from = new Date(state.worksUntil?.[house] ?? state.checkedUntil ?? now.toISOString());
      const ok = await attempt('works', async () => {
        report.works += (await remindAboutWorks(deps, house, from)).length;
      });

      next.worksUntil = { ...next.worksUntil, [house]: (ok ? now : from).toISOString() };
    };

    /** Суточные рассылки одного дома: сутки и утро считаются по его календарю. */
    const daily = async (house: string): Promise<void> => {
      const zone = await zoneOf(deps, house);
      const today = dayIn(now, zone);
      const done = state.houses?.[house] ?? {};
      // Показания, собрания и долг это не срочно: они ждут утра по времени дома.
      const daytime = hourIn(now, zone) >= remindHour;
      const mark = (job: keyof SweepDays): void => {
        next.houses = { ...next.houses, [house]: { ...next.houses?.[house], [job]: today } };
      };

      if (done.readings !== today && daytime) {
        let sent = 0;

        const ok = await attempt('readings', async () => {
          sent += (await remindAboutReadings(deps, house)).length;
          sent += (await remindAboutHouseMeters(deps, house)).length;
        });

        report.readings += sent;

        if (ok && sent > 0) mark('readings');
      }

      if (done.polls !== today && daytime) {
        const ok = await attempt('polls', async () => {
          report.pollReminders += (await remindAboutPolls(deps, house)).length;
        });

        if (ok) mark('polls');
      }

      if (done.debt !== today && daytime) {
        const ok = await attempt('debt', async () => {
          report.debtors += (await remindAboutDebt(deps, house)).length;
        });

        if (ok) mark('debt');
      }

      if (done.digest !== today && hourIn(now, zone) >= digestHour) {
        const ok = await attempt('digest', async () => {
          report.digests += (await sendMorningDigest(deps, house)).length;
          report.inspections += (await planInspections(deps, house)).length;
        });

        if (ok) mark('digest');
      }
    };

    for (const house of houses) await works(house);

    const window = await attempt('window', async () => {
      report.acceptance = (await remindAboutAcceptance(deps, since)).length;
      report.warned = (await warnAboutDeadlines(deps, since)).length;
      report.overdue = (await remindAboutOverdue(deps, since)).length;
    });

    if (window) next.checkedUntil = now.toISOString();

    await attempt('closing', async () => {
      report.closed = (await closeAcceptedBySilence(deps)).length;
      report.polls = (await closeDuePolls(deps)).length;
    });

    for (const house of houses) await daily(house);

    await store.save(next);
    return report;
  };

  const guarded = async (): Promise<SweepReport> =>
    deps.lock && options.lockKey ? deps.lock(options.lockKey, pass) : pass();

  return {
    /** Обходы не накладываются: медленный проход не запускает второй. */
    run: async (): Promise<SweepReport> => {
      running ??= guarded().finally(() => void (running = undefined));
      return running;
    },
  };
};
