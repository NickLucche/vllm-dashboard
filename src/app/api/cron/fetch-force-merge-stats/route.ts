import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createGitHubClient,
  dateRangeChunks,
  fetchWindowRecords,
  ingestStartDate,
  upsertForceMergeRecords,
} from "@/lib/force-merge-stats";

export const maxDuration = 55;

// History kept when the table is empty. Later runs resume from the newest
// stored merge, so a backfill spreads across hourly runs.
const BACKFILL_DAYS = 182;
// Stop starting new days after this, leaving headroom under maxDuration for
// the in-flight day's fetch and upsert.
const TIME_BUDGET_MS = 30_000;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN or GH_TOKEN not configured" },
      { status: 500 },
    );
  }

  const startedAt = Date.now();
  try {
    const db = getDb();
    const client = createGitHubClient(token);
    const fetchedAt = new Date();
    const [{ last_merged_at: lastMergedAt }] = await db<
      { last_merged_at: Date | null }[]
    >`SELECT max(merged_at) AS last_merged_at FROM force_merge_records`;

    const days = dateRangeChunks(
      ingestStartDate(lastMergedAt, fetchedAt, BACKFILL_DAYS),
      fetchedAt,
    );
    let fetched = 0;
    let forced = 0;
    let daysDone = 0;
    for (const day of days) {
      if (daysDone > 0 && Date.now() - startedAt > TIME_BUDGET_MS) break;
      const records = await fetchWindowRecords(client, day.start, day.end);
      await upsertForceMergeRecords(db, records, fetchedAt);
      fetched += records.length;
      forced += records.filter((record) => record.forceMerged).length;
      daysDone++;
    }

    const isoDate = (date: Date) => date.toISOString().slice(0, 10);
    return NextResponse.json({
      from: isoDate(days[0].start),
      through: isoDate(days[daysDone - 1].end),
      complete: daysDone === days.length,
      fetched,
      forced,
      fetchedAt: fetchedAt.toISOString(),
    });
  } catch (error) {
    console.error("force-merge-stats fetch failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "fetch failed" },
      { status: 500 },
    );
  }
}
