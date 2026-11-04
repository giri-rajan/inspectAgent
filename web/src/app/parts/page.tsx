"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Part, type Rule } from "@/lib/api";
import { defectColor, DISPOSITION_STYLE } from "@/lib/defects";
import { cn } from "@/lib/utils";
import { useStation } from "@/components/station";
import { Button, Card, CardHeader, Input, Select } from "@/components/ui/primitives";

const ZONES = ["", "hub", "vane", "rim", "edge"];

export default function PartsPage() {
  const { parts, partId, setPartId, refreshParts } = useStation();
  const [draft, setDraft] = useState<Part | null>(null);
  const [newPrompt, setNewPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  const current = parts.find((p) => p.id === partId);
  useEffect(() => {
    if (current) setDraft(structuredClone(current));
  }, [current]);

  if (!draft) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);
  const types = [...new Set([...draft.prompts, "any"])];

  const setRule = (i: number, patch: Partial<Rule>) => setDraft({ ...draft, rules: draft.rules.map((r, k) => (k === i ? { ...r, ...patch } : r)) });

  const save = async () => {
    setSaving(true);
    try {
      await api.updatePart(draft.id, {
        diameter_mm: draft.diameter_mm,
        description: draft.description,
        prompts: draft.prompts,
        rules: draft.rules,
      });
      await refreshParts();
      toast.success("Rules saved", { description: "The next inspection uses them immediately. No retraining." });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Parts & rules</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Describe a part&rsquo;s defects in words for SAM 3.1 and write the acceptance rules your quality manual already has. No retraining.</p>
        </div>
        <Button variant="primary" onClick={save} disabled={!dirty || saving}>
          <Save className="h-4 w-4" /> {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" role="group" aria-label="Parts">
        {parts.map((p) => (
          <button
            key={p.id}
            onClick={() => setPartId(p.id)}
            aria-pressed={p.id === partId}
            className={cn("card p-5 text-left transition-colors hover:bg-hover", p.id === partId && "border-accent bg-raised")}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="mt-0.5 font-mono text-[12px] text-muted">{p.id}</div>
              </div>
              <span className="tabular text-[13px] text-muted">Ø{p.diameter_mm} mm</span>
            </div>
            <div className="mt-3 text-[13px] text-muted">
              {p.material} · {p.process}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
              {p.prompts.map((x) => (
                <span key={x} className="inline-flex items-center gap-1.5 text-[12px] text-fg">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: defectColor(x) }} />
                  {x}
                </span>
              ))}
            </div>
            <div className="tabular mt-3 text-[12px] text-muted">
              {p.rules.length} rules · {(p.inspections ?? 0).toLocaleString()} inspections
            </div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title={draft.name} subtitle={`${draft.material} · ${draft.process}`} />
        <div className="grid gap-5 px-5 pb-5 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="block">
            <span className="text-[13px] font-medium">Reference diameter</span>
            <span className="relative mt-2 block">
              <Input type="number" step="0.5" value={draft.diameter_mm} onChange={(e) => setDraft({ ...draft, diameter_mm: Number(e.target.value) })} className="tabular pr-10" aria-describedby="dia-help" />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-muted">mm</span>
            </span>
            <span id="dia-help" className="mt-1.5 block text-[12px] text-muted">
              Converts pixels to millimetres.
            </span>
          </label>
          <label className="block">
            <span className="text-[13px] font-medium">Description</span>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={4}
              aria-describedby="desc-help"
              className="mt-2 w-full resize-none rounded-lg border border-line-strong bg-surface p-3 text-sm outline-none focus:border-accent"
            />
            <span id="desc-help" className="mt-1 block text-[12px] text-muted">
              Given to Muse Spark as context.
            </span>
          </label>
          <div>
            <span className="text-[13px] font-medium">What SAM 3.1 looks for</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {draft.prompts.map((p) => (
                <span key={p} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-raised pr-1 pl-2.5 text-[13px]">
                  <span className="h-2 w-2 rounded-full" style={{ background: defectColor(p) }} />
                  {p}
                  <button
                    onClick={() => setDraft({ ...draft, prompts: draft.prompts.filter((x) => x !== p) })}
                    className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-hover hover:text-fg"
                    aria-label={`Remove ${p}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const p = newPrompt.trim().toLowerCase();
                if (p && !draft.prompts.includes(p)) setDraft({ ...draft, prompts: [...draft.prompts, p] });
                setNewPrompt("");
              }}
            >
              <Input value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder="e.g. sand inclusion, cold shut" aria-label="New defect prompt" />
              <Button type="submit" size="icon" aria-label="Add prompt">
                <Plus className="h-4 w-4" />
              </Button>
            </form>
            <p className="mt-1.5 text-[12px] text-muted">Plain words, no training photos.</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Acceptance rules"
          subtitle="Evaluated on every detection. Muse Spark explains verdicts against these and may never pass a confident violation."
          action={
            <Button
              size="sm"
              onClick={() =>
                setDraft({
                  ...draft,
                  rules: [...draft.rules, { id: `R${draft.rules.length + 1}`, text: "", defect_type: draft.prompts[0] ?? "porosity", zone: null, max_size_mm: null, action: "reject" }],
                })
              }
            >
              <Plus className="h-4 w-4" /> Add rule
            </Button>
          }
        />
        <div className="divide-y divide-line border-t border-line">
          {draft.rules.map((r, i) => (
            <motion.div layout key={i} className="grid gap-x-4 gap-y-2 px-5 py-4 lg:grid-cols-[40px_minmax(0,1fr)_auto]">
              <span className="pt-2 font-mono text-[12px] text-muted">{r.id}</span>
              <div className="min-w-0">
                <Input value={r.text} onChange={(e) => setRule(i, { text: e.target.value })} placeholder="Rule in plain English, e.g. Reject if any hole is bigger than 2 mm" aria-label={`Rule ${r.id} text`} />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                  <span>If</span>
                  <Select value={r.defect_type} onChange={(e) => setRule(i, { defect_type: e.target.value })} aria-label="Defect type">
                    {[...new Set([...types, r.defect_type])].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                  <span>in</span>
                  <Select value={r.zone ?? ""} onChange={(e) => setRule(i, { zone: e.target.value || null })} aria-label="Zone">
                    {ZONES.map((z) => (
                      <option key={z} value={z}>
                        {z || "any zone"}
                      </option>
                    ))}
                  </Select>
                  <span>is</span>
                  <Select value={r.max_size_mm == null ? "any" : "over"} onChange={(e) => setRule(i, { max_size_mm: e.target.value === "any" ? null : (r.max_size_mm ?? 2) })} aria-label="Condition">
                    <option value="any">present</option>
                    <option value="over">larger than</option>
                  </Select>
                  {r.max_size_mm != null && (
                    <span className="inline-flex items-center gap-1.5">
                      <Input type="number" step="0.1" value={r.max_size_mm} onChange={(e) => setRule(i, { max_size_mm: Number(e.target.value) })} className="tabular h-8 w-20" aria-label="Size limit in mm" />
                      mm
                    </span>
                  )}
                  <span>then</span>
                  <Select value={r.action} onChange={(e) => setRule(i, { action: e.target.value as Rule["action"] })} className={cn("border-transparent font-medium", DISPOSITION_STYLE[r.action].cls)} aria-label="Action">
                    {Object.entries(DISPOSITION_STYLE).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, k) => k !== i) })} aria-label={`Delete rule ${r.id}`} className="justify-self-end">
                <Trash2 className="h-4 w-4" />
              </Button>
            </motion.div>
          ))}
        </div>
        <p className="border-t border-line px-5 py-3 text-[12px] text-muted">Porosity limits apply to the largest single pore, burr limits to the height above the rim, and other defects to their longest dimension.</p>
      </Card>
    </div>
  );
}
