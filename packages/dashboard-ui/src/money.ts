/**
 * Rendering a signed cost without changing what it says.
 *
 * A record carries an integer number of minor units and a currency code — 1420
 * and `USD`. Turning that into "$14.20" looks like formatting and is actually a
 * small arithmetic claim: it asserts that this currency has two decimal places.
 * Most do. JPY has none, and dividing a yen figure by 100 quietly reports a bill
 * as one percent of itself.
 *
 * So the exponent is asked of `Intl` rather than assumed, and a currency the
 * runtime does not recognise is rendered as the integer beside its code instead
 * of being scaled by a guess. An unfamiliar code should read as unfamiliar, not
 * as a confident and wrong amount.
 */

/** How many decimal places this currency has, according to the runtime. */
function minorUnitDigits(currency: string): number | null {
  try {
    const format = new Intl.NumberFormat('en', { style: 'currency', currency });
    const resolved = format.resolvedOptions();
    // An unknown code throws above; a recognised one always resolves a digit
    // count. `??` rather than a default, so a missing value is not read as 2.
    return resolved.maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

/**
 * A signed cost, as text. Never rounded, never converted, never combined.
 *
 * `1420, 'USD'` → `$14.20`. `1420, 'XYZ'` → `1420 XYZ`, because scaling a code
 * nothing recognises would be inventing a decimal point.
 */
export function formatMoney(amountMinorUnits: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  if (digits === null) return `${amountMinorUnits.toLocaleString('en-US')} ${currency}`;

  const major = amountMinorUnits / 10 ** digits;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${amountMinorUnits.toLocaleString('en-US')} ${currency}`;
  }
}

/**
 * Several currencies, side by side and never added together.
 *
 * The separator is a space rather than a `+`, because a plus sign invites the
 * reader to do the addition that no record here supports: nothing carries an
 * exchange rate, so there is no total.
 */
export function formatMoneyList(totals: { currency: string; amount: number }[]): string {
  return totals.map(total => formatMoney(total.amount, total.currency)).join('  ');
}
