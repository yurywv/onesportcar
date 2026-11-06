"use client";
import { useEffect, useRef, useState } from "react";

export type CameraView = { id: string; name: string; location?: string | null; kind: string; src: string };

/** Player das câmeras internas: HLS (.m3u8), player embutido (iframe) do NVR/nuvem, MJPEG ou imagem atualizada. */
export function CameraPlayer({ cam }: { cam: CameraView }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-black">
      <div className="relative aspect-video">
        {cam.kind === "HLS" && <Hls src={cam.src} />}
        {cam.kind === "IFRAME" && <iframe src={cam.src} title={cam.name} className="absolute inset-0 h-full w-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" />}
        {cam.kind === "MJPEG" && <img src={cam.src} alt={cam.name} className="absolute inset-0 h-full w-full object-contain" />}
        {cam.kind === "SNAPSHOT" && <Snapshot src={cam.src} alt={cam.name} />}
        <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> AO VIVO
        </span>
      </div>
      <figcaption className="bg-surface px-3 py-2 text-xs"><b>{cam.name}</b>{cam.location && <span className="text-muted"> · {cam.location}</span>}</figcaption>
    </figure>
  );
}

function Hls({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let destroy: (() => void) | undefined;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    } else {
      import("hls.js").then(({ default: H }) => {
        if (!H.isSupported()) return setErr(true);
        const hls = new H({ lowLatencyMode: true });
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(H.Events.ERROR, (_e, d) => { if (d.fatal) setErr(true); });
        destroy = () => hls.destroy();
      });
    }
    return () => destroy?.();
  }, [src]);
  return (
    <>
      <video ref={ref} className="absolute inset-0 h-full w-full object-contain" autoPlay muted playsInline controls />
      {err && <p className="absolute inset-0 grid place-items-center text-sm text-white/80">Câmera indisponível no momento.</p>}
    </>
  );
}

function Snapshot({ src, alt }: { src: string; alt: string }) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), 4000); return () => clearInterval(i); }, []);
  return <img src={`${src}${src.includes("?") ? "&" : "?"}t=${t}`} alt={alt} className="absolute inset-0 h-full w-full object-contain" />;
}
