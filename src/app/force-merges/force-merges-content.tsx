"use client";

import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SegmentedControl } from "@/components/segmented-control";
import { StatCard } from "@/components/stat-card";
import {
  bucketOptions,
  FORCE_MERGE_RANGES,
  parseForceMergeBucket,
  parseForceMergeRange,
  type ForceMergeBucket,
  type ForceMergeRange,
} from "@/lib/force-merge-range";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface WindowStat {
  days: number;
  total: number;
  forced: number;
  rate: number;
}

interface SeriesPoint {
  bucket: string;
  total: number;
  forced: number;
  rate: number | null;
}

interface TopAuthor {
  author: string;
  forced: number;
}

interface RecentPr {
  prNumber: number;
  title: string;
  url: string;
  author: string | null;
  mergedBy: string | null;
  ciState: string | null;
  mergedAt: string;
}

interface ForceMergeResponse {
  rangeTotals: { total: number; forced: number; rate: number };
  windows: WindowStat[];
  series: SeriesPoint[];
  topAuthors: TopAuthor[];
  recent: RecentPr[];
  summary: {
    records: number;
    firstMergedAt: string | null;
    refreshedAt: string | null;
  };
  error?: string;
  detail?: string;
}

const WINDOW_LABELS: Record<number, string> = {
  7: "Last 7 days",
  30: "Last 30 days",
  90: "Last 90 days",
  365: "Last 12 months",
};

const RANGE_LABELS: Record<ForceMergeRange, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
};

const BUCKET_LABELS: Record<ForceMergeBucket, string> = {
  day: "Daily",
  week: "Weekly",
};

const FORCED_COLOR = "#fb923c";
const NORMAL_COLOR = "#34d399";

function bucketLabel(bucket: string): string {
  return new Date(`${bucket}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function bucketTooltipLabel(bucket: string, granularity: ForceMergeBucket) {
  return granularity === "week"
    ? `Week of ${bucketLabel(bucket)}`
    : new Date(`${bucket}T00:00:00Z`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    name?: string | number;
    value?: number | string | readonly (string | number)[];
    color?: string;
  }>;
  label?: string;
  formatValue: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((entry) => (
        <div
          key={String(entry.name)}
          className="flex items-center justify-between gap-6"
        >
          <span style={{ color: entry.color }}>{String(entry.name)}</span>
          <span className="font-medium tabular-nums">
            {formatValue(Number(entry.value ?? 0))}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ForceMergesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = parseForceMergeRange(searchParams.get("range"));
  const bucket = parseForceMergeBucket(searchParams.get("bucket"), range);

  const updateParams = (next: { range?: ForceMergeRange; bucket?: ForceMergeBucket }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.range) {
      params.set("range", next.range);
      // Let the new range pick its default granularity.
      params.delete("bucket");
    }
    if (next.bucket) params.set("bucket", next.bucket);
    router.replace(`/force-merges?${params.toString()}`, { scroll: false });
  };

  const { data, error, isLoading } = useSWR<ForceMergeResponse>(
    `/api/force-merges?range=${range}&bucket=${bucket}`,
    fetcher,
    { keepPreviousData: true },
  );

  if (isLoading && !data) {
    return (
      <div className="flex h-64 items-center justify-center text-zinc-400">
        Loading force-merge data...
      </div>
    );
  }

  if (error || data?.error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-red-400">
        <p>Failed to load force-merge data.</p>
        {data?.detail && <p className="text-sm text-zinc-500">{data.detail}</p>}
      </div>
    );
  }

  const {
    windows = [],
    series = [],
    topAuthors = [],
    recent = [],
    rangeTotals,
    summary,
  } = data ?? {};
  const hasData = (summary?.records ?? 0) > 0;
  const volumeData = series.map((point) => ({
    ...point,
    normal: point.total - point.forced,
  }));
  const granularity = BUCKET_LABELS[bucket];
  const rangeLabel = RANGE_LABELS[range];
  const tooltipLabel = (label: unknown) =>
    label ? bucketTooltipLabel(String(label), bucket) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Force-merges</h1>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">
          How often pull requests in{" "}
          <a
            href="https://github.com/vllm-project/vllm"
            target="_blank"
            rel="noopener"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            vllm-project/vllm
          </a>{" "}
          are force-merged, overriding CI.
        </p>
        <p className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          A <strong>force-merge</strong> is a PR merged while the{" "}
          <code>buildkite/ci/pr</code> status on its head commit was red
          (failed or errored), whoever performed the merge. The status is read
          as of the merge, so a PR merged while a CI rerun was still running,
          or before CI ever reported, does not count, and a build that fails
          after the merge does not turn it into one.
        </p>
      </div>

      {!hasData && (
        <div className="flex h-40 items-center justify-center text-zinc-400">
          No force-merge records yet. The hourly ingest cron has not run or
          found no merged PRs.
        </div>
      )}

      {hasData && (
        <>
          {/* Rate cards */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {windows.map((w) => (
              <StatCard
                key={w.days}
                label={WINDOW_LABELS[w.days] ?? `Last ${w.days} days`}
                value={`${w.rate.toFixed(1)}%`}
                detail={`${w.forced} of ${w.total} PRs`}
                color="red"
              />
            ))}
          </div>

          {/* Range controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Last {rangeLabel}:{" "}
              <span className="font-semibold text-red-500 tabular-nums dark:text-red-400">
                {(rangeTotals?.rate ?? 0).toFixed(1)}%
              </span>{" "}
              force-merged ({rangeTotals?.forced ?? 0} of{" "}
              {rangeTotals?.total ?? 0} PRs)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl<ForceMergeRange>
                label="Time range"
                value={range}
                onChange={(value) => updateParams({ range: value })}
                options={(
                  Object.keys(FORCE_MERGE_RANGES) as ForceMergeRange[]
                ).map((value) => ({ value, label: value }))}
              />
              <SegmentedControl<ForceMergeBucket>
                label="Granularity"
                value={bucket}
                onChange={(value) => updateParams({ bucket: value })}
                options={bucketOptions(range).map((value) => ({
                  value,
                  label: BUCKET_LABELS[value],
                }))}
              />
            </div>
          </div>

          {/* Force-merge rate */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">
              {granularity} force-merge rate
            </h2>
            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#8884" />
                    <XAxis
                      dataKey="bucket"
                      tickFormatter={bucketLabel}
                      tick={{ fontSize: 12 }}
                      minTickGap={16}
                    />
                    <YAxis
                      tickFormatter={(v: number) => `${v}%`}
                      tick={{ fontSize: 12 }}
                      width={44}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => (
                        <ChartTooltip
                          active={active}
                          payload={payload}
                          label={tooltipLabel(label)}
                          formatValue={(v) => `${v.toFixed(1)}%`}
                        />
                      )}
                    />
                    <Line
                      type="linear"
                      dataKey="rate"
                      name="Force-merged"
                      stroke={FORCED_COLOR}
                      strokeWidth={2}
                      dot={series.length <= 45 ? { r: 2 } : false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Weekly merge volume */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">
              {granularity} merge volume
            </h2>
            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volumeData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#8884" />
                    <XAxis
                      dataKey="bucket"
                      tickFormatter={bucketLabel}
                      tick={{ fontSize: 12 }}
                      minTickGap={16}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickFormatter={(v: number) => `${v}`}
                      tick={{ fontSize: 12 }}
                      width={44}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => (
                        <ChartTooltip
                          active={active}
                          payload={payload}
                          label={tooltipLabel(label)}
                          formatValue={(v) => `${v} PRs`}
                        />
                      )}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="normal"
                      name="Normal"
                      stackId="volume"
                      fill={NORMAL_COLOR}
                    />
                    <Bar
                      dataKey="forced"
                      name="Force-merged"
                      stackId="volume"
                      fill={FORCED_COLOR}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Top force-merged authors */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">
              Most force-merged authors (last {rangeLabel})
            </h2>
            <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
              PR <em>authors</em> whose pull requests were force-merged — not
              who performed the merge.
            </p>
            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topAuthors}
                    layout="vertical"
                    margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#8884" />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="author"
                      width={120}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => (
                        <ChartTooltip
                          active={active}
                          payload={payload}
                          label={String(label ?? "")}
                          formatValue={(v) => `${v} PRs`}
                        />
                      )}
                    />
                    <Bar
                      dataKey="forced"
                      name="Force-merged PRs"
                      fill={FORCED_COLOR}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Recent force-merged PRs */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">
              Force-merged PRs (last {rangeLabel})
            </h2>
            {recent.length < (rangeTotals?.forced ?? 0) && (
              <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
                Showing the {recent.length} most recent of{" "}
                {rangeTotals?.forced} force-merged PRs.
              </p>
            )}
            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th className="px-5 py-3 font-medium">PR</th>
                    <th className="px-5 py-3 font-medium">Title</th>
                    <th className="px-5 py-3 font-medium">Author</th>
                    <th className="px-5 py-3 font-medium">Merged by</th>
                    <th className="px-5 py-3 font-medium whitespace-nowrap">CI at merge</th>
                    <th className="px-5 py-3 text-right font-medium">
                      Merged
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((pr) => (
                    <tr
                      key={pr.prNumber}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50"
                    >
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <a
                          href={pr.url}
                          target="_blank"
                          rel="noopener"
                          className="text-blue-600 hover:underline dark:text-blue-400"
                        >
                          #{pr.prNumber}
                        </a>
                      </td>
                      <td
                        className="max-w-[36rem] truncate px-5 py-2.5"
                        title={pr.title}
                      >
                        {pr.title}
                      </td>
                      <td className="px-5 py-2.5 text-zinc-500 dark:text-zinc-400">
                        {pr.author ?? "—"}
                      </td>
                      <td className="px-5 py-2.5 text-zinc-500 dark:text-zinc-400">
                        {pr.mergedBy ?? "—"}
                      </td>
                      <td className="px-5 py-2.5 text-red-500 dark:text-red-400">
                        {pr.ciState ?? "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                        {dateLabel(pr.mergedAt)}
                      </td>
                    </tr>
                  ))}
                  {recent.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-8 text-center text-zinc-400"
                      >
                        No force-merged PRs in this range
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            {(summary?.records ?? 0).toLocaleString()} merged PRs analysed
            {summary?.firstMergedAt &&
              ` since ${dateLabel(summary.firstMergedAt)}`}
            {summary?.refreshedAt &&
              ` · data refreshed ${dateLabel(summary.refreshedAt)}`}{" "}
            · detection: buildkite/ci/pr red at merge
          </p>
        </>
      )}
    </div>
  );
}
