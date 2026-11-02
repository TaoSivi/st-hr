export interface Settlement {
  dailyRate: number; // ກີບ per working day
  annualDays: number; // unused annual leave days at the end date (never negative: overdrawn leave is not recovered here)
  compDays: number; // unused compensatory days off at the end date
  amount: number; // what is paid out; 0 when Settings say unused leave is not paid out
}

/**
 * Final pay for leave not taken when someone leaves: unused annual days and unused compensatory days,
 * each at one day's pay (monthly salary ÷ working days in a month). A setting turns the payout off, in which case the days are
 * still reported but the amount is 0.
 */
export function finalSettlement(p: { baseSalary: number; annualLeft: number; compLeft: number; workingDaysInMonth: number; payOut: boolean }): Settlement {
  const daily = p.workingDaysInMonth > 0 ? p.baseSalary / p.workingDaysInMonth : 0;
  const annualDays = Math.max(0, Math.round(p.annualLeft * 100) / 100);
  const compDays = Math.max(0, Math.round(p.compLeft * 100) / 100);
  return { dailyRate: Math.round(daily), annualDays, compDays, amount: p.payOut ? Math.round((annualDays + compDays) * daily) : 0 };
}
