"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Brain, CheckCircle2, Lightbulb, Loader2, Play, Search, Terminal } from "lucide-react";
import { api, type Overview, type Report8D } from "@/lib/api";
import { defectColor } from "@/lib/defects";
import { cn } from "@/lib/utils";
import { useStation } from "@/components/station";
import { Button, Card } from "@/components/ui/primitives";
import { ToolResult } from "@/components/agent/tool-result";
import { ReportView } from "@/components/agent/report";
import { Heatmap } from "@/components/charts/heatmap";

type AgentEvent =
  | { type: "thought"; text: string }
  | { type: "finding"; text: string; strength?: "strong" | "weak" | "info" }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; args: Record<string, unknown>; result: Record<string, unknown> }
  | { type: "report"; report: Report8D }
  | { type: "warning" | "error"; text: string }
  | { type: "done" };

const TYPES = ["porosity", "crack", "burr", "scratch"];
const PACE_MS = 420;

export default function RootCausePage() {
  const { partId, part, health } = useStation();
  const [type, setType] = useState("porosity");
  const [days, setDays] = useState(42);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report8D | null>(null);
  const [preview, setPreview] = useState<Overview | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const queue = useRef<AgentEvent[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("type");
    if (t) setType(t);
  }, []);

  useEffect(() => () => stop(), []);

  useEffect(() => {
    if (!partId) return;
    api.overview(partId, days, type).then(setPreview).catch(() => setPreview(null));
  }, [partId, days, type]);

  const stop = () => {
    esRef.current?.close();
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const run = (t = type) => {
    stop();
    setEvents([]);
    setReport(null);
    setRunning(true);
    queue.current = [];
    // reveal events at reading pace; the real Muse Spark loop is naturally slower than this
    timer.current = setInterval(() => {
      const ev = queue.current.shift();
      if (!ev) return;
      if (ev.type === "done") {
        setRunning(false);
        stop();
        return;
      }
      if (ev.type === "report") setReport(ev.report);
      if (ev.type === "error") setRunning(false);
      setEvents((prev) => [...prev, ev]);
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    }, PACE_MS);
    const es = new EventSource(`/api/rootcause/stream?part_id=${partId}&defect_type=${t}&days=${days}`);
    es.onmessage = (m) => queue.current.push(JSON.parse(m.data));
    es.onerror = () => {
      es.close();
      queue.current.push({ type: "done" });
    };
    esRef.current = es;
  };

  useEffect(() => {
    if (autoRan.current || !partId) return;
    if (new URLSearchParams(window.location.search).get("type")) {
      autoRan.current = true;
      run(new URLSearchParams(window.location.search).get("type")!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId]);

  const findings = events.filter((e): e is Extract<AgentEvent, { type: "finding" }> => e.type === "finding" && e.strength === "strong");
  const calls = events.filter((e) => e.type === "tool_call").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Root-cause agent</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            The agent queries production history by furnace, shift, supplier and heat, tests each hypothesis and drafts an 8D report.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
          <span className={cn("h-1.5 w-1.5 rounded-full", health?.provider === "meta" ? "bg-pass" : "bg-rework")} />
          {health?.provider === "meta" ? "Muse Spark, tool calling" : "Offline analyst, same tools"}
        </span>
      </div>

      <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="text-[13px] text-muted">Investigate</span>
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              aria-pressed={type === t}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] capitalize transition-colors",
                type === t ? "border-line-strong bg-raised text-fg" : "border-transparent text-muted hover:text-fg",
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: defectColor(t) }} />
              {t}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-muted">on {part?.name ?? partId} over the last</span>
        <div className="flex rounded-lg border border-line bg-bg p-0.5" role="group" aria-label="Period">
          {[14, 21, 42].map((d) => (
            <button key={d} onClick={() => setDays(d)} aria-pressed={days === d} className={cn("h-7 rounded-md px-2.5 text-[13px] transition-colors", days === d ? "bg-hover font-medium text-fg" : "text-muted hover:text-fg")}>
              {d} days
            </button>
          ))}
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => run()} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Investigating…" : events.length ? "Run again" : "Run investigation"}
        </Button>
      </Card>

      {events.length === 0 && !running ? (
        <>
          <Empty onRun={() => run()} />
          <Card className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold">
                Where <span className="capitalize">{type}</span> comes from, last {days} days
              </h2>
              <span className="text-[13px] text-muted">The agent starts from this and tests whether the pattern holds.</span>
            </div>
            <div className="mt-4">{preview ? <Heatmap cells={preview.heatmap.cells} overall={preview.heatmap.overall_rate} /> : <div className="h-56 rounded-lg bg-raised" />}</div>
          </Card>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <div className="mb-3 flex items-baseline justify-between px-0.5">
              <h2 className="text-[15px] font-semibold">Agent trace</h2>
              <span className="tabular text-[12px] text-muted">{calls} tool calls</span>
            </div>
            <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-line">
              <AnimatePresence initial={false}>
                {events.map((e, i) => (
                  <motion.li key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="relative pl-11">
                    <EventRow e={e} />
                  </motion.li>
                ))}
              </AnimatePresence>
              {running && (
                <li className="relative flex items-center gap-2 pl-11 text-[13px] text-muted">
                  <span className="absolute left-[11px] grid h-[10px] w-[10px] place-items-center rounded-full bg-bg">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-accent-strong" />
                  </span>
                  thinking…
                </li>
              )}
            </ol>
            <div ref={bottom} />
          </div>

          <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold">Key findings</h2>
              {findings.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted">Strong signals collect here as the agent finds them.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {findings.map((f, i) => (
                    <motion.li key={i} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2.5 text-sm leading-relaxed">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" />
                      {f.text}
                    </motion.li>
                  ))}
                </ul>
              )}
            </Card>
            {report && <ReportView report={report} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Dot({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("absolute top-0.5 left-0 grid h-8 w-8 place-items-center rounded-full border border-line bg-bg", className)}>{children}</span>;
}

function fmtArgs(args: Record<string, unknown>) {
  return Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : v}`)
    .join(", ");
}

function EventRow({ e }: { e: AgentEvent }) {
  switch (e.type) {
    case "thought":
      return (
        <>
          <Dot className="text-muted">
            <Brain className="h-4 w-4" />
          </Dot>
          <p className="pt-1.5 text-[13px] text-muted">{e.text}</p>
        </>
      );
    case "tool_call":
      return (
        <>
          <Dot className="text-muted">
            <Terminal className="h-4 w-4" />
          </Dot>
          <code className="mt-1 inline-block rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-fg">
            {e.tool}({fmtArgs(e.args)})
          </code>
        </>
      );
    case "tool_result":
      return (
        <>
          <Dot className="text-muted">
            <Search className="h-4 w-4" />
          </Dot>
          <Card className="p-4">
            <ToolResult tool={e.tool} result={e.result} />
          </Card>
        </>
      );
    case "finding":
      return (
        <>
          <Dot className={e.strength === "strong" ? "border-accent bg-accent text-white" : "text-muted"}>
            <Lightbulb className="h-4 w-4" />
          </Dot>
          <p className={cn("rounded-lg px-3.5 py-2.5 text-sm leading-relaxed", e.strength === "strong" ? "border border-accent/40 bg-accent/10 font-medium text-fg" : "text-fg")}>{e.text}</p>
        </>
      );
    case "report":
      return (
        <>
          <Dot className="border-pass/50 text-pass">
            <CheckCircle2 className="h-4 w-4" />
          </Dot>
          <p className="pt-1.5 text-[13px] font-medium text-pass">8D report drafted</p>
        </>
      );
    case "warning":
    case "error":
      return (
        <>
          <Dot className="border-fail/50 text-fail">
            <AlertTriangle className="h-4 w-4" />
          </Dot>
          <p className="pt-1.5 text-[13px] text-fail">{e.text}</p>
        </>
      );
    default:
      return null;
  }
}

function Empty({ onRun }: { onRun: () => void }) {
  const steps = [
    ["Size the problem", "trend()", "Is the defect rate rising?"],
    ["Locate it on the part", "defect_profile()", "Which zones, what sizes"],
    ["Slice production data", "rate_by()", "By furnace, shift and supplier"],
    ["Test interactions", "rate_by_pair()", "One furnace on one shift?"],
    ["Draft the 8D", "report", "Containment, root cause, five whys, actions"],
  ];
  return (
    <Card className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-center">
      <div>
        <h2 className="text-xl font-semibold">Ask why it keeps happening</h2>
        <p className="mt-2 max-w-md text-sm text-muted">Pick a defect and run. Every query the agent makes is shown, with the evidence behind each conclusion.</p>
        <Button variant="primary" className="mt-5" onClick={onRun}>
          <Play className="h-4 w-4" /> Run investigation
        </Button>
      </div>
      <ol className="divide-y divide-line rounded-lg border border-line bg-bg">
        {steps.map(([a, tool, b]) => (
          <li key={a} className="flex items-baseline gap-4 px-4 py-3">
            <span className="w-44 shrink-0 text-sm font-medium">{a}</span>
            <span className="min-w-0 flex-1 text-[13px] text-muted">{b}</span>
            <code className="hidden font-mono text-[12px] text-muted sm:block">{tool}</code>
          </li>
        ))}
      </ol>
    </Card>
  );
}
