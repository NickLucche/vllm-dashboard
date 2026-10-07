import assert from "node:assert/strict";
import test from "node:test";
import {
  bucketOptions,
  parseForceMergeBucket,
  parseForceMergeRange,
  rangeStart,
} from "./force-merge-range";

test("parseForceMergeRange falls back to 90d for missing or unknown values", () => {
  assert.equal(parseForceMergeRange("7d"), "7d");
  assert.equal(parseForceMergeRange(null), "90d");
  assert.equal(parseForceMergeRange("1d"), "90d");
  assert.equal(parseForceMergeRange("toString"), "90d");
});

test("bucket defaults to daily except for a year, and 7d is daily only", () => {
  assert.deepEqual(bucketOptions("7d"), ["day"]);
  assert.equal(parseForceMergeBucket(null, "30d"), "day");
  assert.equal(parseForceMergeBucket(null, "1y"), "week");
  assert.equal(parseForceMergeBucket("day", "1y"), "day");
  assert.equal(parseForceMergeBucket("week", "7d"), "day");
});

test("rangeStart covers whole UTC days and aligns weekly ranges to Monday", () => {
  const now = new Date("2026-10-07T21:00:00Z"); // Wednesday
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  assert.equal(iso(rangeStart("7d", "day", now)), "2026-10-01");
  assert.equal(iso(rangeStart("30d", "day", now)), "2026-09-08");
  // 2026-09-08 is a Tuesday; its week starts Monday 2026-09-07.
  assert.equal(iso(rangeStart("30d", "week", now)), "2026-09-07");
});
