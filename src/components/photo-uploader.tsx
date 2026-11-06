"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import type { ActionState } from "@/lib/action";

type Phase = { value: string; label: string };

/** Fotos tiradas no celular/tablet: reduz no próprio aparelho (JPEG ~1600px) e envia uma a uma. */
export function PhotoUploader({ workOrderId, phases, defaultPhase, action, allowInternal = true }: {
  workOrderId: string; phases: Phase[]; defaultPhase: string; allowInternal?: boolean;
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState(defaultPhase);
  const [caption, setCaption] = useState("");
  const [visible, setVisible] = useState(true);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setMsg(null);
    let ok = 0;
    for (const f of Array.from(files)) {
      try {
        const data = await shrink(f);
        const fd = new FormData();
        fd.set("workOrderId", workOrderId); fd.set("phase", phase); fd.set("caption", caption); fd.set("visible", visible ? "on" : ""); fd.set("data", data);
        const r = await action(null, fd);
        if (r?.error) { setMsg({ error: r.error }); break; }
        ok++;
      } catch { setMsg({ error: `Não foi possível ler a imagem ${f.name}.` }); break; }
    }
    setBusy(false);
    if (ok) { setMsg((m) => m ?? { ok: `${ok} foto(s) enviada(s).` }); setCaption(""); router.refresh(); }
    if (input.current) input.current.value = "";
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-line p-3">
      <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
        <select className="select" value={phase} onChange={(e) => setPhase(e.target.value)} aria-label="Fase">{phases.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
        <input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Legenda (ex.: lateral esquerda, painel, pneu DD)" />
      </div>
      {allowInternal && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Mostrar ao cliente no app</label>}
      <label className={`btn btn-primary w-full ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <Camera size={16} /> {busy ? "Enviando…" : "Tirar / escolher fotos"}
        <input ref={input} type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => send(e.target.files)} />
      </label>
      {msg?.error && <p role="alert" className="alert alert-error">{msg.error}</p>}
      {msg?.ok && <p role="status" className="alert alert-ok">{msg.ok}</p>}
    </div>
  );
}

async function shrink(file: File, max = 1600, quality = 0.8): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
