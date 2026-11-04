"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Report8D } from "@/lib/api";
import { Button, Card } from "../ui/primitives";

export function ReportView({ report }: { report: Report8D }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const blob = await api.reportPdf(report);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `8D_${report.part?.id ?? "part"}_${report.defect_type ?? "defect"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rc = report.d4_root_cause;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <FileText className="mt-1 h-4 w-4 shrink-0 text-muted" />
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold">{report.title}</h3>
              <p className="mt-0.5 text-[13px] text-muted">
                8D / CAPA draft · {report.part?.material} · {report.date}
              </p>
            </div>
          </div>
          <Button variant="primary" onClick={download} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
          </Button>
        </div>

        <div className="space-y-5 border-t border-line p-5 text-sm">
          <Section code="D4" title="Root cause">
            <p className="rounded-lg border border-accent/40 bg-accent/10 p-3 leading-relaxed font-medium text-fg">{rc.statement}</p>
            <ul className="mt-3 space-y-1.5">
              {rc.evidence.map((e) => (
                <li key={e} className="flex gap-2 text-[13px] text-fg">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent-strong" />
                  {e}
                </li>
              ))}
            </ul>
            {rc.five_whys.length > 0 && (
              <ol className="mt-3 space-y-1 border-l border-line pl-4">
                {rc.five_whys.map((w, i) => (
                  <li key={w} className="text-[13px] text-fg">
                    <span className="mr-1 text-[12px] text-muted">Why {i + 1}</span> {w}
                  </li>
                ))}
              </ol>
            )}
          </Section>
          <Section code="D2" title="Problem">
            <p className="leading-relaxed text-muted">{report.d2_problem}</p>
          </Section>
          <Section code="D3" title="Containment">
            <Bullets items={report.d3_containment} />
          </Section>
          <Section code="D5" title="Corrective actions">
            <div className="space-y-2">
              {report.d5_corrective_actions.map((a) => (
                <div key={a.action} className="rounded-lg border border-line bg-raised p-3">
                  <p className="text-[13px] leading-relaxed">{a.action}</p>
                  <div className="mt-1.5 flex gap-3 text-[12px] text-muted">
                    <span>Owner: {a.owner}</span>
                    <span>Due: {a.due}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
          <Section code="D6" title="Verification">
            <p className="text-muted">{report.d6_verification}</p>
          </Section>
          <Section code="D7" title="Prevent recurrence">
            <Bullets items={report.d7_prevention} />
          </Section>
          <div className="grid gap-5 sm:grid-cols-2">
            <Section code="D1" title="Team">
              <Bullets items={report.d1_team} />
            </Section>
            <Section code="D8" title="Closure">
              <p className="text-muted">{report.d8_closure}</p>
            </Section>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function Section({ code, title, children }: { code: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[12px] text-muted">{code}</span>
        <h4 className="text-[13px] font-semibold">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((x) => (
        <li key={x} className="flex gap-2 text-[13px] text-fg">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-line-strong" />
          {x}
        </li>
      ))}
    </ul>
  );
}
