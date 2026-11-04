"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Defect } from "@/lib/api";
import { defectColor } from "@/lib/defects";
import { cn } from "@/lib/utils";

interface Props {
  src: string;
  width: number;
  height: number;
  defects?: Defect[];
  scanning?: boolean;
  active?: number | null;
  onSelect?: (id: number | null) => void;
  partCircle?: { cx: number; cy: number; r: number } | null;
  className?: string;
}

export function InspectionOverlay({ src, width, height, defects = [], scanning, active, onSelect, partCircle, className }: Props) {
  const w = width || 1;
  const h = height || 1;
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-black", className)} style={{ aspectRatio: `${w} / ${h}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Casting under inspection" className="absolute inset-0 h-full w-full object-contain" draggable={false} />

      <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" onClick={() => onSelect?.(null)}>
        {partCircle && !scanning && (
          <motion.circle
            cx={partCircle.cx}
            cy={partCircle.cy}
            r={partCircle.r}
            fill="none"
            stroke="rgb(255 255 255 / 0.35)"
            strokeWidth={Math.max(1, w / 500)}
            strokeDasharray={`${w / 120} ${w / 160}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
          />
        )}
        <AnimatePresence>
          {!scanning &&
            defects.map((d, i) => {
              const color = defectColor(d.type);
              const dim = active != null && active !== d.id;
              const ignored = d.severity === "ignore" || d.status === "rejected";
              return (
                <motion.g
                  key={d.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: dim ? 0.25 : 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: 0.15 + i * 0.12, duration: 0.35 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect?.(active === d.id ? null : d.id);
                  }}
                  className="cursor-pointer"
                >
                  {d.polygons.map((poly, k) => (
                    <motion.path
                      key={k}
                      d={`M${poly.map((p) => p.join(",")).join("L")}Z`}
                      fill={color}
                      fillOpacity={active === d.id ? 0.42 : 0.26}
                      stroke={color}
                      strokeWidth={Math.max(1.5, w / 380)}
                      strokeDasharray={ignored ? `${w / 150} ${w / 200}` : undefined}
                      strokeLinejoin="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ delay: 0.15 + i * 0.12, duration: 0.7, ease: "easeOut" }}
                    />
                  ))}
                  {/* generous hit target for thin masks */}
                  <rect
                    x={d.bbox[0] - 8}
                    y={d.bbox[1] - 8}
                    width={d.bbox[2] - d.bbox[0] + 16}
                    height={d.bbox[3] - d.bbox[1] + 16}
                    fill="transparent"
                  />
                  {active === d.id && (
                    <rect
                      x={d.bbox[0] - 6}
                      y={d.bbox[1] - 6}
                      width={d.bbox[2] - d.bbox[0] + 12}
                      height={d.bbox[3] - d.bbox[1] + 12}
                      rx={6}
                      fill="none"
                      stroke={color}
                      strokeWidth={Math.max(1, w / 600)}
                      strokeDasharray="6 5"
                    />
                  )}
                </motion.g>
              );
            })}
        </AnimatePresence>
      </svg>

      {!scanning &&
        defects.map((d, i) => {
          const color = defectColor(d.type);
          const left = (d.bbox[0] / w) * 100;
          const top = (d.bbox[1] / h) * 100;
          const dim = active != null && active !== d.id;
          return (
            <motion.button
              key={d.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: dim ? 0.35 : 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.12 }}
              onClick={() => onSelect?.(active === d.id ? null : d.id)}
              className="absolute z-10 -translate-y-[calc(100%+6px)] rounded px-1.5 py-0.5 text-[11px] font-semibold text-black sm:text-[12px]"
              style={{ left: `${Math.min(left, 88)}%`, top: `${Math.max(top, 6)}%`, backgroundColor: color }}
            >
              {d.label}
              <span className="ml-1 font-medium opacity-75">{d.type.replace(/_/g, " ")}</span>
            </motion.button>
          );
        })}

      {scanning && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-black/25" />
          <div className="absolute inset-x-0 top-0 h-[12%] animate-scan">
            <div className="absolute inset-x-0 bottom-1/2 h-0.5 bg-accent-strong" />
          </div>
          <Corners />
        </div>
      )}
    </div>
  );
}

function Corners() {
  const c = "absolute h-6 w-6 border-accent-strong";
  return (
    <>
      <span className={cn(c, "top-3 left-3 rounded-tl-lg border-t-2 border-l-2")} />
      <span className={cn(c, "top-3 right-3 rounded-tr-lg border-t-2 border-r-2")} />
      <span className={cn(c, "bottom-3 left-3 rounded-bl-lg border-b-2 border-l-2")} />
      <span className={cn(c, "right-3 bottom-3 rounded-br-lg border-r-2 border-b-2")} />
    </>
  );
}
