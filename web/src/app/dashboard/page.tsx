"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Flame } from "lucide-react";
import { api, type Inspection, type Overview } from "@/lib/api";
import { VERDICT_STYLE } from "@/lib/defects";
import { cn, pct, SHIFT_LABEL, timeAgo } from "@/lib/utils";
import { useStation } from "@/components/station";
import { Button, Card, CardHeader, Pill, Skeleton, Stat, StatStrip } from "@/components/ui/primitives";
import { AXIS, ChartTooltip, GRID, INK } from "@/components/charts/tooltip";
import { Heatmap } from "@/components/charts/heatmap";

const RANGES = [7, 14, 30, 42];
const TYPES = ["porosity", "burr", "scratch", "crack"];

export default function DashboardPage() {
  const { partId, part } = useStation();
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Overview | null>(null);
  const [live, setLive] = useState<Inspection[]>([]);
  const [heatType, setHeatType] = useState("porosity");

  useEffect(() => {
    api.overview(partId, days, heatType).then(setData).catch(() => {});
  }, [partId, days, heatType]);

  useEffect(() => {
    api.inspections(partId, 8).then(setLive).catch(() => {});
  }, [partId]);

  const daily = useMemo(
    () =>
      (data?.daily ?? []).map((d) => ({
        ...d,
        label: new Date(d.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        // a partial day (e.g. today at 8 am) is too small a sample to plot as yield
        yieldPct: d.yield != null && d.inspected >= 40 ? +(d.yield * 100).toFixed(1) : null,
      })),
    [data],
  );
  const hot = data?.hotspot;
  const k = data?.kpis;
  const delta = (a: number, b: number, digits = 1) => `${a >= b ? "+" : "−"}${Math.abs((a - b) * 100).toFixed(digits)} pts`;
  // the type the hot spot is about is the screen's main series; the rest stay neutral
  const lead = hot?.defect_type ?? k?.top_defect ?? "porosity";
  const stackOrder = [lead, ...TYPES.filter((t) => t !== lead)];
  const typeColor = (t: string) => (t === lead ? INK.accent : INK.neutral[Math.max(0, stackOrder.indexOf(t) - 1)]);
  const yMin = Math.max(0, Math.floor(Math.min(...daily.map((d) => d.yieldPct ?? 100)) / 5) * 5 - 5);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-2">
        <div>
          <h1 className="text-2xl font-semibold">Quality dashboard</h1>
          <p className="mt-1 text-sm text-muted">{part?.name} · every inspection by furnace, shift and supplier</p>
        </div>
        <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              aria-pressed={days === r}
              className={cn("h-7 rounded-md px-3 text-[13px] transition-colors", days === r ? "bg-hover font-medium text-fg" : "text-muted hover:text-fg")}
            >
              {r} days
            </button>
          ))}
        </div>
      </div>

      {hot && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-fail/35 bg-surface px-5 py-4">
          <Flame className="hidden h-5 w-5 shrink-0 text-fail sm:block" strokeWidth={1.75} />
          <div className="min-w-[16rem] flex-1">
            <h2 className="text-[15px] font-semibold">
              <span className="capitalize">{hot.defect_type}</span> hot spot: {hot.a} on Shift {SHIFT_LABEL[hot.b] ?? hot.b}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              <span className="tabular text-fg">{pct(hot.rate)}</span> of castings affected, <span className="tabular text-fg">{hot.lift}×</span> the plant average.{" "}
              {pct(hot.share, 0)} of all {hot.defect_type} defects come from this one furnace-shift cell.
            </p>
          </div>
          <Link href={`/rootcause?type=${hot.defect_type}`} className="w-full sm:w-auto">
            <Button variant="primary" tabIndex={-1} className="w-full">
              Find root cause <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </motion.div>
      )}

      {k ? (
        <StatStrip className="grid-cols-2 lg:grid-cols-4">
          <Stat label="Inspected, last 7 days" value={k.inspected_7d.toLocaleString()} hint={`${k.inspected_prev_7d.toLocaleString()} the 7 days before`} />
          <Stat label="First-pass yield" value={pct(k.yield_7d)} delta={delta(k.yield_7d, k.yield_prev_7d)} good={k.yield_7d >= k.yield_prev_7d} hint={`vs ${pct(k.yield_prev_7d)} the 7 days before`} />
          <Stat label="Scrap rate" value={pct(k.scrap_7d)} delta={delta(k.scrap_7d, k.scrap_prev_7d)} good={k.scrap_7d <= k.scrap_prev_7d} hint={`${k.fail_7d} castings scrapped · vs ${pct(k.scrap_prev_7d)}`} />
          <Stat label="Rework and review" value={(k.rework_7d + k.review_7d).toLocaleString()} hint={`${k.rework_7d} to fettling · ${k.review_7d} held for an engineer`} />
        </StatStrip>
      ) : (
        <Skeleton className="h-[106px] rounded-xl" />
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="First-pass yield" subtitle="Share of castings passing on first inspection, per day" />
          <div className="h-[260px] px-2 pb-4">
            {data ? (
              <ResponsiveContainer>
                <AreaChart data={daily} margin={{ left: 0, right: 20, top: 8, bottom: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="label" {...AXIS} minTickGap={28} />
                  <YAxis {...AXIS} domain={[yMin, 100]} tickFormatter={(v) => `${v}%`} width={48} />
                  <Tooltip content={<ChartTooltip format={(v) => `${v}%`} />} cursor={{ stroke: "#34343a" }} />
                  <Area isAnimationActive={false} type="linear" dataKey="yieldPct" name="Yield" stroke={INK.accent} strokeWidth={2} fill={INK.accent} fillOpacity={0.08} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: INK.surface, fill: INK.accentText }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-full" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Defect Pareto" subtitle={`Last ${days} days · labels show cumulative share`} />
          <div className="h-[260px] px-2 pb-4">
            {data ? (
              <ResponsiveContainer>
                <BarChart data={data.pareto} margin={{ left: 0, right: 12, top: 22, bottom: 0 }} barCategoryGap="24%">
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="type" {...AXIS} />
                  <YAxis {...AXIS} width={40} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgb(255 255 255 / 0.03)" }} />
                  <Bar isAnimationActive={false} dataKey="count" name="Defects" radius={[3, 3, 0, 0]}>
                    {data.pareto.map((p, i) => (
                      <Cell key={p.type} fill={i === 0 ? INK.accent : INK.neutral[1]} />
                    ))}
                    <LabelList dataKey="cum_share" position="top" formatter={(v: unknown) => `${Math.round(Number(v) * 100)}%`} style={{ fill: "#8a8f98", fontSize: 12 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-full" />
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader title="Where defects come from" subtitle="Share of castings affected, furnace by shift. Select a cell to investigate it." />
          <div className="-mt-1 flex flex-wrap gap-1 px-5 pb-4" role="group" aria-label="Defect type">
            {["any", ...TYPES].map((t) => (
              <button
                key={t}
                onClick={() => setHeatType(t)}
                aria-pressed={heatType === t}
                className={cn(
                  "h-7 rounded-md border px-2.5 text-[13px] capitalize transition-colors",
                  heatType === t ? "border-line-strong bg-raised text-fg" : "border-transparent text-muted hover:text-fg",
                )}
              >
                {t === "any" ? "All defects" : t}
              </button>
            ))}
          </div>
          <div className="flex-1 px-5 pb-5">
            {data ? (
              <Heatmap cells={data.heatmap.cells} overall={data.heatmap.overall_rate} onPick={() => router.push(`/rootcause?type=${heatType === "any" ? (k?.top_defect ?? "porosity") : heatType}`)} />
            ) : (
              <Skeleton className="h-56" />
            )}
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            title="Defects per day"
            subtitle="Stacked by type"
            action={
              <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 pt-1 text-[12px] text-muted">
                {stackOrder.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5 capitalize">
                    <span className="h-2 w-2 rounded-sm" style={{ background: typeColor(t) }} />
                    {t}
                  </span>
                ))}
              </div>
            }
          />
          <div className="min-h-[230px] flex-1 px-2 pb-4">
            {data ? (
              <ResponsiveContainer>
                <BarChart data={daily} margin={{ left: 0, right: 12, top: 8, bottom: 0 }} barCategoryGap="18%">
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="label" {...AXIS} minTickGap={28} />
                  <YAxis {...AXIS} width={40} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgb(255 255 255 / 0.03)" }} />
                  {stackOrder.map((t, i) => (
                    <Bar isAnimationActive={false} key={t} dataKey={t} name={t} stackId="d" fill={typeColor(t)} stroke={INK.surface} strokeWidth={1} radius={i === stackOrder.length - 1 ? [2, 2, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-full" />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Latest inspections"
          subtitle="From phones and line cameras"
          action={
            <Link href="/" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
              Inspect a casting <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="w-14 px-3 py-2 font-normal">
                  <span className="sr-only">Photo</span>
                </th>
                {["Verdict", "Summary", "Furnace", "Shift", "Heat", "When"].map((h) => (
                  <th key={h} className="px-3 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {live.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted">
                    No inspections yet. Inspect a casting to see it here.
                  </td>
                </tr>
              )}
              {live.map((r) => {
                const v = VERDICT_STYLE[r.verdict];
                return (
                  <tr key={r.id} onClick={() => router.push(`/?id=${r.id}`)} className="cursor-pointer border-t border-line transition-colors hover:bg-hover">
                    <td className="px-3 py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {r.image_url && <img src={r.image_url} alt="" className="h-9 w-9 rounded-md object-cover" />}
                    </td>
                    <td className="px-3 py-2">
                      <Pill tone={v.tone}>{v.label}</Pill>
                    </td>
                    <td className="max-w-[440px] truncate px-3 py-2">{r.summary}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{r.machine || "—"}</td>
                    <td className="px-3 py-2 text-muted">{r.shift || "—"}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-muted">{r.batch || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{timeAgo(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
