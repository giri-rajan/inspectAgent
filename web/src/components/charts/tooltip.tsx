"use client";

export function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string; fill?: string; dataKey?: string }[];
  label?: string;
  format?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg border border-line-strong bg-hover px-3 py-2 text-[12px] shadow-[0_8px_24px_rgb(0_0_0/0.5)]">
      {label && <div className="mb-1.5 font-medium text-fg">{label}</div>}
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={p.dataKey ?? p.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-sm" style={{ background: p.color ?? p.fill }} />
              {p.name}
            </span>
            <span className="tabular font-medium text-fg">{format ? format(p.value, p.name) : p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const AXIS = { stroke: "#8a8f98", fontSize: 12, tickLine: false, axisLine: false } as const;
export const GRID = { stroke: "#1c1d21", strokeDasharray: "0", vertical: false } as const;

/** Chart ink: the accent marks the main series; neutrals carry the rest. */
export const INK = { accent: "#5e6ad2", accentText: "#828fff", neutral: ["#6b6f78", "#45484f", "#2e3036"], surface: "#0f1011" } as const;
