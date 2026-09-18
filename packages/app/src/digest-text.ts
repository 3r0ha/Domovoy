import type { Reasoner } from './reasoner.js';
import { formatReport, type BuildingReport } from './report.js';

/** Сколько знаков берём у пересказа: длиннее сводки он быть не должен. */
const SUMMARY_MAX = 400;

/** Числа строки: по ним пересказ сверяется со сводкой. */
const numbers = (text: string): string[] => text.match(/\d+/g) ?? [];

/** Доли: «57%» и «57 %» считаются одним и тем же. */
const percents = (text: string): string[] => (text.match(/\d+\s*%/g) ?? []).map((value) => value.replace(/\s+/g, ''));

/** Пары вида «7 из 17»: число само по себе верно, а пара может быть выдумана. */
const pairs = (text: string): string[] =>
  (text.match(/\d+\s+из\s+\d+/g) ?? []).map((value) => value.replace(/\s+/g, ' '));

/**
 * Пересказ, который расходится со сводкой, показывать нельзя: смена принимает
 * по нему решения. Отбрасываем ответ, если в нём есть число, которого в сводке
 * нет, или обобщение о сроках, когда часть работ сдана с опозданием. Доли и
 * пары сверяются целиком: из чисел сводки складывается доля, которой в ней нет.
 */
const grounded = (said: string, report: BuildingReport, facts: string): boolean => {
  const known = new Set(numbers(facts));

  if (numbers(said).some((value) => !known.has(value))) return false;

  const knownPercents = new Set(percents(facts));

  if (percents(said).some((value) => !knownPercents.has(value))) return false;

  const knownPairs = new Set(pairs(facts));

  if (pairs(said).some((value) => !knownPairs.has(value))) return false;

  const missed = report.period.closed > 0 && report.period.inTimeRate < 1;

  return !(missed && /(все|всё|все[хм]?)\s+[^.]*в(?:о)?\s*время|без\s+просроч|все\s+в\s+срок/i.test(said));
};

/** Пересказ сводки словами. Без модели и при её отказе возвращается пусто. */
export const summariseReport = async (report: BuildingReport, reasoner?: Reasoner): Promise<string | undefined> => {
  if (!reasoner?.digest) return undefined;

  const facts = formatReport(report);
  const said = await reasoner.digest(facts).catch(() => undefined);
  // Длинное тире модель ставит и там, где её просят не ставить: меняем на дефис.
  const text = typeof said === 'string' ? said.trim().replace(/\s+/g, ' ').replace(/[—–]/g, '-') : '';

  if (text.length === 0 || text.length > SUMMARY_MAX) return undefined;

  return grounded(text, report, facts) ? text : undefined;
};
