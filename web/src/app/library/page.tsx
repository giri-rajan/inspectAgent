"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, Check, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Defect, type Inspection, type Library } from "@/lib/api";
import { defectColor, DEFECT_BLURB } from "@/lib/defects";
import { cn, timeAgo } from "@/lib/utils";
import { useStation } from "@/components/station";
import { Button, Card, Skeleton } from "@/components/ui/primitives";

type Filter = "all" | "confirmed" | "rejected";

export default function LibraryPage() {
  const { partId, part } = useStation();
  const [lib, setLib] = useState<Library | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [type, setType] = useState<string | null>(null);
  const [recent, setRecent] = useState<Inspection[]>([]);

  const load = () => api.library(partId).then(setLib).catch(() => {});
  useEffect(() => {
    setLib(null);
    load();
    api.inspections(partId, 20).then(setRecent).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId]);

  const items = useMemo(
    () => (lib?.items ?? []).filter((d) => (filter === "all" || d.status === filter) && (!type || d.type === type)),
    [lib, filter, type],
  );
  const total = (lib?.stats ?? []).reduce((a, s) => a + s.confirmed + s.rejected, 0);
  const waiting = recent.flatMap((r) => r.defects.filter((d) => d.status === "pending" && d.crop_url && (!type || d.type === type)).map((d) => ({ ...d, inspection_id: r.id }))).slice(0, 10);

  const undo = async (d: Defect) => {
    await api.review(d.id, "pending");
    toast(`${d.label} removed from the library`);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Defect library</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Confirmed defects strengthen future verdicts. Rejected look-alikes are treated as likely false positives and shown to Muse Spark as counter-examples.
          </p>
        </div>
        {lib && lib.pending > 0 && (
          <Link href="/">
            <Button variant="primary" tabIndex={-1}>
              Review {lib.pending} waiting detections <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card className="col-span-2 flex flex-col justify-center p-5 lg:col-span-1">
          <div className="text-[13px] text-muted">Reviewed examples</div>
          <div className="tabular mt-1.5 text-[30px] leading-none font-semibold tracking-tight">{lib ? total : "—"}</div>
          <div className="mt-2 text-[13px] text-muted">for {part?.name ?? "this part"}</div>
        </Card>
        {["porosity", "crack", "burr", "scratch"].map((t) => {
          const s = lib?.stats.find((x) => x.type === t) ?? { confirmed: 0, rejected: 0 };
          const n = s.confirmed + s.rejected;
          return (
            <button
              key={t}
              onClick={() => setType(type === t ? null : t)}
              aria-pressed={type === t}
              className={cn("card p-5 text-left transition-colors hover:bg-hover", type === t && "border-[#3e3e44] bg-raised")}
            >
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: defectColor(t) }} />
                <span className="text-sm font-semibold capitalize">{t}</span>
              </div>
              <div className="mt-1 text-[13px] text-muted">{DEFECT_BLURB[t]}</div>
              <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-raised">
                {n > 0 && (
                  <>
                    <div className="bg-pass" style={{ width: `${(s.confirmed / n) * 100}%` }} />
                    <div className="bg-line-strong" style={{ width: `${(s.rejected / n) * 100}%` }} />
                  </>
                )}
              </div>
              <div className="mt-2 flex justify-between text-[13px] text-muted tabular">
                <span>{s.confirmed} confirmed</span>
                <span>{s.rejected} rejected</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Filter by decision">
          {(["all", "confirmed", "rejected"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn("h-7 rounded-md px-3 text-[13px] transition-colors", filter === f ? "bg-hover font-medium text-fg" : "text-muted hover:text-fg")}
            >
              {{ all: "All", confirmed: "Confirmed", rejected: "Not a defect" }[f]}
            </button>
          ))}
        </div>
        {type && (
          <button onClick={() => setType(null)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[13px] capitalize text-fg hover:bg-hover">
            {type} <X className="h-3.5 w-3.5 text-muted" />
            <span className="sr-only">Clear type filter</span>
          </button>
        )}
        <span className="tabular ml-auto text-[13px] text-muted">{lib && items.length > 0 ? `${items.length} shown` : ""}</span>
      </div>

      {!lib ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">{total === 0 ? "No reviewed examples yet" : "Nothing matches this filter"}</h2>
            <span className="text-[13px] text-muted">InspectAgent works from day one with zero examples.</span>
          </div>
          {waiting.length > 0 ? (
            <>
              <p className="mt-1 text-[13px] text-muted">Waiting for a decision. Open one and choose Confirm defect or Not a defect.</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {waiting.map((d) => (
                  <Link key={d.id} href={`/?id=${d.inspection_id}`} className="group min-w-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.crop_url!} alt={`${d.type} on inspection ${d.inspection_id}`} className="aspect-square w-full rounded-lg border border-line object-cover transition-colors group-hover:border-accent-strong" />
                    <span className="mt-1.5 flex items-center gap-1.5 text-[13px] capitalize">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: defectColor(d.type) }} />
                      {d.type}
                      <span className="tabular ml-auto text-[13px] text-muted normal-case">#{d.inspection_id}</span>
                    </span>
                    <span className="block truncate text-[13px] text-muted">{d.location}</span>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted">
              Confirm or reject any detection on the Inspect screen and it lands here for {part?.name ?? "this part"}.
            </p>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {items.map((d, i) => (
            <motion.div key={d.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
              <Card className="group overflow-hidden">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {d.crop_url && <img src={d.crop_url} alt={d.type} className="aspect-square w-full object-cover" />}
                  <span
                    className={cn(
                      "absolute top-2 left-2 inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium",
                      d.status === "confirmed" ? "bg-[#12241a] text-pass" : "bg-black/80 text-white",
                    )}
                  >
                    {d.status === "confirmed" ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {d.status === "confirmed" ? "Defect" : "Not a defect"}
                  </span>
                  <button
                    onClick={() => undo(d)}
                    className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-md bg-black/80 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label="Remove from library"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium capitalize">
                    <span className="h-2 w-2 rounded-full" style={{ background: defectColor(d.type) }} />
                    {d.type}
                    <span className="tabular ml-auto text-[13px] font-normal text-muted">{Number(d.features.key_size_mm ?? d.max_dim_mm).toFixed(1)} mm</span>
                  </div>
                  <div className="mt-0.5 truncate text-[13px] text-muted">{d.location}</div>
                  {d.feedback && <div className="mt-1.5 truncate rounded-md bg-raised px-2 py-1 text-[13px] text-fg">“{d.feedback}”</div>}
                  <Link href={`/?id=${d.inspection_id}`} className="tabular mt-1.5 block text-[13px] text-muted hover:text-fg">
                    #{d.inspection_id} · {d.reviewed_at ? timeAgo(d.reviewed_at) : ""}
                  </Link>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
