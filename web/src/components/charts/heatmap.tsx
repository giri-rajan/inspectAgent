"use client";

import type { PairCell } from "@/lib/api";
import { pct, SHIFT_LABEL } from "@/lib/utils";

/** Furnace x shift defect-rate grid. One hue (the negative red) ramps in with the rate; plain cells are near the average. */
const STEPS = [0.05, 0.14, 0.26, 0.42, 0.62];
const fill = (t: number) => `rgb(235 87 87 / ${STEPS[Math.min(STEPS.length - 1, Math.floor(t * STEPS.length))]})`;

export function Heatmap({ cells, overall, rowsLabel = "furnace", onPick }: { cells: PairCell[]; overall: number; rowsLabel?: string; onPick?: (c: PairCell) => void }) {
  const rows = [...new Set(cells.map((c) => c.a))].sort();
  const cols = [...new Set(cells.map((c) => c.b))].sort();
  const max = Math.max(...cells.map((c) => c.rate), 0.0001);
  const get = (a: string, b: string) => cells.find((c) => c.a === a && c.b === b);
  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `auto repeat(${cols.length}, minmax(0,1fr))` }}>
        <div />
        {cols.map((c) => (
          <div key={c} className="pb-1 text-center text-[12px] text-muted">
            Shift {SHIFT_LABEL[c] ?? c}
          </div>
        ))}
        {rows.map((r) => (
          <Row key={r} r={r} cols={cols} get={get} max={max} overall={overall} onPick={onPick} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          Lower
          <span className="flex gap-0.5">
            {STEPS.map((a) => (
              <span key={a} className="h-2.5 w-4 rounded-sm" style={{ background: `rgb(235 87 87 / ${a})` }} />
            ))}
          </span>
          Higher defect rate
        </span>
        <span className="tabular ml-auto">
          Plant average {pct(overall)} · rows: {rowsLabel}
        </span>
      </div>
    </div>
  );
}

function Row({ r, cols, get, max, overall, onPick }: { r: string; cols: string[]; get: (a: string, b: string) => PairCell | undefined; max: number; overall: number; onPick?: (c: PairCell) => void }) {
  return (
    <>
      <div className="flex items-center pr-3 text-[13px] text-muted">{r}</div>
      {cols.map((c) => {
        const cell = get(r, c);
        if (!cell) return <div key={c} className="h-16 rounded-md bg-raised" />;
        const t = cell.rate / max;
        return (
          <button
            key={c}
            onClick={() => onPick?.(cell)}
            title={`${r} · Shift ${c}\n${pct(cell.rate)} defect rate (${cell.lift}× plant average ${pct(overall)})\n${cell.defective} of ${cell.inspected} castings`}
            className="flex h-16 flex-col items-center justify-center rounded-md border border-transparent transition-colors hover:border-fg/40"
            style={{ background: fill(t) }}
          >
            <span className="tabular text-sm font-semibold text-fg">{pct(cell.rate)}</span>
            <span className="tabular text-[12px] text-fg/75">{cell.lift}× average</span>
          </button>
        );
      })}
    </>
  );
}
