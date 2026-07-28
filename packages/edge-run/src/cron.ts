/**
 * Cron expression parsing and next-run calculation.
 *
 * Standard 5-field syntax: minute hour day-of-month month day-of-week.
 * Supports wildcards, step values, ranges, ranges with steps, comma lists, and
 * three-letter month and day names. Implemented directly rather than pulled in
 * as a dependency so the scheduling semantics stay auditable.
 */

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** Whether the raw field was `*`, which decides day-matching semantics. */
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

function parseFieldValue(raw: string, min: number, max: number, names: string[]): number {
  const lower = raw.toLowerCase();
  const namedIndex = names.indexOf(lower);
  const value = namedIndex >= 0 ? namedIndex + (names === MONTH_NAMES ? 1 : 0) : Number(raw);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Cron value out of range: "${raw}" (expected ${min}-${max})`);
  }
  return value;
}

function parseField(raw: string, min: number, max: number, names: string[] = []): { values: Set<number>; restricted: boolean } {
  const values = new Set<number>();
  const restricted = raw.trim() !== '*';

  for (const part of raw.split(',')) {
    const segment = part.trim();
    if (!segment) throw new Error(`Empty cron field segment in "${raw}"`);

    const [rangePart, stepPart] = segment.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);

    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid cron step: "${segment}"`);
    }

    let start: number;
    let end: number;

    if (rangePart === '*' || rangePart === undefined) {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [from, to] = rangePart.split('-');
      start = parseFieldValue(from!, min, max, names);
      end = parseFieldValue(to!, min, max, names);
      if (start > end) throw new Error(`Inverted cron range: "${segment}"`);
    } else {
      start = parseFieldValue(rangePart, min, max, names);
      // A bare value with a step means "from this value to the maximum".
      end = stepPart === undefined ? start : max;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  if (values.size === 0) throw new Error(`Cron field matched nothing: "${raw}"`);
  return { values, restricted };
}

export function parseCron(expression: string): CronFields {
  const trimmed = (expression || '').trim();
  if (!trimmed) throw new Error('Cron expression is required');

  const normalised = ALIASES[trimmed.toLowerCase()] ?? trimmed;
  const parts = normalised.split(/\s+/);

  if (parts.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${parts.length}: "${expression}"`);
  }

  const minute = parseField(parts[0]!, 0, 59);
  const hour = parseField(parts[1]!, 0, 23);
  const dayOfMonth = parseField(parts[2]!, 1, 31);
  const month = parseField(parts[3]!, 1, 12, MONTH_NAMES);
  const dayOfWeek = parseField(parts[4]!, 0, 7, DAY_NAMES);

  // Cron allows 7 for Sunday; normalise it onto 0.
  if (dayOfWeek.values.has(7)) {
    dayOfWeek.values.delete(7);
    dayOfWeek.values.add(0);
  }

  return {
    minute: minute.values,
    hour: hour.values,
    dayOfMonth: dayOfMonth.values,
    month: month.values,
    dayOfWeek: dayOfWeek.values,
    dayOfMonthRestricted: dayOfMonth.restricted,
    dayOfWeekRestricted: dayOfWeek.restricted,
  };
}

export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Does this date match the schedule?
 *
 * When both day-of-month and day-of-week are restricted, cron matches if
 * *either* matches — a long-standing quirk of the format that schedules like
 * "1st of the month or any Monday" depend on.
 */
function matches(fields: CronFields, date: Date): boolean {
  if (!fields.minute.has(date.getMinutes())) return false;
  if (!fields.hour.has(date.getHours())) return false;
  if (!fields.month.has(date.getMonth() + 1)) return false;

  const domMatch = fields.dayOfMonth.has(date.getDate());
  const dowMatch = fields.dayOfWeek.has(date.getDay());

  if (fields.dayOfMonthRestricted && fields.dayOfWeekRestricted) return domMatch || dowMatch;
  if (fields.dayOfMonthRestricted) return domMatch;
  if (fields.dayOfWeekRestricted) return dowMatch;
  return true;
}

/**
 * Next time the expression fires, strictly after `from`.
 *
 * Steps coarsely — skipping whole months, days and hours that cannot match —
 * so this stays fast even for sparse schedules like "0 0 29 2 *".
 */
export function nextRun(expression: string, from: Date = new Date()): Date {
  const fields = parseCron(expression);

  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Four years covers any schedule that can fire at all, including Feb 29.
  const limit = new Date(candidate.getTime());
  limit.setFullYear(limit.getFullYear() + 4);

  while (candidate <= limit) {
    if (!fields.month.has(candidate.getMonth() + 1)) {
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    const domMatch = fields.dayOfMonth.has(candidate.getDate());
    const dowMatch = fields.dayOfWeek.has(candidate.getDay());
    const dayMatches =
      fields.dayOfMonthRestricted && fields.dayOfWeekRestricted
        ? domMatch || dowMatch
        : fields.dayOfMonthRestricted
          ? domMatch
          : fields.dayOfWeekRestricted
            ? dowMatch
            : true;

    if (!dayMatches) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }

    if (!fields.hour.has(candidate.getHours())) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }

    if (!fields.minute.has(candidate.getMinutes())) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
      continue;
    }

    if (matches(fields, candidate)) return new Date(candidate.getTime());

    candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
  }

  throw new Error(`Cron expression never fires within four years: "${expression}"`);
}
