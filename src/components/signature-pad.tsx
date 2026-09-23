"use client";
import { useEffect, useRef, useState } from "react";

/** Captura de assinatura em canvas (dedo, caneta ou mouse). Envia PNG em data URL num input oculto. */
export function SignaturePad({ name = "signature" }: { name?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState("");
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div>
      <canvas
        ref={canvas}
        className="h-40 w-full touch-none rounded-lg border border-line bg-white"
        aria-label="Área de assinatura"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = canvas.current!.getContext("2d")!;
          ctx.beginPath();
          ctx.moveTo(...pos(e));
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext("2d")!;
          ctx.lineTo(...pos(e));
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          setData(canvas.current!.toDataURL("image/png"));
        }}
      />
      <div className="mt-1 flex items-center justify-between text-xs text-muted">
        <span>{data ? "Assinatura capturada" : "Assine dentro do quadro"}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            const c = canvas.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setData("");
          }}
        >
          Limpar
        </button>
      </div>
      <input type="hidden" name={name} value={data} />
    </div>
  );
}
