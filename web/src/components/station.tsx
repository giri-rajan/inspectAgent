"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type Health, type Part } from "@/lib/api";

export interface StationContext {
  machine: string;
  shift: string;
  batch: string;
  supplier: string;
  operator: string;
}

interface Ctx {
  parts: Part[];
  part: Part | null;
  partId: string;
  setPartId: (id: string) => void;
  refreshParts: () => Promise<void>;
  station: StationContext;
  setStation: (s: Partial<StationContext>) => void;
  health: Health | null;
}

const defaultShift = () => {
  const h = new Date().getHours();
  return h >= 6 && h < 14 ? "A" : h >= 14 && h < 22 ? "B" : "C";
};

const today = () => {
  const d = new Date();
  return `H${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-2`;
};

const StationCtx = createContext<Ctx | null>(null);

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

export function StationProvider({ children }: { children: React.ReactNode }) {
  const [parts, setParts] = useState<Part[]>([]);
  const [partId, setPartIdState] = useState("IMP-200");
  const [health, setHealth] = useState<Health | null>(null);
  const [station, setStationState] = useState<StationContext>({
    machine: "Furnace 2",
    shift: "A",
    batch: "",
    supplier: "Supplier B",
    operator: "OP-21",
  });

  useEffect(() => {
    setStationState(load("ia.station", { machine: "Furnace 2", shift: defaultShift(), batch: today(), supplier: "Supplier B", operator: "OP-21" }));
    try {
      const p = localStorage.getItem("ia.part");
      if (p) setPartIdState(p);
    } catch {}
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const refreshParts = useCallback(async () => {
    setParts(await api.parts());
  }, []);

  useEffect(() => {
    refreshParts().catch(() => {});
  }, [refreshParts]);

  const setPartId = (id: string) => {
    setPartIdState(id);
    try {
      localStorage.setItem("ia.part", id);
    } catch {}
  };

  const setStation = (s: Partial<StationContext>) =>
    setStationState((prev) => {
      const next = { ...prev, ...s };
      try {
        localStorage.setItem("ia.station", JSON.stringify(next));
      } catch {}
      return next;
    });

  const part = useMemo(() => parts.find((p) => p.id === partId) ?? parts[0] ?? null, [parts, partId]);

  return (
    <StationCtx.Provider value={{ parts, part, partId: part?.id ?? partId, setPartId, refreshParts, station, setStation, health }}>
      {children}
    </StationCtx.Provider>
  );
}

export function useStation() {
  const ctx = useContext(StationCtx);
  if (!ctx) throw new Error("useStation outside StationProvider");
  return ctx;
}
