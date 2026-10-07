import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getOrLoadCached } from "@/lib/api-cache";
import { cachedJson } from "@/lib/api-response";
import {
  parseForceMergeBucket,
  parseForceMergeRange,
  rangeStart,
  type ForceMergeBucket,
  type ForceMergeRange,
} from "@/lib/force-merge-range";

const TTL = 10 * 60_000;
const CDN_CACHE = { maxAge: 600, staleWhileRevalidate: 3_600 };

// Window lengths for the headline force-merge rate cards.
const RATE_WINDOW_DAYS = [7, 30, 90, 365];
const TOP_AUTHOR_COUNT = 15;
const RECENT_COUNT = 50;

function rate(forced: number, total: number): number {
  return total > 0 ? Math.round((1000 * forced) / total) / 10 : 0;
}

async function loadForceMergeSummary(
  range: ForceMergeRange,
  bucket: ForceMergeBucket,
) {
  const db = getDb();
  const start = rangeStart(range, bucket, new Date());
  const step = bucket === "day" ? "1 day" : "1 week";

  const [seriesRaw, windowsRaw, authorsRaw, recentRaw, summaryRaw] =
    await Promise.all([
      // Every bucket in the range, including ones with no merges, so gaps in
      // activity read as gaps rather than being interpolated across.
      db<{ bucket: string; total: number; forced: number }[]>`
        WITH buckets AS (
          SELECT generate_series(
            date_trunc(${bucket}, ${start}::timestamptz AT TIME ZONE 'UTC'),
            date_trunc(${bucket}, now() AT TIME ZONE 'UTC'),
            ${step}::interval
          ) AS bucket
        )
        SELECT b.bucket::date::text AS bucket,
               count(r.pr_number)::int AS total,
               count(r.pr_number) FILTER (WHERE r.force_merged)::int AS forced
        FROM buckets b
        LEFT JOIN force_merge_records r
          ON r.merged_at >= ${start}
         AND date_trunc(${bucket}, r.merged_at AT TIME ZONE 'UTC') = b.bucket
        GROUP BY b.bucket
        ORDER BY b.bucket
      `,
      db<{ days: number; total: number; forced: number }[]>`
        SELECT w.days,
               count(r.*) FILTER (WHERE r.merged_at >= w.cutoff)::int AS total,
               count(r.*) FILTER (WHERE r.merged_at >= w.cutoff AND r.force_merged)::int AS forced
        FROM force_merge_records r
        CROSS JOIN (
          SELECT days, now() - (days || ' days')::interval AS cutoff
          FROM unnest(${RATE_WINDOW_DAYS}::int[]) AS days
        ) w
        GROUP BY w.days
        ORDER BY w.days
      `,
      db<{ author: string; forced: number }[]>`
        SELECT author, count(*)::int AS forced
        FROM force_merge_records
        WHERE force_merged AND author IS NOT NULL AND merged_at >= ${start}
        GROUP BY author
        ORDER BY forced DESC, author
        LIMIT ${TOP_AUTHOR_COUNT}
      `,
      db<{ pr_number: number; title: string; url: string; author: string | null; merged_by: string | null; ci_state: string | null; merged_at: Date }[]>`
        SELECT pr_number, title, url, author, merged_by, ci_state, merged_at
        FROM force_merge_records
        WHERE force_merged AND merged_at >= ${start}
        ORDER BY merged_at DESC
        LIMIT ${RECENT_COUNT}
      `,
      db<{ records: number; first_merged_at: Date | null; refreshed_at: Date | null }[]>`
        SELECT count(*)::int AS records,
               min(merged_at) AS first_merged_at,
               max(fetched_at) AS refreshed_at
        FROM force_merge_records
      `,
    ]);

  const series = seriesRaw.map((row) => ({
    bucket: row.bucket,
    total: row.total,
    forced: row.forced,
    // No merges in the bucket: leave a gap instead of plotting a 0% rate.
    rate: row.total > 0 ? rate(row.forced, row.total) : null,
  }));
  const rangeTotal = series.reduce((sum, row) => sum + row.total, 0);
  const rangeForced = series.reduce((sum, row) => sum + row.forced, 0);
  const summary = summaryRaw[0];

  return {
    range,
    bucket,
    start: start.toISOString(),
    rangeTotals: {
      total: rangeTotal,
      forced: rangeForced,
      rate: rate(rangeForced, rangeTotal),
    },
    windows: windowsRaw.map((row) => ({
      days: row.days,
      total: row.total,
      forced: row.forced,
      rate: rate(row.forced, row.total),
    })),
    series,
    topAuthors: authorsRaw,
    recent: recentRaw.map((row) => ({
      prNumber: row.pr_number,
      title: row.title,
      url: row.url,
      author: row.author,
      mergedBy: row.merged_by,
      ciState: row.ci_state,
      mergedAt: row.merged_at.toISOString(),
    })),
    summary: {
      records: summary?.records ?? 0,
      firstMergedAt: summary?.first_merged_at?.toISOString() ?? null,
      refreshedAt: summary?.refreshed_at?.toISOString() ?? null,
    },
  };
}

// Credential-free reason shown on the page, so a misconfigured deployment
// says what to fix instead of failing silently.
function describeError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "42P01") {
    return "force_merge_records does not exist: apply migration 0028_force_merge_stats.sql to this deployment's database.";
  }
  if (error instanceof Error && error.message === "DATABASE_URL is not set") {
    return "DATABASE_URL is not set for this deployment.";
  }
  return code ? `Database error ${code}.` : "Unexpected error; see function logs.";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const range = parseForceMergeRange(params.get("range"));
  const bucket = parseForceMergeBucket(params.get("bucket"), range);
  try {
    const { data } = await getOrLoadCached(
      `force-merges:summary:${range}:${bucket}`,
      TTL,
      () => loadForceMergeSummary(range, bucket),
    );
    return cachedJson(data, CDN_CACHE);
  } catch (error) {
    console.error("Failed to load force-merge summary:", error);
    return NextResponse.json(
      { error: "Failed to load force-merge summary", detail: describeError(error) },
      { status: 500 },
    );
  }
}
