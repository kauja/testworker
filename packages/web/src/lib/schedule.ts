export function validateCronExpression(cron: string): { ok: boolean; error: string | null } {
  try {
    nextFireTime(cron, new Date());
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function nextFireTime(cron: string, after: Date): Date {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error('cron must have 5 fields');
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map((field, index) =>
    parseField(field ?? '', index),
  );
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 366; i += 1) {
    if (
      minute!.has(cursor.getUTCMinutes()) &&
      hour!.has(cursor.getUTCHours()) &&
      dayOfMonth!.has(cursor.getUTCDate()) &&
      month!.has(cursor.getUTCMonth() + 1) &&
      dayOfWeek!.has(cursor.getUTCDay())
    ) {
      return new Date(cursor);
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error('no next fire time found');
}

function parseField(raw: string, index: number): Set<number> {
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ] as const;
  const [min, max] = ranges[index]!;
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const [rangeRaw, stepRaw] = part.split('/');
    const step = stepRaw == null ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new Error('invalid cron step');
    const [start, end] =
      rangeRaw === '*'
        ? [min, max]
        : rangeRaw?.includes('-')
          ? rangeRaw.split('-').map(Number)
          : [Number(rangeRaw), Number(rangeRaw)];
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      throw new Error('cron value out of range');
    }
    for (let value = start; value <= end; value += step) {
      out.add(index === 4 && value === 7 ? 0 : value);
    }
  }
  return out;
}
