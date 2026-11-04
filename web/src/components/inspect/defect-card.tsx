"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookCheck, Check, MapPin, Ruler, Scale, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Defect } from "@/lib/api";
import { DISPOSITION_STYLE, defectColor } from "@/lib/defects";
import { cn } from "@/lib/utils";
import { Button, Input, Pill } from "../ui/primitives";

export function DefectCard({ d, active, onSelect, onChange }: { d: Defect; active: boolean; onSelect: () => void; onChange: (d: Defect) => void }) {
  const color = defectColor(d.type);
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const disp = d.disposition ? DISPOSITION_STYLE[d.disposition] : null;
  const f = d.features;
  const size =
    d.type === "porosity"
      ? `${Number(f.largest_pore_mm).toFixed(1)} mm pore · ${f.pore_count} pore${Number(f.pore_count) > 1 ? "s" : ""}`
      : d.type === "burr"
        ? `${Number(f.protrusion_mm).toFixed(1)} mm high · ${Number(f.length_mm ?? d.max_dim_mm).toFixed(0)} mm long`
        : `${d.max_dim_mm.toFixed(1)} mm long`;
  const lib = d.library ?? {};

  const review = async (status: Defect["status"], fb = "") => {
    setBusy(true);
    try {
      const updated = await api.review(d.id, status, fb);
      onChange({ ...d, ...updated, features: d.features, library: d.library });
      setRejecting(false);
      if (status === "confirmed") toast.success(`${d.label} confirmed`, { description: "Added to the defect library. Similar detections will be trusted more." });
      if (status === "rejected") toast(`${d.label} marked as not a defect`, { description: "InspectAgent will treat look-alikes as likely false positives." });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onSelect}
      className={cn(
        "cursor-pointer rounded-xl border bg-surface p-4 transition-colors",
        active ? "border-[#3e3e44] bg-raised" : "border-line hover:bg-hover",
        (d.status === "rejected" || d.severity === "ignore") && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-7 w-8 shrink-0 place-items-center rounded-md text-[12px] font-semibold text-black" style={{ background: color }}>
          {d.label}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold capitalize">{d.type.replace(/_/g, " ")}</span>
            {disp && <Pill tone={disp.tone}>{disp.label}</Pill>}
            {d.rule_id && <span className="font-mono text-[12px] text-muted">{d.rule_id}</span>}
            {d.status !== "pending" && (
              <span className={cn("ml-auto inline-flex items-center gap-1 text-[12px] font-medium", d.status === "confirmed" ? "text-pass" : "text-muted")}>
                <BookCheck className="h-3.5 w-3.5" />
                {d.status === "confirmed" ? "Confirmed" : "Not a defect"}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1">
              <Ruler className="h-3.5 w-3.5" />
              <span className="tabular">{size}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {d.location}
            </span>
            <span className="inline-flex items-center gap-1 tabular">
              <Scale className="h-3.5 w-3.5" />
              {(d.confidence * 100).toFixed(0)}% confidence
            </span>
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-fg">{d.reason}</p>
          {(lib.confirmed ?? 0) + (lib.rejected ?? 0) > 0 && (
            <p className="mt-1.5 text-[12px] text-muted">
              Library: {lib.confirmed ?? 0} similar confirmed · {lib.rejected ?? 0} similar rejected
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-11" onClick={(e) => e.stopPropagation()}>
        {d.status === "pending" ? (
          <>
            <Button size="sm" variant="success" disabled={busy} onClick={() => review("confirmed")}>
              <Check className="h-3.5 w-3.5" /> Confirm defect
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting((v) => !v)}>
              <X className="h-3.5 w-3.5" /> Not a defect
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => review("pending")}>
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </Button>
        )}
      </div>
      <AnimatePresence>
        {rejecting && (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden pl-11"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              review("rejected", feedback);
            }}
          >
            <div className="mt-2 flex gap-2">
              <Input autoFocus value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Why? e.g. shadow on vane, sand grain" />
              <Button size="sm" variant="danger" type="submit" disabled={busy} className="h-9">
                Save
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["Shadow / lighting", "Sand grain on surface", "Designed feature", "Already machined off"].map((q) => (
                <button key={q} type="button" onClick={() => setFeedback(q)} className="h-7 rounded-md border border-line bg-raised px-2.5 text-[12px] text-muted hover:text-fg">
                  {q}
                </button>
              ))}
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
