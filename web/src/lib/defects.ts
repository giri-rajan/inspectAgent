import type { Disposition, Verdict } from "./api";

export const DEFECT_COLOR: Record<string, string> = {
  // mask colours on grey castings; crack moved off violet so it never reads as the lavender UI accent
  porosity: "#f43f5e",
  crack: "#e8c547",
  burr: "#d97706",
  scratch: "#0891b2",
};
const EXTRA = ["#7cc04f", "#e06cb0", "#58a6ff", "#ef7d3c"];

export function defectColor(type: string) {
  if (DEFECT_COLOR[type]) return DEFECT_COLOR[type];
  let h = 0;
  for (const c of type) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return EXTRA[h % EXTRA.length];
}

export const DEFECT_BLURB: Record<string, string> = {
  porosity: "Gas holes / pinholes",
  crack: "Cracks & hot tears",
  burr: "Burrs & flash on edges",
  scratch: "Surface scratches",
};

type Tone = "pass" | "fail" | "rework" | "review";

export const VERDICT_STYLE: Record<Verdict, { label: string; tone: Tone; text: string; bg: string; hex: string; blurb: string }> = {
  PASS: { label: "Pass", tone: "pass", text: "text-pass", bg: "bg-pass/14", hex: "var(--color-pass)", blurb: "Ship it" },
  REVIEW: { label: "Review", tone: "review", text: "text-review", bg: "bg-review/14", hex: "var(--color-review)", blurb: "Hold for an engineer" },
  REWORK: { label: "Rework", tone: "rework", text: "text-rework", bg: "bg-rework/14", hex: "var(--color-rework)", blurb: "Fettle and re-inspect" },
  FAIL: { label: "Fail", tone: "fail", text: "text-fail", bg: "bg-fail/14", hex: "var(--color-fail)", blurb: "Scrap" },
};

export const DISPOSITION_STYLE: Record<Disposition, { label: string; tone: Tone; cls: string }> = {
  reject: { label: "Reject", tone: "fail", cls: "bg-fail/14 text-fail" },
  rework: { label: "Rework", tone: "rework", cls: "bg-rework/14 text-rework" },
  review: { label: "Review", tone: "review", cls: "bg-review/14 text-review" },
  accept: { label: "Accept", tone: "pass", cls: "bg-pass/14 text-pass" },
};
