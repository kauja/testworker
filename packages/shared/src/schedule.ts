export interface CronValidation {
  ok: boolean;
  error: string | null;
}

type CronField = Set<number>;

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export function validateCronExpression(cron: string): CronValidation {
  try {
    parseCron(cron);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function nextFireTime(cron: string, after: Date, maxMinutes = 60 * 24 * 366): Date {
  const parsed = parseCron(cron);
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let i = 0; i < maxMinutes; i += 1) {
    if (matchesCron(parsed, cursor)) return new Date(cursor);
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error(`no fire time found for cron within ${maxMinutes} minutes`);
}

function parseCron(cron: string): ParsedCron {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error('cron must have 5 fields: minute hour day-of-month month day-of-week');
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return {
    minute: parseField(minute!, 0, 59, 'minute'),
    hour: parseField(hour!, 0, 23, 'hour'),
    dayOfMonth: parseField(dayOfMonth!, 1, 31, 'day-of-month'),
    month: parseField(month!, 1, 12, 'month'),
    dayOfWeek: parseField(dayOfWeek!, 0, 7, 'day-of-week'),
  };
}

function parseField(raw: string, min: number, max: number, label: string): CronField {
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    addPart(out, part.trim(), min, max, label);
  }
  if (out.size === 0) throw new Error(`${label} has no values`);
  return out;
}

function addPart(out: CronField, raw: string, min: number, max: number, label: string): void {
  if (!raw) throw new Error(`${label} contains an empty segment`);
  const [rangeRaw, stepRaw] = raw.split('/');
  const step = stepRaw == null ? 1 : Number(stepRaw);
  if (!Number.isInteger(step) || step < 1) throw new Error(`${label} step must be >= 1`);

  let start: number;
  let end: number;
  if (rangeRaw === '*') {
    start = min;
    end = max;
  } else if (rangeRaw?.includes('-')) {
    const [a, b] = rangeRaw.split('-').map(Number);
    start = a ?? Number.NaN;
    end = b ?? Number.NaN;
  } else {
    start = Number(rangeRaw);
    end = start;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < min ||
    end > max ||
    start > end
  ) {
    throw new Error(`${label} value out of range`);
  }
  for (let value = start; value <= end; value += step) {
    out.add(label === 'day-of-week' && value === 7 ? 0 : value);
  }
}

function matchesCron(parsed: ParsedCron, date: Date): boolean {
  return (
    parsed.minute.has(date.getUTCMinutes()) &&
    parsed.hour.has(date.getUTCHours()) &&
    parsed.dayOfMonth.has(date.getUTCDate()) &&
    parsed.month.has(date.getUTCMonth() + 1) &&
    parsed.dayOfWeek.has(date.getUTCDay())
  );
}
