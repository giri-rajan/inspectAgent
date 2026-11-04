export type Verdict = "PASS" | "REVIEW" | "REWORK" | "FAIL";
export type Disposition = "reject" | "rework" | "review" | "accept";

export interface Rule {
  id: string;
  text: string;
  defect_type: string;
  zone: string | null;
  max_size_mm: number | null;
  action: Disposition;
}

export interface Part {
  id: string;
  name: string;
  material: string;
  process: string;
  diameter_mm: number;
  description: string;
  prompts: string[];
  rules: Rule[];
  inspections?: number;
}

export interface LibraryMatch {
  confirmed?: number;
  rejected?: number;
  notes?: string[];
  nearest?: { id: number; status: string; distance: number; crop: string | null }[];
}

export interface Defect {
  id: number;
  label: string;
  type: string;
  prompt: string;
  confidence: number;
  bbox: [number, number, number, number];
  polygons: [number, number][][];
  area_mm2: number;
  max_dim_mm: number;
  zone: string;
  location: string;
  severity: "critical" | "major" | "minor" | "ignore";
  disposition: Disposition | null;
  rule_id: string | null;
  reason: string;
  status: "pending" | "confirmed" | "rejected";
  feedback: string;
  features: Record<string, number | string>;
  library: LibraryMatch;
  crop_url: string | null;
  reviewed_at: string | null;
  inspection_id?: number;
}

export interface Inspection {
  id: number;
  part_id: string;
  created_at: string;
  source: string;
  image_url: string | null;
  width: number;
  height: number;
  verdict: Verdict;
  summary: string;
  provider: string;
  machine: string;
  shift: string;
  batch: string;
  supplier: string;
  operator: string;
  note: string;
  meta: {
    engine?: string;
    prompts?: string[];
    timings?: Record<string, number>;
    warnings?: string[];
    mm_per_px?: number;
    part_circle?: { cx: number; cy: number; r: number; method: string } | null;
  };
  defect_count: number;
  defects: Defect[];
}

export interface Health {
  ok: boolean;
  provider: "meta" | "mock";
  models: { segmentation: string; reasoning: string; voice: string | null };
  has_key: boolean;
}

export interface Sample {
  file: string;
  title: string;
  part_id: string;
  source: string;
  url: string;
}

export interface RateRow {
  key: string;
  inspected: number;
  defective: number;
  rate: number;
  lift: number;
  share: number;
  z: number;
}

export interface PairCell {
  a: string;
  b: string;
  inspected: number;
  defective: number;
  rate: number;
  lift: number;
  share: number;
  z: number;
}

export interface Overview {
  kpis: {
    inspected_7d: number;
    inspected_prev_7d: number;
    yield_7d: number;
    yield_prev_7d: number;
    scrap_7d: number;
    scrap_prev_7d: number;
    rework_7d: number;
    review_7d: number;
    fail_7d: number;
    top_defect: string | null;
  };
  pareto: { type: string; count: number; cum_share: number }[];
  daily: ({ date: string; inspected: number; yield: number | null } & Record<string, number | string | null>)[];
  heatmap: { dim_a: string; dim_b: string; overall_rate: number; cells: PairCell[] };
  hotspot: (PairCell & { defect_type: string }) | null;
}

export interface Report8D {
  title: string;
  date?: string;
  part?: { id: string; name: string; material: string };
  defect_type?: string;
  d1_team: string[];
  d2_problem: string;
  d3_containment: string[];
  d4_root_cause: { statement: string; evidence: string[]; five_whys: string[] };
  d5_corrective_actions: { action: string; owner: string; due: string }[];
  d6_verification: string;
  d7_prevention: string[];
  d8_closure: string;
  charts?: unknown;
}

export interface Library {
  items: Defect[];
  stats: { type: string; confirmed: number; rejected: number }[];
  pending: number;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = body.detail ?? msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch("/api/health").then(j<Health>),
  parts: () => fetch("/api/parts").then(j<Part[]>),
  updatePart: (id: string, body: Partial<Part>) =>
    fetch(`/api/parts/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(j<Part>),
  samples: () => fetch("/api/samples").then(j<Sample[]>),
  inspect: (image: Blob, fields: Record<string, string>) => {
    const fd = new FormData();
    fd.append("image", image, "capture.jpg");
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    return fetch("/api/inspect", { method: "POST", body: fd }).then(j<Inspection>);
  },
  inspections: (part_id: string, limit = 30) => fetch(`/api/inspections?part_id=${part_id}&limit=${limit}`).then(j<Inspection[]>),
  inspection: (id: number) => fetch(`/api/inspections/${id}`).then(j<Inspection>),
  setNote: (id: number, note: string) =>
    fetch(`/api/inspections/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }).then(j<Inspection>),
  review: (id: number, status: Defect["status"], feedback = "") =>
    fetch(`/api/defects/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, feedback }) }).then(j<Defect>),
  library: (part_id: string) => fetch(`/api/library?part_id=${part_id}`).then(j<Library>),
  overview: (part_id: string, days = 30, heat_type = "any") =>
    fetch(`/api/analytics/overview?part_id=${part_id}&days=${days}&heat_type=${heat_type}`).then(j<Overview>),
  reportPdf: (report: Report8D) =>
    fetch("/api/reports/8d/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) }).then((r) => {
      if (!r.ok) throw new Error("PDF failed");
      return r.blob();
    }),
  voice: (wav: Blob) => {
    const fd = new FormData();
    fd.append("audio", wav, "note.wav");
    return fetch("/api/voice", { method: "POST", body: fd }).then(j<{ text: string }>);
  },
};
