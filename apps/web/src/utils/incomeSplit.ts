/**
 * Which of a month's income is salary, and which is extra income.
 *
 * The same rule the server uses for the month card (routers/income.py,
 * salary-usage): an income is salary when its description mentions one of the
 * salary sources the user set up, or the word "salary". Everything else is
 * extra income - money from people, refunds, rewards. Kept identical so the
 * list that opens from the card always adds up to the figures on it.
 */
export const isSalaryIncome = (description: string | null | undefined, salarySources: string[]): boolean => {
  const text = (description ?? '').trim().toLowerCase();
  return (
    salarySources.some((source) => {
      const s = source.trim().toLowerCase();
      return s !== '' && text.includes(s);
    }) || text.includes('salary')
  );
};
