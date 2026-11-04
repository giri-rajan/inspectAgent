"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Camera, Pause, Play, Truck } from "lucide-react";
import { toast } from "sonner";
import { api, type Inspection, type Sample, type Verdict } from "@/lib/api";
import { VERDICT_STYLE } from "@/lib/defects";
import { cn } from "@/lib/utils";
import { useStation } from "@/components/station";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { InspectionOverlay } from "@/components/inspect/overlay";
import { useCamera } from "@/components/inspect/camera";
import { stripVerdict } from "@/components/inspect/verdict";

type Source = "sim" | "camera";

export default function LinePage() {
  const { partId, station, health } = useStation();
  const [source, setSource] = useState<Source>("sim");
  const [running, setRunning] = useState(false);
  const [interval, setIntervalS] = useState(3);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [history, setHistory] = useState<Inspection[]>([]);
  const [logged, setLogged] = useState<Inspection[]>([]);
  const [current, setCurrent] = useState<Inspection | null>(null);
  const [flash, setFlash] = useState<Verdict | null>(null);
  const cam = useCamera(running && source === "camera");
  const runRef = useRef(false);
  const tick = useRef(0);

  useEffect(() => {
    api.samples().then(setSamples).catch(() => {});
  }, []);

  useEffect(() => {
    api.inspections(partId, 8).then(setLogged).catch(() => {});
  }, [partId]);

  useEffect(() => {
    runRef.current = running;
    if (!running) return;
    let alive = true;
    (async () => {
      while (alive && runRef.current) {
        const t0 = performance.now();
        try {
          let blob: Blob | null = null;
          if (source === "camera") blob = await cam.capture();
          else if (samples.length) {
            const s = samples[(tick.current++ * 7 + 3) % samples.length];
            blob = await fetch(s.url).then((r) => r.blob());
          }
          if (blob) {
            const res = await api.inspect(blob, { part_id: partId, ...station });
            if (!alive) break;
            setCurrent(res);
            setHistory((h) => [res, ...h].slice(0, 60));
            setFlash(res.verdict);
            setTimeout(() => setFlash(null), 900);
          }
        } catch (e) {
          toast.error((e as Error).message);
          setRunning(false);
          break;
        }
        const wait = interval * 1000 - (performance.now() - t0);
        await new Promise((r) => setTimeout(r, Math.max(250, wait)));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, source, interval, samples, partId]);

  const counts = history.reduce<Record<Verdict, number>>((a, h) => ({ ...a, [h.verdict]: a[h.verdict] + 1 }), { PASS: 0, REVIEW: 0, REWORK: 0, FAIL: 0 });
  const n = history.length;
  const yieldRate = n ? counts.PASS / n : 0;
  const avgMs = n ? Math.round(history.reduce((a, h) => a + (h.meta.timings?.total_ms ?? 0), 0) / n) : 0;

  const next = samples.length ? samples[(tick.current * 7 + 3) % samples.length] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Line mode</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">A phone over the conveyor inspects every casting and logs it against the furnace, shift and heat.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Source"
            value={source}
            onChange={(v) => setSource(v as Source)}
            options={[
              ["sim", "Simulated line", Truck],
              ["camera", "Camera", Camera],
            ]}
          />
          <Segmented label="Interval" value={String(interval)} onChange={(v) => setIntervalS(Number(v))} options={[2, 3, 5].map((s) => [String(s), `Every ${s} s`])} />
          <Button variant={running ? "danger" : "primary"} onClick={() => setRunning((r) => !r)}>
            {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {running ? "Stop line" : "Start line"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="relative flex flex-col overflow-hidden p-4">
          <div className="relative flex flex-1 flex-col">
            {source === "camera" && running && !current && <video ref={cam.videoRef} playsInline muted className="aspect-[4/3] w-full rounded-lg bg-black object-cover" />}
            {source === "camera" && running && current && <video ref={cam.videoRef} playsInline muted className="hidden" />}
            {current?.image_url ? (
              <div className="w-full">
                <InspectionOverlay src={current.image_url} width={current.width} height={current.height} defects={current.defects} partCircle={current.meta.part_circle} className="mx-auto max-h-[62vh]" />
              </div>
            ) : (
              !(source === "camera" && running) && (
                <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-lg bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {source === "sim" && next && <img src={next.url} alt="" className="absolute inset-0 h-full w-full object-contain opacity-35" />}
                  <div className="absolute inset-0 grid place-items-center p-6 text-center">
                    <div>
                      <h2 className="text-lg font-semibold">Line stopped</h2>
                      <p className="mt-1 text-sm text-muted">
                        {source === "sim" ? `${samples.length} sample castings ready on the simulated conveyor.` : "The camera starts when the line does."}
                      </p>
                    </div>
                  </div>
                </div>
              )
            )}
            {cam.error && source === "camera" && <p className="mt-2 text-sm text-fail">{cam.error}</p>}
            <AnimatePresence>
              {flash && (
                <motion.div
                  key={current?.id}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="pointer-events-none absolute inset-0 grid place-items-center"
                >
                  <div className="rounded-xl bg-bg/90 px-8 py-4 text-4xl font-semibold tracking-tight shadow-[0_12px_32px_rgb(0_0_0/0.5)]" style={{ color: VERDICT_STYLE[flash].hex }}>
                    {VERDICT_STYLE[flash].label}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {current && (
            <p className="mt-3 text-sm">
              <span className={cn("tabular mr-2 font-medium", VERDICT_STYLE[current.verdict].text)}>#{current.id}</span>
              {current.summary}
            </p>
          )}
          {running && (
            <span className="absolute top-6 right-6 inline-flex items-center gap-1.5 rounded-md bg-black/80 px-2.5 py-1 text-[12px] font-medium text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fail" /> Live
            </span>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="flex items-center gap-6">
              <YieldRing value={yieldRate} empty={n === 0} />
              <ul className="flex-1 divide-y divide-line">
                {(["PASS", "REWORK", "REVIEW", "FAIL"] as Verdict[]).map((v) => (
                  <li key={v} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: VERDICT_STYLE[v].hex }} />
                      {VERDICT_STYLE[v].label}
                    </span>
                    <span className="tabular font-medium">{counts[v]}</span>
                  </li>
                ))}
              </ul>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-line">
              {[
                ["Inspected", String(n)],
                ["Avg latency", n ? `${avgMs} ms` : "—"],
                ["Model", health?.provider === "meta" ? "SAM 3.1" : "Offline"],
              ].map(([k, v]) => (
                <div key={k} className="bg-surface px-3 py-2.5">
                  <dt className="text-[12px] text-muted">{k}</dt>
                  <dd className="tabular mt-0.5 text-[15px] font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card className="flex min-h-[280px] flex-1 flex-col p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-semibold">Ticker</h3>
              <span className="truncate text-[12px] text-muted">
                {station.machine} · Shift {station.shift} · Heat {station.batch}
              </span>
            </div>
            <div className="mt-3 max-h-[420px] flex-1 space-y-1 overflow-y-auto">
              {history.length === 0 && (
                <>
                  <p className="rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted">Nothing on the line yet this session. Last logged on this part:</p>
                  {logged.map((h) => (
                    <TickerRow key={h.id} h={h} />
                  ))}
                </>
              )}
              <AnimatePresence initial={false}>
                {history.map((h) => (
                  <motion.div key={h.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                    <TickerRow h={h} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TickerRow({ h }: { h: Inspection }) {
  return (
    <div className="flex items-center gap-3 rounded-md px-1 py-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {h.image_url ? <img src={h.image_url} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="h-8 w-8 rounded bg-raised" />}
      <span className="w-16 shrink-0">
        <Pill tone={VERDICT_STYLE[h.verdict].tone}>{VERDICT_STYLE[h.verdict].label}</Pill>
      </span>
      <span className="flex-1 truncate text-[13px] text-muted">{stripVerdict(h.summary)}</span>
      <span className="tabular text-[12px] text-muted">#{h.id}</span>
    </div>
  );
}

function Segmented({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: (readonly [string, string] | readonly [string, string, React.ComponentType<{ className?: string }>])[] }) {
  return (
    <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label={label}>
      {options.map(([k, text, Icon]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors", value === k ? "bg-hover font-medium text-fg" : "text-muted hover:text-fg")}
        >
          {Icon && <Icon className="h-3.5 w-3.5" />} {text}
        </button>
      ))}
    </div>
  );
}

function YieldRing({ value, empty }: { value: number; empty: boolean }) {
  const r = 48;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--color-raised)" strokeWidth="6" />
        <motion.circle
          cx="55"
          cy="55"
          r={r}
          fill="none"
          stroke={empty ? "transparent" : "var(--color-accent)"}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          animate={{ strokeDashoffset: c * (1 - value) }}
          transition={{ type: "spring", stiffness: 80, damping: 20 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="tabular text-2xl font-semibold">{empty ? "—" : `${Math.round(value * 100)}%`}</div>
          <div className="text-[12px] text-muted">yield</div>
        </div>
      </div>
    </div>
  );
}
