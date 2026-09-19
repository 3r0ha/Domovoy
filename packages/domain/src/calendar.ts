/** Календарная арифметика без привязки к формату: считается по UTC. */

/** Сколько дней в месяце. Месяц задаётся числом от 1 до 12. */
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Дата через несколько лет. Двадцать девятое февраля в невисокосном году
 * становится двадцать восьмым, а не первым марта: иначе срок переползает
 * в следующий месяц.
 */
export const addYears = (at: Date, years: number): Date => {
  const moved = new Date(at.getTime());
  const day = moved.getUTCDate();

  moved.setUTCFullYear(moved.getUTCFullYear() + years);

  // Число не сохранилось, значит, в новом месяце его нет: откатываемся на его конец.
  if (moved.getUTCDate() !== day) moved.setUTCDate(0);

  return moved;
};
