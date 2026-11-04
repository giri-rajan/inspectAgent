"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Camera, Check, ImagePlus, Loader2, Plus, RotateCcw, ScanSearch, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, type Inspection, type Part, type Sample } from "@/lib/api";
import { defectColor, DISPOSITION_STYLE, VERDICT_STYLE } from "@/lib/defects";
import { cn, timeAgo } from "@/lib/utils";
import { useStation } from "@/components/station";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { InspectionOverlay } from "@/components/inspect/overlay";
import { CameraView } from "@/components/inspect/camera";
import { VerdictCard } from "@/components/inspect/verdict";
import { DefectCard } from "@/components/inspect/defect-card";
import { VoiceNote } from "@/components/inspect/voice-note";

type Phase = "idle" | "camera" | "running" | "done";

export default function InspectPage() {
  const { part, partId, station, health } = useStation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<{ url: string; w: number; h: number } | null>(null);
  const [result, setResult] = useState<Inspection | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [custom, setCustom] = useState("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [recent, setRecent] = useState<Inspection[]>([]);
  const [stage, setStage] = useState(0);
  const [note, setNote] = useState("");
  const lastBlob = useRef<Blob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!part) return;
    setPrompts(part.prompts);
    setEnabled(Object.fromEntries(part.prompts.map((p) => [p, true])));
  }, [part]);

  useEffect(() => {
    api.samples().then(setSamples).catch(() => {});
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    if (id) {
      api
        .inspection(id)
        .then((r) => {
          setResult(r);
          setNote(r.note);
          setPhase("done");
        })
        .catch(() => toast.error(`Inspection #${id} not found`));
    }
  }, []);

  const loadRecent = useCallback(() => {
    api.inspections(partId, 12).then(setRecent).catch(() => {});
  }, [partId]);
  useEffect(loadRecent, [loadRecent]);

  const run = async (blob: Blob) => {
    lastBlob.current = blob;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {});
    setPreview({ url, w: img.naturalWidth, h: img.naturalHeight });
    setResult(null);
    setActive(null);
    setNote("");
    setPhase("running");
    setStage(0);
    const active = prompts.filter((p) => enabled[p]);
    const started = performance.now();
    try {
      const res = await api.inspect(blob, { part_id: partId, prompts: active.join(","), ...station });
      // let the operator see each stage land, even on the fast offline path
      const minShow = 900 - (performance.now() - started);
      setStage(1);
      await new Promise((r) => setTimeout(r, Math.max(220, minShow / 2)));
      setStage(2);
      await new Promise((r) => setTimeout(r, Math.max(220, minShow / 2)));
      setStage(3);
      setResult(res);
      setPhase("done");
      loadRecent();
    } catch (e) {
      toast.error("Inspection failed", { description: (e as Error).message });
      setPhase("idle");
    }
  };

  const fromUrl = async (url: string) => {
    const blob = await fetch(url).then((r) => r.blob());
    run(blob);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) run(f);
    e.target.value = "";
  };

  const reset = () => {
    setPhase("idle");
    setResult(null);
    setPreview(null);
  };

  const addPrompt = () => {
    const p = custom.trim().toLowerCase();
    if (!p) return;
    if (!prompts.includes(p)) setPrompts((x) => [...x, p]);
    setEnabled((x) => ({ ...x, [p]: true }));
    setCustom("");
  };

  const saveNote = async (text: string) => {
    setNote(text);
    if (result) await api.setNote(result.id, text).catch(() => {});
  };

  const imgSrc = result?.image_url ?? preview?.url;
  const imgW = result?.width ?? preview?.w ?? 1;
  const imgH = result?.height ?? preview?.h ?? 1;

  const openRecent = (r: Inspection) => {
    setResult(r);
    setPreview(null);
    setPhase("done");
    setActive(null);
    setNote(r.note);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
      <Header />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------ capture / viewer */}
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-3">
            <span className="mr-1.5 text-[13px] text-muted">Look for</span>
            {prompts.map((p) => (
              <button
                key={p}
                onClick={() => setEnabled((x) => ({ ...x, [p]: !x[p] }))}
                aria-pressed={!!enabled[p]}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors",
                  enabled[p] ? "border-line-strong bg-raised text-fg" : "border-line text-muted hover:text-fg",
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: enabled[p] ? defectColor(p) : "var(--color-line-strong)" }} />
                {p}
              </button>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addPrompt();
              }}
              className="flex items-center"
            >
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Add a defect in words"
                aria-label="Add a defect to look for"
                className="h-7 w-44 rounded-md border border-dashed border-line-strong bg-transparent px-2.5 text-[13px] outline-none placeholder:text-faint focus:border-solid focus:border-accent"
              />
              {custom && (
                <button className="ml-1 grid h-7 w-7 place-items-center rounded-md bg-accent text-white" aria-label="Add prompt">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </form>
          </div>

          <div className="p-4">
            <AnimatePresence mode="wait">
              {phase === "idle" && (
                <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <Dropzone onFile={run}>
                    <ScanSearch className="mx-auto h-7 w-7 text-muted" strokeWidth={1.5} />
                    <h2 className="mt-4 text-lg font-semibold">Photograph a casting</h2>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Any phone or line camera. No training photos needed.</p>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      <Button variant="primary" onClick={() => setPhase("camera")} className="hidden sm:inline-flex">
                        <Camera className="h-4 w-4" /> Open camera
                      </Button>
                      <Button variant="primary" onClick={() => captureRef.current?.click()} className="sm:hidden">
                        <Camera className="h-4 w-4" /> Take photo
                      </Button>
                      <Button onClick={() => fileRef.current?.click()}>
                        <Upload className="h-4 w-4" /> Upload photo
                      </Button>
                    </div>
                    <p className="mt-3 hidden text-[12px] text-muted sm:block">or drop an image here</p>
                  </Dropzone>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
                  <input ref={captureRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

                  {samples.length > 0 && (
                    <div className="mt-5">
                      <div className="mb-2.5 flex items-baseline justify-between gap-3">
                        <h3 className="text-[13px] font-medium">Sample castings</h3>
                        <span className="text-[12px] text-muted">Tap one to inspect it</span>
                      </div>
                      <div className="grid grid-cols-3 gap-x-3 gap-y-3.5 sm:grid-cols-4">
                        {samples.slice(0, 12).map((s) => (
                          <button key={s.file} onClick={() => fromUrl(s.url)} className="group min-w-0 text-left">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={s.url}
                              alt={s.title}
                              className="aspect-square w-full rounded-lg border border-line object-cover transition-colors group-hover:border-accent-strong"
                            />
                            <span className="mt-1.5 block truncate text-[12px] text-muted group-hover:text-fg">{s.title}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {phase === "camera" && (
                <motion.div key="cam" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <CameraView onCapture={run} onClose={() => setPhase("idle")} />
                </motion.div>
              )}

              {(phase === "running" || phase === "done") && imgSrc && (
                <motion.div key="view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <InspectionOverlay
                    src={imgSrc}
                    width={imgW}
                    height={imgH}
                    defects={result?.defects}
                    scanning={phase === "running"}
                    active={active}
                    onSelect={setActive}
                    partCircle={result?.meta.part_circle}
                    className="mx-auto max-h-[68vh]"
                  />
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button variant="primary" onClick={reset} disabled={phase === "running"}>
                      <ImagePlus className="h-4 w-4" /> Next part
                    </Button>
                    <Button onClick={() => lastBlob.current && run(lastBlob.current)} disabled={phase === "running"}>
                      <RotateCcw className="h-4 w-4" /> Re-run
                    </Button>
                    {result && (
                      <div className="ml-auto flex flex-wrap gap-3">
                        {[...new Set(result.defects.map((d) => d.type))].map((t) => (
                          <span key={t} className="inline-flex items-center gap-1.5 text-[13px] text-muted">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: defectColor(t) }} />
                            {t.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>

        {/* ------------------------------------------------ results */}
        <div className="flex min-w-0 flex-col gap-4">
          {phase !== "done" && (
            <>
              <Pipeline stage={phase === "running" ? stage : -1} live={health?.provider === "meta"} prompts={prompts.filter((p) => enabled[p])} part={part} />
              <RecentList items={recent} onOpen={openRecent} className="flex-1" />
            </>
          )}

          {phase === "done" && result && (
            <>
              <VerdictCard insp={result} />
              <section className="space-y-2">
                <div className="flex items-baseline justify-between px-0.5">
                  <h3 className="text-[15px] font-semibold">Detections</h3>
                  <span className="text-[12px] text-muted">Tap to highlight · confirm to teach</span>
                </div>
                {result.defects.length === 0 ? (
                  <Card className="flex items-center gap-3 p-4 text-sm text-muted">
                    <Check className="h-4 w-4 text-pass" /> Nothing matched {result.meta.prompts?.join(", ")}.
                  </Card>
                ) : (
                  result.defects.map((d) => (
                    <DefectCard
                      key={d.id}
                      d={d}
                      active={active === d.id}
                      onSelect={() => setActive(active === d.id ? null : d.id)}
                      onChange={(nd) => setResult({ ...result, defects: result.defects.map((x) => (x.id === nd.id ? nd : x)) })}
                    />
                  ))
                )}
              </section>
              <Card className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="op-note" className="text-[13px] font-medium">
                    Operator note
                  </label>
                  <VoiceNote enabled={health?.provider === "meta"} onText={(t) => saveNote(note ? `${note} ${t}` : t)} />
                </div>
                <textarea
                  id="op-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={(e) => saveNote(e.target.value)}
                  rows={2}
                  placeholder="e.g. Ladle was cold on this heat"
                  className="mt-2.5 w-full resize-none rounded-lg border border-line-strong bg-bg p-3 text-sm outline-none placeholder:text-faint focus:border-accent"
                />
                <p className="mt-2 text-[12px] text-muted">
                  {[result.machine, result.shift && `Shift ${result.shift}`, result.batch && `Heat ${result.batch}`, result.supplier].filter(Boolean).join("  ·  ")}
                </p>
              </Card>
            </>
          )}
        </div>
      </div>

      {phase === "done" && recent.length > 0 && <RecentStrip items={recent} onOpen={openRecent} />}
    </div>
  );
}

function Header() {
  const { part } = useStation();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Inspect</h1>
      <p className="mt-1 text-sm text-muted">
        {part ? `${part.name} · ${part.material} · Ø${part.diameter_mm} mm · judged by ${part.rules.length} acceptance rules` : "Loading part…"}
      </p>
    </div>
  );
}

function Dropzone({ children, onFile }: { children: React.ReactNode; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f?.type.startsWith("image/")) onFile(f);
      }}
      className={cn("rounded-xl border border-dashed px-6 py-10 text-center transition-colors", over ? "border-accent bg-accent/8" : "border-line-strong bg-bg")}
    >
      {children}
    </div>
  );
}

const STAGES = [
  { title: "Segment", live: "SAM 3.1", off: "OpenCV fallback", body: "Outlines every region matching your words" },
  { title: "Measure", live: "Calibrated", off: "Calibrated", body: "Pixels to mm from the part diameter, with zone and clock position" },
  { title: "Judge", live: "Muse Spark", off: "Rule engine", body: "Checks the rules below and explains the verdict" },
];

function Pipeline({ stage, live, prompts, part }: { stage: number; live: boolean; prompts: string[]; part: Part | null | undefined }) {
  return (
    <Card className="p-5">
      <h3 className="text-[15px] font-semibold">{stage < 0 ? "How a casting is judged" : "Inspecting…"}</h3>
      <ol className="mt-4 space-y-3.5">
        {STAGES.map((s, i) => {
          const done = stage > i;
          const running = stage === i;
          return (
            <li key={s.title} className="flex gap-3">
              <span
                className={cn(
                  "mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-medium tabular",
                  done ? "border-accent bg-accent text-white" : running ? "border-accent-strong text-accent-strong" : "border-line-strong text-muted",
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : running ? <Loader2 className="h-3 w-3 animate-spin" /> : i + 1}
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{s.title}</span>
                  <span className="text-[12px] text-muted">{live ? s.live : s.off}</span>
                </div>
                <p className="mt-0.5 text-[13px] text-muted">
                  {i === 0 && prompts.length ? (
                    <>
                      Looking for{" "}
                      {prompts.map((p, k) => (
                        <span key={p} className="text-fg">
                          {p}
                          {k < prompts.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </>
                  ) : (
                    s.body
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {part && part.rules.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-baseline justify-between">
            <h4 className="text-[13px] font-medium">Acceptance rules</h4>
            <Link href="/parts" className="text-[12px] text-muted hover:text-fg">
              Edit
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-line">
            {part.rules.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="w-7 shrink-0 font-mono text-[12px] text-muted">{r.id}</span>
                <span className="min-w-0 flex-1 truncate">{r.text}</span>
                <Pill tone={DISPOSITION_STYLE[r.action].tone}>{DISPOSITION_STYLE[r.action].label}</Pill>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function RecentList({ items, onOpen, className }: { items: Inspection[]; onOpen: (r: Inspection) => void; className?: string }) {
  return (
    <Card className={cn("flex flex-col p-5", className)}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold">Recent inspections</h3>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">
          Dashboard <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted">No inspections on this part yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {items.slice(0, 6).map((r) => {
            const v = VERDICT_STYLE[r.verdict];
            return (
              <li key={r.id}>
                <button onClick={() => onOpen(r)} className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.image_url ? <img src={r.image_url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-md bg-raised" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{r.summary}</span>
                    <span className="tabular block text-[12px] text-muted">
                      #{r.id} · {r.defect_count} detection{r.defect_count === 1 ? "" : "s"} · {timeAgo(r.created_at)}
                    </span>
                  </span>
                  <Pill tone={v.tone}>{v.label}</Pill>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RecentStrip({ items, onOpen }: { items: Inspection[]; onOpen: (r: Inspection) => void }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold">Recent inspections</h3>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">
          Dashboard <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {items.map((r) => {
          const v = VERDICT_STYLE[r.verdict];
          return (
            <button key={r.id} onClick={() => onOpen(r)} className="group w-36 shrink-0 overflow-hidden rounded-xl border border-line bg-surface text-left transition-colors hover:bg-hover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {r.image_url && <img src={r.image_url} alt="" className="aspect-[4/3] w-full object-cover" />}
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <span className="tabular text-[12px] text-muted">
                  #{r.id} · {timeAgo(r.created_at)}
                </span>
                <Pill tone={v.tone}>{v.label}</Pill>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
