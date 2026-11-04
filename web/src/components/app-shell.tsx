"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookCheck, Factory, LayoutDashboard, ScanLine, Settings2, Workflow } from "lucide-react";
import { Logo } from "./logo";
import { useStation } from "./station";
import { Select } from "./ui/primitives";
import { cn, SHIFT_LABEL } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Inspect", icon: ScanLine },
  { href: "/line", label: "Line mode", icon: Activity },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/rootcause", label: "Root cause", icon: Workflow },
  { href: "/library", label: "Library", icon: BookCheck },
  { href: "/parts", label: "Parts & rules", icon: Settings2 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-line bg-bg lg:flex">
        <Link href="/" className="flex h-14 items-center gap-2.5 px-4">
          <Logo className="h-7 w-7" />
          <div className="leading-tight">
            <div className="text-[14px] font-semibold">InspectAgent</div>
            <div className="text-[12px] text-muted">Casting QA</div>
          </div>
        </Link>
        <nav className="mt-3 flex flex-col gap-0.5 px-2.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[14px] transition-colors",
                  active ? "bg-raised font-medium text-fg" : "text-muted hover:bg-surface hover:text-fg",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto p-2.5">
          <ModelStatus />
        </div>
      </aside>

      <div className="lg:pl-[232px]">
        <TopBar />
        <main className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-12">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg px-1 pt-1.5 pb-[max(env(safe-area-inset-bottom),8px)] lg:hidden">
        <div className="grid grid-cols-6">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex min-h-11 flex-col items-center justify-center gap-1 rounded-md text-[11px] font-medium", active ? "text-fg" : "text-muted")}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.75} />
                <span className="truncate">{label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function ModelStatus() {
  const { health } = useStation();
  const live = health?.provider === "meta";
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-pass" : health ? "bg-rework" : "bg-muted")} />
        {health ? (live ? "Meta models live" : "Offline mode") : "Connecting…"}
      </div>
      <dl className="mt-2.5 space-y-1 text-[12px]">
        <Row k="Segment" v={live ? "SAM 3.1" : "OpenCV fallback"} />
        <Row k="Judge" v={live ? "Muse Spark" : "Rule engine"} />
        <Row k="Voice" v={live ? "Muse Transcribe" : "—"} />
      </dl>
      {!live && health && <p className="mt-2.5 text-[12px] leading-snug text-muted">Add MODEL_API_KEY to run SAM 3.1 and Muse Spark.</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="text-fg">{v}</dd>
    </div>
  );
}

const MACHINES = ["Furnace 1", "Furnace 2", "Furnace 3"];
const SUPPLIERS = ["Supplier A", "Supplier B", "Supplier C"];

function TopBar() {
  const { parts, partId, setPartId, station, setStation, health } = useStation();
  const live = health?.provider === "meta";
  return (
    <header className="z-20 border-b border-line bg-bg lg:sticky lg:top-0">
      <div className="mx-auto flex min-h-14 max-w-[1400px] flex-wrap items-center gap-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <Link href="/" className="mr-1 lg:hidden" aria-label="InspectAgent home">
          <Logo className="h-7 w-7" />
        </Link>
        <div className="relative">
          <Factory className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <Select value={partId} onChange={(e) => setPartId(e.target.value)} className="pl-8 font-medium" aria-label="Part">
            {parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.id}
              </option>
            ))}
          </Select>
        </div>
        <span className="hidden h-5 w-px bg-line sm:block" />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={station.machine} onChange={(e) => setStation({ machine: e.target.value })} aria-label="Furnace">
            {MACHINES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <Select value={station.shift} onChange={(e) => setStation({ shift: e.target.value })} aria-label="Shift">
            {Object.entries(SHIFT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                Shift {v}
              </option>
            ))}
          </Select>
          <Select value={station.supplier} onChange={(e) => setStation({ supplier: e.target.value })} aria-label="Supplier" className="hidden md:block">
            {SUPPLIERS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <input
            value={station.batch}
            onChange={(e) => setStation({ batch: e.target.value })}
            aria-label="Heat number"
            placeholder="Heat no."
            className="hidden h-8 w-32 rounded-lg border border-line-strong bg-surface px-3 font-mono text-[12px] outline-none placeholder:text-faint focus:border-accent md:block"
          />
        </div>
        <span className="ml-auto hidden items-center gap-1.5 text-[12px] text-muted sm:inline-flex lg:hidden">
          <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-pass" : "bg-rework")} />
          {live ? "SAM 3.1 · Muse Spark" : "Offline"}
        </span>
      </div>
    </header>
  );
}
