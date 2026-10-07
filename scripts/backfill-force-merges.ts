/**
 * One-off backfill of force_merge_records. The hourly cron only runs on the
 * production deployment and ingests about three days per run, so a fresh
 * database (or a preview pointed at one) shows no data until this runs.
 *
 *   DATABASE_URL=postgres://... GITHUB_TOKEN=$(gh auth token) \
 *     npm run backfill:force-merges -- [--since 2025-10-01] [--dry-run]
 */
import postgres from "postgres";
import {
  createGitHubClient,
  dateRangeChunks,
  fetchWindowRecords,
  HISTORY_START,
  upsertForceMergeRecords,
} from "../src/lib/force-merge-stats";

// Days fetched in parallel; each issues serial GraphQL search pages.
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sinceArg = args.indexOf("--since");
const since =
  sinceArg >= 0 ? new Date(`${args[sinceArg + 1]}T00:00:00Z`) : HISTORY_START;
if (Number.isNaN(since.getTime())) {
  throw new Error(`--since must be YYYY-MM-DD, got ${args[sinceArg + 1]}`);
}

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN or GH_TOKEN is not set");
if (!dryRun && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (or pass --dry-run)");
}

const db = dryRun
  ? null
  : postgres(process.env.DATABASE_URL!, { ssl: "require", prepare: false, max: CONCURRENCY });
const client = createGitHubClient(token);
const now = new Date();
const chunks = dateRangeChunks(since, now);

let next = 0;
let fetched = 0;
let forced = 0;

async function worker() {
  while (next < chunks.length) {
    const day = chunks[next++];
    const records = await fetchWindowRecords(client, day.start, day.end);
    if (db) await upsertForceMergeRecords(db, records, new Date());
    const dayForced = records.filter((record) => record.forceMerged).length;
    fetched += records.length;
    forced += dayForced;
    console.log(
      `${day.start.toISOString().slice(0, 10)}: ${records.length} merged, ${dayForced} force-merged`,
    );
  }
}

async function main() {
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(
      `${dryRun ? "[dry-run] " : ""}${chunks.length} days, ${fetched} merged PRs, ${forced} force-merged`,
    );
  } finally {
    await db?.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
