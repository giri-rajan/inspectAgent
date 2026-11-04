"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PairCell, RateRow } from "@/lib/api";
import { pct, SHIFT_LABEL } from "@/lib/utils";
import { AXIS, ChartTooltip, INK } from "../charts/tooltip";
import { Heatmap } from "../charts/heatmap";

type Result = Record<string, unknown>;

export function ToolResult({ tool, result }: { tool: string; result: Result }) {
  if ("error" in result) return <p className="text-[13px] text-fail">{String(result.error)}</p>;
  if (tool === "trend") return <TrendMini series={result.series as { period_start: string; rate: number }[]} />;
  if (tool === "rate_by") return <RateBars rows={result.rows as RateRow[]} overall={result.overall_rate as number} dim={result.dimension as string} />;
  if (tool === "rate_by_pair") return <Pair r={result as unknown as { dim_a: string; dim_b: string; overall_rate: number; cells: PairCell[] }} />;
  if (tool === "defect_profile") return <Profile r={result as unknown as { count: number; critical: number; zones: Record<string, number>; size_mm: Record<string, number> }} />;
  return <pre className="overflow-x-auto font-mono text-[12px] text-muted">{JSON.stringify(result, null, 1).slice(0, 800)}</pre>;
}

function TrendMini({ series }: { series: { period_start: string; rate: number }[] }) {
  const data = series.map((s) => ({ ...s, ratePct: +(s.rate * 100).toFixed(2) }));
  return (
    <div className="h-36">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <XAxis dataKey="period_start" {...AXIS} fontSize={11} />
          <YAxis {...AXIS} fontSize={11} width={40} tickFormatter={(v) => `${v}%`} domain={[0, "auto"]} />
          <Tooltip content={<ChartTooltip format={(v) => `${v}%`} />} />
          <Line isAnimationActive={false} type="linear" dataKey="ratePct" name="Weekly rate" stroke={INK.accent} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: INK.accentText, stroke: INK.surface, strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function label(dim: string, key: string) {
  return dim === "shift" ? `Shift ${SHIFT_LABEL[key] ?? key}` : key;
}

function RateBars({ rows, overall, dim }: { rows: RateRow[]; overall: number; dim: string }) {
  const max = Math.max(...rows.map((r) => r.rate), overall, 0.0001);
  return (
    <div className="space-y-1.5">
      {rows.slice(0, 6).map((r) => {
        const strong = r.lift >= 1.3 && r.z >= 3;
        return (
          <div key={r.key} className="grid grid-cols-[110px_1fr_96px] items-center gap-3 text-[13px]" title={`${r.defective} of ${r.inspected} castings · z=${r.z}`}>
            <span className="truncate text-muted">{label(dim, r.key)}</span>
            <div className="relative h-4 rounded-sm bg-raised">
              <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(r.rate / max) * 100}%`, background: strong ? INK.accent : INK.neutral[1] }} />
              <div className="absolute inset-y-[-3px] w-px bg-fg/60" style={{ left: `${(overall / max) * 100}%` }} />
            </div>
            <span className="tabular text-right">
              <span className={strong ? "font-semibold text-accent-strong" : "text-fg"}>{pct(r.rate)}</span>
              <span className="text-faint"> · {r.lift}×</span>
            </span>
          </div>
        );
      })}
      <div className="pt-1 text-[12px] text-muted">The white tick is the plant average, {pct(overall)}. Lavender bars are significant (at least 1.3× and z ≥ 3).</div>
    </div>
  );
}

function Pair({ r }: { r: { dim_a: string; dim_b: string; overall_rate: number; cells: PairCell[] } }) {
  if (r.dim_a === "machine" && r.dim_b === "shift") return <Heatmap cells={r.cells} overall={r.overall_rate} />;
  return (
    <div className="space-y-1">
      {r.cells.slice(0, 5).map((c) => (
        <div key={`${c.a}-${c.b}`} className="flex items-center justify-between gap-3 rounded-md bg-raised px-3 py-1.5 text-[13px]">
          <span className="text-muted">
            {label(r.dim_a, c.a)} <span className="text-faint">×</span> {label(r.dim_b, c.b)}
          </span>
          <span className="tabular">
            <span className={c.lift >= 2 ? "font-semibold text-accent-strong" : ""}>{pct(c.rate)}</span>
            <span className="text-faint"> · {c.lift}× · {pct(c.share, 0)} of defects</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Profile({ r }: { r: { count: number; critical: number; zones: Record<string, number>; size_mm: Record<string, number> } }) {
  const total = Object.values(r.zones).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex h-6 overflow-hidden rounded-md">
        {Object.entries(r.zones).map(([z, n], i) => (
          <div key={z} className="flex items-center justify-center text-[11px] font-medium text-white" style={{ width: `${(n / total) * 100}%`, background: [INK.accent, "#4a53a6", "#373e7a", "#272c55"][i % 4], borderRight: `2px solid ${INK.surface}` }} title={`${z}: ${n}`}>
            {n / total > 0.12 ? `${z} ${Math.round((n / total) * 100)}%` : ""}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-md bg-line">
        {[
          ["Defects", r.count],
          ["Critical", r.critical],
          ["Median", `${r.size_mm.p50} mm`],
          ["P90", `${r.size_mm.p90} mm`],
        ].map(([k, v]) => (
          <div key={k as string} className="bg-surface px-2.5 py-2">
            <div className="text-[12px] text-muted">{k}</div>
            <div className="tabular mt-0.5 font-semibold">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
