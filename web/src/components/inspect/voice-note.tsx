"use client";

import { useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "../ui/primitives";

/** Encode mono PCM16 WAV at 16 kHz for Muse Voice Transcribe. */
async function toWav(blob: Blob): Promise<Blob> {
  const buf = await blob.arrayBuffer();
  const ctx = new AudioContext();
  const audio = await ctx.decodeAudioData(buf);
  await ctx.close();
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(audio.duration * rate), rate);
  const src = offline.createBufferSource();
  src.buffer = audio;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  out.setUint32(4, 36 + pcm.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  w(36, "data");
  out.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Blob([out], { type: "audio/wav" });
}

export function VoiceNote({ enabled, onText }: { enabled: boolean; onText: (t: string) => void }) {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const rec = useRef<MediaRecorder | null>(null);

  const start = async () => {
    if (!enabled) {
      toast("Voice notes use Muse Voice Transcribe", { description: "Add MODEL_API_KEY to enable. You can type the note for now." });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("busy");
        try {
          const wav = await toWav(new Blob(chunks, { type: mr.mimeType }));
          const { text } = await api.voice(wav);
          onText(text);
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setState("idle");
        }
      };
      rec.current = mr;
      mr.start();
      setState("rec");
    } catch {
      toast.error("Microphone unavailable");
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant={state === "rec" ? "danger" : "secondary"}
      onClick={() => (state === "rec" ? rec.current?.stop() : start())}
      disabled={state === "busy"}
      aria-label="Voice note"
    >
      {state === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "rec" ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
      {state === "rec" ? "Stop" : state === "busy" ? "Transcribing" : "Voice note"}
    </Button>
  );
}
