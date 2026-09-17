import type { Reasoner } from './reasoner.js';
import { formatReport, type BuildingReport } from './report.js';

/** Сколько знаков берём у пересказа: длиннее сводки он быть не должен. */
const SUMMARY_MAX = 400;

/** Числа строки: по ним пересказ сверяется со сводкой. */
const numbers = (text: string): string[] => text.match(/\d+/g) ?? [];

/**
 * Пересказ, который расходится со сводкой, показывать нельзя: смена принимает
 * по нему решения. Отбрасываем ответ, если в нём есть число, которого в сводке
 * нет, или обобщение о сроках, когда часть работ сдана с опозданием.
 */
const grounded = (said: string, report: BuildingReport, facts: string): boolean => {
  const known = new Set(numbers(facts));

  if (numbers(said).some((value) => !known.has(value))) return false;

  const missed = report.period.closed > 0 && report.period.inTimeRate < 1;

  return !(missed && /(все|всё|все[хм]?)\s+[^.]*в(?:о)?\s*время|без\s+просроч|все\s+в\s+срок/i.test(said));
};

/** Пересказ сводки словами. Без модели и при её отказе возвращается пусто. */
export const summariseReport = async (report: BuildingReport, reasoner?: Reasoner): Promise<string | undefined> => {
  if (!reasoner?.digest) return undefined;

  const facts = formatReport(report);
  const said = await reasoner.digest(facts).catch(() => undefined);
  const text = typeof said === 'string' ? said.trim().replace(/\s+/g, ' ') : '';

  if (text.length === 0 || text.length > SUMMARY_MAX) return undefined;

  return grounded(text, report, facts) ? text : undefined;
};
