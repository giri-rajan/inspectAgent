"use client";

import { motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import type { Inspection } from "@/lib/api";
import { VERDICT_STYLE } from "@/lib/defects";
import { cn } from "@/lib/utils";

export function VerdictCard({ insp }: { insp: Inspection }) {
  const s = VERDICT_STYLE[insp.verdict];
  const t = insp.meta.timings ?? {};
  const live = insp.provider === "meta";
  const reason = stripVerdict(insp.summary);
  const meta = [
    `#${insp.id}`,
    `${insp.defects.length} detection${insp.defects.length === 1 ? "" : "s"}`,
    `${live ? "SAM 3.1" : "OpenCV"} ${t.segment_ms ?? 0} ms`,
    `${insp.meta.engine === "muse-spark" ? "Muse Spark" : "Rule engine"} ${t.judge_ms ?? 0} ms`,
    insp.meta.mm_per_px ? `${insp.meta.mm_per_px.toFixed(3)} mm/px` : null,
  ].filter(Boolean);
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: "easeOut" }} className="card p-5">
      <div className="flex items-baseline gap-3">
        <h2 className={cn("text-[28px] leading-none font-semibold tracking-tight", s.text)}>{s.label}</h2>
        <span className="text-sm text-muted">{s.blurb}</span>
        <span className="tabular ml-auto text-[12px] text-muted">{t.total_ms ?? 0} ms</span>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed text-fg">{reason}</p>
      <p className="tabular mt-4 border-t border-line pt-3 text-[12px] text-muted">{meta.join("  ·  ")}</p>
      {insp.meta.warnings?.map((w) => (
        <p key={w} className="mt-3 flex items-start gap-2 rounded-lg bg-rework/10 px-3 py-2 text-[13px] text-rework">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {w}
        </p>
      ))}
    </motion.div>
  );
}

/** Drop the leading verdict word ("FAIL -", "Pass.", "Hold for review:") that the card already shows. */
export function stripVerdict(summary: string) {
  return summary.replace(/^\s*(fail|pass|rework|review|hold for review)\b\s*[-–—:.,]?\s*/i, "") || summary;
}
