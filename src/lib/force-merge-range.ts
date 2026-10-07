/** Time ranges and chart granularity for the force-merges page. */

export const FORCE_MERGE_RANGES = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
} as const;
export type ForceMergeRange = keyof typeof FORCE_MERGE_RANGES;
export type ForceMergeBucket = "day" | "week";

export const DEFAULT_FORCE_MERGE_RANGE: ForceMergeRange = "90d";

const DAY_MS = 86_400_000;

export function parseForceMergeRange(value: string | null): ForceMergeRange {
  return value !== null && Object.hasOwn(FORCE_MERGE_RANGES, value)
    ? (value as ForceMergeRange)
    : DEFAULT_FORCE_MERGE_RANGE;
}

/** Weekly buckets need at least two weeks; a year defaults to weekly. */
export function bucketOptions(range: ForceMergeRange): ForceMergeBucket[] {
  return range === "7d" ? ["day"] : ["day", "week"];
}

export function parseForceMergeBucket(
  value: string | null,
  range: ForceMergeRange,
): ForceMergeBucket {
  const options = bucketOptions(range);
  if (value !== null && (options as string[]).includes(value)) {
    return value as ForceMergeBucket;
  }
  return range === "1y" ? "week" : "day";
}

/**
 * Inclusive UTC start of the range: the first of `days` whole days ending
 * today, widened back to that week's Monday for weekly buckets so the first
 * bucket is not partial.
 */
export function rangeStart(
  range: ForceMergeRange,
  bucket: ForceMergeBucket,
  now: Date,
): Date {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const start = new Date(today - (FORCE_MERGE_RANGES[range] - 1) * DAY_MS);
  if (bucket === "day") return start;
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  return new Date(start.getTime() - daysSinceMonday * DAY_MS);
}
