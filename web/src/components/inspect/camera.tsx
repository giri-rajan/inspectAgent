"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, SwitchCamera, X } from "lucide-react";
import { Button } from "../ui/primitives";

export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setReady(false);
    setError(null);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera needs HTTPS or localhost.");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play();
          setReady(true);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Camera unavailable");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, facing]);

  const capture = (): Promise<Blob | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return Promise.resolve(null);
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.92));
  };

  return { videoRef, error, ready, capture, flip: () => setFacing((f) => (f === "environment" ? "user" : "environment")) };
}

export function CameraView({ onCapture, onClose }: { onCapture: (b: Blob) => void; onClose: () => void }) {
  const { videoRef, error, ready, capture, flip } = useCamera(true);
  return (
    <div className="relative overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "4 / 3" }}>
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="aspect-square w-[62%] rounded-full border-2 border-dashed border-white/60 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
      </div>
      <div className="absolute top-3 left-3 rounded-md bg-black/75 px-3 py-1 text-[13px] text-white">Fit the casting inside the circle</div>
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center text-sm text-muted">
          <div>
            <p className="font-medium text-fg">Camera unavailable</p>
            <p className="mt-1">{error}</p>
            <p className="mt-2 text-xs">Use “Upload photo” instead, or open the app on https / localhost.</p>
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 p-4">
        <Button variant="ghost" size="icon" onClick={onClose} className="bg-black/40 text-white" aria-label="Close camera">
          <X className="h-5 w-5" />
        </Button>
        <button
          disabled={!ready}
          aria-label="Capture"
          onClick={async () => {
            const b = await capture();
            if (b) onCapture(b);
          }}
          className="grid h-16 w-16 place-items-center rounded-full bg-white/95 ring-4 ring-white/30 transition active:scale-95 disabled:opacity-40"
        >
          <Camera className="h-6 w-6 text-black" />
        </button>
        <Button variant="ghost" size="icon" onClick={flip} className="bg-black/40 text-white" aria-label="Switch camera">
          <SwitchCamera className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
