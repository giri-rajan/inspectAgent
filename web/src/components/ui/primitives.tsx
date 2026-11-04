"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg" | "icon";
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { className, variant = "secondary", size = "md", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
        {
          primary: "bg-accent text-white hover:bg-accent-strong",
          secondary: "border border-line-strong bg-surface text-fg hover:bg-hover",
          ghost: "text-muted hover:bg-hover hover:text-fg",
          danger: "border border-fail/35 bg-fail/10 text-fail hover:bg-fail/16",
          success: "border border-pass/35 bg-pass/10 text-pass hover:bg-pass/16",
        }[variant],
        { sm: "h-8 px-3 text-[13px]", md: "h-9 px-3.5 text-sm", lg: "h-10 px-4 text-sm", icon: "h-9 w-9" }[size],
        className,
      )}
      {...props}
    />
  );
});

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

export function CardHeader({ title, subtitle, action }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Pale tint with same-hue text. Used for verdicts, dispositions and statuses only. */
export function Pill({ className, children, tone }: { className?: string; children: React.ReactNode; tone: "pass" | "fail" | "rework" | "review" | "neutral" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 flex-none items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap",
        {
          pass: "bg-pass/14 text-pass",
          fail: "bg-fail/14 text-fail",
          rework: "bg-rework/14 text-rework",
          review: "bg-review/14 text-review",
          neutral: "bg-raised text-muted",
        }[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-8 appearance-none rounded-lg border border-line-strong bg-surface pr-8 pl-3 text-[13px] text-fg outline-none hover:bg-hover focus:border-accent",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238a8f98%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[right_10px_center] bg-no-repeat",
        className,
      )}
      {...props}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-fg outline-none placeholder:text-faint hover:border-[#3e3e44] focus:border-accent",
        className,
      )}
      {...props}
    />
  );
});

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("rounded-lg bg-raised", className)} />;
}

/** One container split by hairlines: label over value, no tiles. */
export function StatStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid gap-px overflow-hidden rounded-xl border border-line bg-line", className)}>{children}</div>;
}

export function Stat({ label, value, delta, good, hint }: { label: string; value: React.ReactNode; delta?: string; good?: boolean; hint?: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <div className="tabular text-[26px] leading-none font-semibold tracking-tight">{value}</div>
        {delta && <div className={cn("text-[13px] font-medium whitespace-nowrap tabular", good ? "text-pass" : "text-fail")}>{delta}</div>}
      </div>
      {hint && <div className="mt-2 text-[12px] text-faint">{hint}</div>}
    </div>
  );
}
